import { useState } from 'react';
import type { DiffEntry, Preset, PresetInput } from '@lvd/shared';
import type { PresetCheckResult } from '@common/ipc';
import { call, useAction, useQuery } from '../api';
import { ErrorBox, Field, Pill, Section, fmtTime } from '../ui';

const DEFAULT: PresetInput = {
  name: 'Linux desktop study A',
  description: '',
  hostConstraint: { arch: ['arm64'], os: ['darwin'], minHostRamMb: 8192, backend: 'qemu' },
  guest: { os: 'linux', arch: 'aarch64', imageId: '' },
  resources: { vcpus: 2, memoryMb: 3072, diskGb: 24 },
  display: { width: 1280, height: 800 },
  regional: { timeZone: 'Europe/London', locale: 'en-GB' },
  network: { routeId: 'default-nat' },
  expectedBootState: 'desktop-login',
};

function toInput(p: Preset): PresetInput {
  const { id: _i, version: _v, createdAt: _c, smokeTest: _s, ...rest } = p;
  return rest;
}

export function PresetsScreen() {
  const presets = useQuery('presets.list', undefined);
  const images = useQuery('images.list', undefined);
  const exits = useQuery('exits.list', undefined);
  const act = useAction();
  const [editing, setEditing] = useState<{ baseId?: string; input: PresetInput } | null>(null);
  const [preview, setPreview] = useState<{ valid: boolean; issues: string[]; diff: DiffEntry[]; snapshot: string } | null>(null);
  const [checks, setChecks] = useState<Record<string, PresetCheckResult>>({});

  const update = (fn: (p: PresetInput) => PresetInput) => {
    if (!editing) return;
    setEditing({ ...editing, input: fn(editing.input) });
    setPreview(null); // any change invalidates the preview
  };
  const num = (v: string) => (v === '' ? NaN : Number(v));

  const doPreview = async () => {
    if (!editing) return;
    const r = await act.run('preview', () => call('presets.preview', { input: editing.input, baseId: editing.baseId }));
    if (r) setPreview({ ...r, snapshot: JSON.stringify(editing.input) });
  };
  const doSave = async () => {
    if (!editing) return;
    const r = await act.run('save', () => call('presets.save', { input: editing.input, baseId: editing.baseId }));
    if (r) {
      setEditing(null);
      setPreview(null);
      void presets.reload();
    }
  };
  const doCheck = async (id: string) => {
    const r = await act.run('check', () => call('presets.check', { id }));
    if (r) setChecks({ ...checks, [id]: r });
  };

  const imageName = (id: string) => {
    const i = images.data?.find((x) => x.id === id);
    return i ? `${i.name} ${i.version}` : id;
  };
  const canSave = !!editing && !!preview?.valid && preview.snapshot === JSON.stringify(editing.input) && preview.diff.length > 0;

  return (
    <>
      <div className="page-head row between">
        <div>
          <h1>Presets</h1>
          <p className="muted">Descriptive study configurations. Saving never edits in place: every change becomes a new version.</p>
        </div>
        <button
          className="primary"
          disabled={!!editing}
          onClick={() => setEditing({ input: { ...DEFAULT, guest: { ...DEFAULT.guest, imageId: images.data?.[0]?.id ?? '' } } })}
        >
          New preset
        </button>
      </div>
      <ErrorBox error={presets.error ?? act.error} onClose={() => act.setError(null)} />

      {editing && (
        <Section title={editing.baseId ? 'Edit preset (creates a new version)' : 'New preset'}>
          <div className="form-grid">
            <Field label="Name" hint="Descriptive, e.g. “Linux desktop study A”. Not a laptop model.">
              <input value={editing.input.name} onChange={(e) => update((p) => ({ ...p, name: e.target.value }))} />
            </Field>
            <Field label="Base image">
              <select value={editing.input.guest.imageId} onChange={(e) => {
                const img = images.data?.find((i) => i.id === e.target.value);
                update((p) => ({ ...p, guest: { imageId: e.target.value, os: img?.guestOs ?? p.guest.os, arch: img?.guestArch ?? p.guest.arch } }));
              }}>
                <option value="">— choose —</option>
                {images.data?.map((i) => <option key={i.id} value={i.id}>{i.name} {i.version} ({i.guestOs}/{i.guestArch})</option>)}
              </select>
            </Field>
            <Field label="Guest OS / arch" hint="Taken from the image">
              <input value={`${editing.input.guest.os} / ${editing.input.guest.arch}`} disabled />
            </Field>
            <Field label="Expected boot state">
              <select value={editing.input.expectedBootState} onChange={(e) => update((p) => ({ ...p, expectedBootState: e.target.value as PresetInput['expectedBootState'] }))}>
                <option value="desktop-login">desktop-login</option>
                <option value="desktop-autologin">desktop-autologin</option>
                <option value="console">console</option>
              </select>
            </Field>
          </div>
          <h3>Resources (virtual, not a different physical CPU)</h3>
          <div className="form-grid">
            <Field label="vCPUs"><input type="number" value={editing.input.resources.vcpus} onChange={(e) => update((p) => ({ ...p, resources: { ...p.resources, vcpus: num(e.target.value) } }))} /></Field>
            <Field label="Memory (MB)"><input type="number" value={editing.input.resources.memoryMb} onChange={(e) => update((p) => ({ ...p, resources: { ...p.resources, memoryMb: num(e.target.value) } }))} /></Field>
            <Field label="Disk (GB)"><input type="number" value={editing.input.resources.diskGb} onChange={(e) => update((p) => ({ ...p, resources: { ...p.resources, diskGb: num(e.target.value) } }))} /></Field>
            <Field label="Display width"><input type="number" value={editing.input.display.width} onChange={(e) => update((p) => ({ ...p, display: { ...p.display, width: num(e.target.value) } }))} /></Field>
            <Field label="Display height"><input type="number" value={editing.input.display.height} onChange={(e) => update((p) => ({ ...p, display: { ...p.display, height: num(e.target.value) } }))} /></Field>
          </div>
          <h3>Regional and network</h3>
          <div className="form-grid">
            <Field label="Time zone (IANA)" hint="Set inside the guest OS; verified from guest and browser reports">
              <input value={editing.input.regional.timeZone} onChange={(e) => update((p) => ({ ...p, regional: { ...p.regional, timeZone: e.target.value } }))} />
            </Field>
            <Field label="Locale (BCP 47)"><input value={editing.input.regional.locale} onChange={(e) => update((p) => ({ ...p, regional: { ...p.regional, locale: e.target.value } }))} /></Field>
            <Field label="Network exit" hint="default-nat shares the host’s public exit">
              <select value={editing.input.network.routeId} onChange={(e) => update((p) => ({ ...p, network: { routeId: e.target.value } }))}>
                {exits.data?.map((x) => <option key={x.id} value={x.id}>{x.id}{x.approvedAt ? '' : ' (not approved)'}</option>)}
              </select>
            </Field>
          </div>
          <h3>Host constraint</h3>
          <div className="form-grid">
            <Field label="Host arch (comma-separated)"><input value={editing.input.hostConstraint.arch.join(',')} onChange={(e) => update((p) => ({ ...p, hostConstraint: { ...p.hostConstraint, arch: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) as PresetInput['hostConstraint']['arch'] } }))} /></Field>
            <Field label="Host OS (comma-separated)"><input value={editing.input.hostConstraint.os.join(',')} onChange={(e) => update((p) => ({ ...p, hostConstraint: { ...p.hostConstraint, os: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) as PresetInput['hostConstraint']['os'] } }))} /></Field>
            <Field label="Min host RAM (MB)"><input type="number" value={editing.input.hostConstraint.minHostRamMb} onChange={(e) => update((p) => ({ ...p, hostConstraint: { ...p.hostConstraint, minHostRamMb: num(e.target.value) } }))} /></Field>
          </div>
          <Field label="Description"><textarea value={editing.input.description} onChange={(e) => update((p) => ({ ...p, description: e.target.value }))} /></Field>

          {preview && (
            <div style={{ marginTop: 12 }}>
              {!preview.valid && <div className="error"><strong>Not valid:</strong><ul>{preview.issues.map((i) => <li key={i}>{i}</li>)}</ul></div>}
              {preview.valid && preview.diff.length === 0 && <div className="notice">No changes compared with the current version.</div>}
              {preview.valid && preview.diff.length > 0 && (
                <>
                  <h3>Change preview</h3>
                  <table>
                    <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
                    <tbody>{preview.diff.map((d) => (
                      <tr key={d.path}><td><code>{d.path}</code></td><td><code>{JSON.stringify(d.before) ?? '—'}</code></td><td><code>{JSON.stringify(d.after)}</code></td></tr>
                    ))}</tbody>
                  </table>
                </>
              )}
            </div>
          )}
          <div className="row gap" style={{ marginTop: 12 }}>
            <button onClick={doPreview} disabled={!!act.busy}>Preview changes</button>
            <button className="primary" onClick={doSave} disabled={!canSave || !!act.busy} title={canSave ? '' : 'Preview the exact changes first'}>
              Apply {editing.baseId ? 'as new version' : ''}
            </button>
            <button className="link" onClick={() => { setEditing(null); setPreview(null); }}>Cancel</button>
          </div>
        </Section>
      )}

      <Section title="Saved presets">
        {presets.data?.length === 0 && <p className="muted">No presets yet. Register an image first, then create a preset.</p>}
        {presets.data?.map((p) => {
          const c = checks[p.id];
          return (
            <div key={p.id} className="card" style={{ marginBottom: 8 }}>
              <div className="row between wrap gap">
                <div>
                  <strong>{p.name}</strong> <Pill tone="muted">v{p.version}</Pill>{' '}
                  <span className="muted">
                    {p.guest.os}/{p.guest.arch} · {p.resources.vcpus} vCPU · {p.resources.memoryMb} MB · {p.display.width}×{p.display.height} · {p.regional.timeZone} · {p.regional.locale} · {p.network.routeId}
                  </span>
                  <div className="hint">Image: {imageName(p.guest.imageId)} · saved {fmtTime(p.createdAt)}</div>
                </div>
                <div className="row gap">
                  <button onClick={() => doCheck(p.id)} disabled={!!act.busy}>Check launch prerequisites</button>
                  <button onClick={() => { setEditing({ baseId: p.id, input: toInput(p) }); setPreview(null); }} disabled={!!editing}>Edit</button>
                </div>
              </div>
              {c && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ marginBottom: 6 }}>{c.launchable ? <Pill tone="ok">Launchable on this host</Pill> : <Pill tone="bad">Launch blocked</Pill>}</div>
                  {c.checks.map((ch) => (
                    <div className="check" key={ch.id}>
                      <Pill tone={ch.pass ? 'ok' : 'bad'}>{ch.pass ? 'pass' : 'fail'}</Pill>
                      <span>{ch.label} <span className="muted">— {ch.detail}</span></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Section>
    </>
  );
}
