import { useState } from 'react';
import { ENVIRONMENT_KINDS, TREATMENTS, type EnvironmentKind, type RunStatus, type Treatment } from '@lvd/shared';
import type { RunDetail } from '@common/ipc';
import { call, useAction, useQuery } from '../api';
import { ErrorBox, Field, Pill, Section, Unknown, fmtTime } from '../ui';

const STATUS_TONE: Record<RunStatus, 'ok' | 'warn' | 'bad' | 'muted' | 'info'> = {
  planned: 'muted', running: 'info', complete: 'ok', interrupted: 'warn', invalid: 'bad',
};

export function RunsScreen() {
  const runs = useQuery('runs.list', undefined);
  const guests = useQuery('guests.list', undefined);
  const consents = useQuery('consents.list', undefined);
  const exits = useQuery('exits.list', undefined);
  const act = useAction();
  const [kind, setKind] = useState<EnvironmentKind>('managed-guest');
  const [guestId, setGuestId] = useState<string>('');
  const [label, setLabel] = useState('');
  const [consentId, setConsentId] = useState('');
  const [routeId, setRouteId] = useState('default-nat');
  const [product, setProduct] = useState({ name: '', edition: '', version: '', configuration: 'default', vendorUrl: '', lawfulAccess: '', embeddedEngine: '' });
  const [treatment, setTreatment] = useState<Treatment>('PILOT');
  const [notes, setNotes] = useState('');
  const [placeToken, setPlaceToken] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const needsProduct = kind === 'vendor-product' || kind === 'device-cloud';
  const guestName = guests.data?.find((g) => g.id === guestId)?.name ?? '';
  const ready =
    (kind === 'managed-guest' ? !!guestId : !!label.trim()) &&
    (kind !== 'physical-control' || !!consentId) &&
    (!needsProduct || (!!product.name && !!product.version && !!product.lawfulAccess));

  const start = async () => {
    const r = await act.run('start', () =>
      call('runs.start', {
        guestId: kind === 'managed-guest' ? guestId : null,
        treatment,
        notes,
        routeId: kind === 'managed-guest' ? undefined : routeId,
        placeStudyToken: placeToken,
        environment: {
          kind,
          label: kind === 'managed-guest' ? label.trim() || guestName : label.trim(),
          consentId: kind === 'physical-control' ? consentId : null,
          product: needsProduct ? { ...product, embeddedEngine: product.embeddedEngine || undefined } : null,
        },
      }),
    );
    void runs.reload();
    if (r) {
      setNotes('');
      setOpenId(r.id);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Runs & compare</h1>
        <p className="muted">
          A run's manifest is written and hashed before its token is registered with the collector. A run is complete only when the guest agent, the browser page and the server all recorded it.
        </p>
      </div>
      <ErrorBox error={runs.error ?? act.error} onClose={() => act.setError(null)} />

      <Section title="Start a run">
        <div className="form-grid">
          <Field label="Environment type">
            <select value={kind} onChange={(e) => setKind(e.target.value as EnvironmentKind)}>
              {(Object.keys(ENVIRONMENT_KINDS) as EnvironmentKind[]).map((k) => <option key={k} value={k}>{ENVIRONMENT_KINDS[k]}</option>)}
            </select>
          </Field>
          {kind === 'managed-guest' ? (
            <Field label="Guest">
              <select value={guestId} onChange={(e) => setGuestId(e.target.value)}>
                <option value="">— choose —</option>
                {guests.data?.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.state}, condition #{g.conditionSeq})</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Route (exit registry)">
              <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
                {exits.data?.map((x) => <option key={x.id} value={x.id} disabled={!x.approvedAt}>{x.id}{x.approvedAt ? '' : ' (not approved)'}</option>)}
              </select>
            </Field>
          )}
          <Field label="Internal label" hint="e.g. “profile B”, “control laptop 3”. Never shown to the blue team.">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === 'managed-guest' ? guestName || 'defaults to guest name' : ''} />
          </Field>
          {kind === 'physical-control' && (
            <Field label="Consent record">
              <select value={consentId} onChange={(e) => setConsentId(e.target.value)}>
                <option value="">— choose —</option>
                {consents.data?.filter((c) => !c.withdrawnAt).map((c) => <option key={c.id} value={c.id}>{c.participantCode} — {c.machineDescription}</option>)}
              </select>
            </Field>
          )}
          <Field label="Treatment">
            <select value={treatment} onChange={(e) => setTreatment(e.target.value as Treatment)}>
              {(Object.keys(TREATMENTS) as Treatment[]).map((t) => <option key={t} value={t}>{t} — {TREATMENTS[t]}</option>)}
            </select>
          </Field>
        </div>
        {needsProduct && (
          <>
            <h3>Product under test (competitor protocol, brief §15)</h3>
            <div className="form-grid">
              <Field label="Product name"><input value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} /></Field>
              <Field label="Edition"><input value={product.edition} onChange={(e) => setProduct({ ...product, edition: e.target.value })} /></Field>
              <Field label="Version"><input value={product.version} onChange={(e) => setProduct({ ...product, version: e.target.value })} /></Field>
              <Field label="Configuration" hint="Use the vendor default unless the protocol says otherwise"><input value={product.configuration} onChange={(e) => setProduct({ ...product, configuration: e.target.value })} /></Field>
              <Field label="Vendor URL for claims"><input value={product.vendorUrl} onChange={(e) => setProduct({ ...product, vendorUrl: e.target.value })} /></Field>
              <Field label="Embedded browser engine" hint="If shown by the product"><input value={product.embeddedEngine} onChange={(e) => setProduct({ ...product, embeddedEngine: e.target.value })} /></Field>
            </div>
            <Field label="Lawful access basis" hint="Licence / trial terms permitting research use; runs without one must not be recorded">
              <input value={product.lawfulAccess} onChange={(e) => setProduct({ ...product, lawfulAccess: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Notes (deviations, conditions)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <label className="row gap" style={{ marginTop: 10 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={placeToken} onChange={(e) => setPlaceToken(e.target.checked)} />
          <span>Plant the benign storage token on this visit (R1 isolation test)</span>
        </label>
        <div style={{ marginTop: 12 }}>
          <button className="primary" disabled={!ready || !!act.busy} onClick={start}>{act.busy === 'start' ? 'Writing manifest and registering…' : 'Start run'}</button>
        </div>
      </Section>

      <Section title="Runs">
        {runs.data?.length === 0 && <p className="muted">No runs yet.</p>}
        {!!runs.data?.length && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Run</th><th>Treatment</th><th>Environment</th><th>Status</th><th>Created</th><th /></tr></thead>
              <tbody>
                {runs.data.map((r) => (
                  <tr key={r.id}>
                    <td><code>{r.id}</code></td>
                    <td>{r.treatment}</td>
                    <td>{r.guestId ? guests.data?.find((g) => g.id === r.guestId)?.name ?? r.guestId : 'external'}</td>
                    <td><Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>{r.statusReason && <div className="hint">{r.statusReason}</div>}</td>
                    <td>{fmtTime(r.createdAt)}</td>
                    <td><button className="link" onClick={() => setOpenId(openId === r.id ? null : r.id)}>{openId === r.id ? 'Close' : 'Open'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {openId && <RunPanel key={openId} id={openId} onChanged={() => void runs.reload()} />}
    </>
  );
}

function RunPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const d = useQuery('runs.detail', { id });
  const act = useAction();
  const [exported, setExported] = useState<string | null>(null);
  const detail = d.data as RunDetail | null;

  return (
    <Section
      title={`Run ${id}`}
      actions={<>
        <button onClick={() => void d.reload()} disabled={d.loading}>Refresh</button>
        {detail?.run.status === 'running' && (
          <button className="primary" disabled={!!act.busy} onClick={async () => {
            await act.run('finish', () => call('runs.finish', { id }));
            onChanged();
            void d.reload();
          }}>Finish and verify</button>
        )}
        <button disabled={!!act.busy} onClick={async () => {
          const r = await act.run('export', () => call('runs.export', { id }));
          if (r) setExported(r.dir);
        }}>Export bundle</button>
      </>}
    >
      <ErrorBox error={d.error ?? act.error} onClose={() => act.setError(null)} />
      {exported && <div className="notice">Exported with SHA256SUMS to <code>{exported}</code></div>}
      {detail && (
        <>
          {detail.collectorError && <div className="error">Collector: {detail.collectorError.message}</div>}
          <div className="grid2">
            <dl className="kv">
              <dt>Status</dt><dd><Pill tone={STATUS_TONE[detail.run.status]}>{detail.run.status}</Pill> {detail.run.statusReason}</dd>
              <dt>Treatment</dt><dd>{detail.run.treatment}</dd>
              <dt>Environment</dt><dd>{detail.manifest.environment.kind} · {detail.manifest.environment.label}{detail.manifest.environment.product ? ` · ${detail.manifest.environment.product.name} ${detail.manifest.environment.product.version}` : ''}</dd>
              <dt>Route</dt><dd>{detail.manifest.network.routeId}{detail.manifest.network.exit?.expectedIp ? ` (expects ${detail.manifest.network.exit.expectedIp})` : ''}</dd>
              <dt>Visits / guest reports</dt><dd>{detail.visitCount} / {detail.guestReportCount}</dd>
              <dt>Manifest SHA-256</dt><dd><code>{detail.run.manifestSha256}</code></dd>
            </dl>
            <dl className="kv">
              <dt>Study URL (host)</dt><dd><code>{detail.run.studyUrl}</code></dd>
              <dt>Study URL (in guest)</dt><dd><code>{detail.run.guestStudyUrl}</code></dd>
              <dt>Guest agent</dt><dd><code>python3 lvd-agent.py --collector {new URL(detail.run.guestStudyUrl).origin} --run-token {detail.run.runToken}</code></dd>
              <dt>Instrument</dt><dd>v{detail.manifest.software.instrumentVersion} · backend {detail.manifest.software.backendVersion}</dd>
            </dl>
          </div>

          <h3>Selected vs guest-reported vs browser-reported vs server-observed</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Property</th><th>Selected</th><th>Guest reported</th><th>Browser reported</th><th>Server observed</th><th /></tr></thead>
              <tbody>
                {detail.compare.map((r) => (
                  <tr key={r.key} className={r.mismatch ? 'mismatch' : ''}>
                    <td>{r.label}</td>
                    <td><Unknown value={r.selected} /></td>
                    <td><Unknown value={r.guestReported} /></td>
                    <td><Unknown value={r.browserReported} /></td>
                    <td><Unknown value={r.serverObserved} /></td>
                    <td>{r.mismatch && <Pill tone="warn">mismatch (kept as data)</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Network checks</h3>
          {detail.networkChecks.length === 0 ? <p className="muted">None yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>At</th><th>Phase</th><th>Route</th><th>Observed</th><th>Expected</th><th>Verdict</th><th>Reason</th></tr></thead>
                <tbody>
                  {detail.networkChecks.map((c, i) => (
                    <tr key={i}>
                      <td>{fmtTime(c.at)}</td><td>{c.phase}</td><td>{c.routeId}</td>
                      <td><Unknown value={c.observedIp} /></td><td><Unknown value={c.expectedIp} /></td>
                      <td><Pill tone={c.verdict === 'valid' ? 'ok' : c.verdict === 'invalid' ? 'bad' : 'muted'}>{c.verdict}</Pill></td>
                      <td className="muted">{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
