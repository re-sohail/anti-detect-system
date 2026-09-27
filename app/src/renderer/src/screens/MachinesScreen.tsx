import { useEffect, useState } from 'react';
import type { GuestRecord, GuestState } from '@common/ipc';
import { call, useAction, useQuery } from '../api';
import { ErrorBox, Field, Pill, Section, fmtTime } from '../ui';

const STATE_TONE: Record<GuestState, 'ok' | 'warn' | 'bad' | 'muted' | 'info'> = {
  created: 'muted', starting: 'info', running: 'ok', paused: 'warn', stopping: 'info', stopped: 'muted', error: 'bad',
};

export function MachinesScreen() {
  const guests = useQuery('guests.list', undefined);
  const presets = useQuery('presets.list', undefined);
  const act = useAction();
  const [presetId, setPresetId] = useState('');
  const [name, setName] = useState('');

  // Poll while any guest is transitioning, so crashes and shutdowns show up.
  useEffect(() => {
    const t = setInterval(() => void guests.reload(), 4000);
    return () => clearInterval(t);
  }, [guests.reload]);

  const create = async () => {
    const r = await act.run('create', () => call('guests.create', { presetId, name }));
    if (r) {
      setName('');
      void guests.reload();
    }
  };
  const doAct = async (label: string, fn: () => Promise<unknown>) => {
    await act.run(label, fn);
    void guests.reload();
  };

  return (
    <>
      <div className="page-head">
        <h1>Machines</h1>
        <p className="muted">
          Each guest has its own disk (copy-on-write over a verified base) and therefore its own browser data. Launch is blocked with a reason when any prerequisite fails.
        </p>
      </div>
      <ErrorBox error={guests.error ?? act.error} onClose={() => act.setError(null)} />

      <Section title="Create a guest">
        <div className="form-grid">
          <Field label="Preset">
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              <option value="">— choose —</option>
              {presets.data?.map((p) => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
            </select>
          </Field>
          <Field label="Guest name" hint="Internal label; never included in blinded exports">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="guest-A" />
          </Field>
        </div>
        <button className="primary" disabled={!presetId || !name || !!act.busy} onClick={create}>
          {act.busy === 'create' ? 'Verifying image and creating disk…' : 'Create'}
        </button>
      </Section>

      <Section title="Guests">
        {guests.data?.length === 0 && <p className="muted">No guests yet.</p>}
        {guests.data?.map((g) => (
          <GuestCard key={g.id} g={g} presetName={presets.data?.find((p) => p.id === g.presetId)?.name ?? g.presetId} busy={!!act.busy} doAct={doAct} />
        ))}
      </Section>
    </>
  );
}

function GuestCard({ g, presetName, busy, doAct }: {
  g: GuestRecord; presetName: string; busy: boolean; doAct: (label: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [snap, setSnap] = useState('clean');
  const [confirm, setConfirm] = useState<string | null>(null);
  const active = g.state === 'running' || g.state === 'paused' || g.state === 'starting';
  const stopped = g.state === 'created' || g.state === 'stopped' || g.state === 'error';

  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <div className="row between wrap gap">
        <div>
          <strong>{g.name}</strong> <Pill tone={STATE_TONE[g.state]}>{g.state}</Pill>{' '}
          <Pill tone="muted">condition #{g.conditionSeq}</Pill>{' '}
          {g.provisioning.mode === 'cloud-init' && (g.provisioning.provisionedAt
            ? <Pill tone="ok">provisioned</Pill>
            : <Pill tone="info">provisions on first boot</Pill>)}
          <div className="hint">
            {presetName} v{g.presetVersion} · <code>{g.id}</code> · updated {fmtTime(g.updatedAt)}
            {g.vncPort && <> · local display 127.0.0.1:{g.vncPort}</>}
          </div>
        </div>
        <div className="row gap wrap">
          {stopped && <>
            <button className="primary" disabled={busy} onClick={() => doAct('start', () => call('guests.start', { id: g.id, display: 'window' }))}>Start + open desktop</button>
            <button disabled={busy} onClick={() => doAct('start', () => call('guests.start', { id: g.id, display: 'headless' }))}>Start headless</button>
          </>}
          {g.state === 'running' && <button disabled={busy} onClick={() => doAct('pause', () => call('guests.pause', { id: g.id }))}>Pause</button>}
          {g.state === 'paused' && <button disabled={busy} onClick={() => doAct('resume', () => call('guests.resume', { id: g.id }))}>Resume</button>}
          {active && <>
            <button disabled={busy} onClick={() => doAct('stop', () => call('guests.stop', { id: g.id, force: false }))}>Shut down</button>
            <button className="danger" disabled={busy} onClick={() => doAct('stop', () => call('guests.stop', { id: g.id, force: true }))}>Force stop</button>
          </>}
        </div>
      </div>

      {g.lastError && (
        <div className="error" style={{ marginTop: 10 }}>
          <strong><code>{g.lastError.code}</code> {g.lastError.message}</strong>
          {(g.lastError.details as { logTail?: string } | undefined)?.logTail && <pre>{(g.lastError.details as { logTail: string }).logTail}</pre>}
        </div>
      )}

      {stopped && (
        <div className="row gap wrap" style={{ marginTop: 10 }}>
          <input style={{ width: 160 }} value={snap} onChange={(e) => setSnap(e.target.value)} aria-label="Snapshot name" />
          <button disabled={busy} onClick={() => doAct('snapshot', () => call('guests.snapshot', { id: g.id, name: snap }))}>Take snapshot</button>
          {g.snapshots.map((s) => (
            <button key={s} disabled={busy} title="Resets browser state: starts a new experimental condition" onClick={() => doAct('reset', () => call('guests.reset', { id: g.id, name: s }))}>
              Reset to “{s}”
            </button>
          ))}
          {g.provisioning.provisionedAt && (
            <button disabled={busy} title="Only for a builder guest that never ran a study visit"
              onClick={() => doAct('promote', () => call('images.promoteGuest', { guestId: g.id, name: `${g.name} base`, version: new Date().toISOString().slice(0, 10) }))}>
              Build base image from this guest
            </button>
          )}
          <span style={{ flex: 1 }} />
          {confirm === null ? (
            <button className="danger" onClick={() => setConfirm('')}>Delete…</button>
          ) : (
            <>
              <input style={{ width: 200 }} placeholder={`type “${g.name}” to confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              <button className="danger" disabled={confirm !== g.name || busy} onClick={() => doAct('delete', () => call('guests.delete', { id: g.id, confirmName: confirm }))}>Delete guest and disk</button>
              <button className="link" onClick={() => setConfirm(null)}>Cancel</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
