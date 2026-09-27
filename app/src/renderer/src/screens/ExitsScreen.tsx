import { useState } from 'react';
import type { NetworkExit } from '@lvd/shared';
import { call, useAction, useQuery } from '../api';
import { ErrorBox, Field, Pill, Section, Unknown, fmtTime } from '../ui';

type Draft = Omit<NetworkExit, 'approvedAt' | 'lastTest'>;
const EMPTY: Draft = { id: '', kind: 'university-proxy', owner: '', locationClaim: '', networkType: '', proxyUrl: '', expectedIp: '', approvedBy: '', notes: '' };

export function ExitsScreen() {
  const exits = useQuery('exits.list', undefined);
  const settings = useQuery('settings.get', undefined);
  const act = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => draft && setDraft({ ...draft, [k]: e.target.value });

  const save = async () => {
    if (!draft) return;
    const r = await act.run('save', () => call('exits.save', { ...draft, proxyUrl: draft.proxyUrl || null, expectedIp: draft.expectedIp || null }));
    if (r) {
      setDraft(null);
      void exits.reload();
    }
  };
  const doAct = async (label: string, fn: () => Promise<unknown>) => {
    await act.run(label, fn);
    void exits.reload();
  };

  return (
    <>
      <div className="page-head row between">
        <div>
          <h1>Network exits</h1>
          <p className="muted">
            Every route has an owner, a location claim and a server-observed test. A claimed region is never inferred from a timezone or private address. Changing an exit revokes its approval.
          </p>
        </div>
        <button className="primary" disabled={!!draft} onClick={() => setDraft(EMPTY)}>Register exit</button>
      </div>
      <ErrorBox error={exits.error ?? act.error} onClose={() => act.setError(null)} />
      {draft && (
        <Section title="Register or edit an exit">
          <div className="form-grid">
            <Field label="ID" hint="lowercase, e.g. uni-proxy-a"><input value={draft.id} onChange={set('id')} /></Field>
            <Field label="Kind">
              <select value={draft.kind} onChange={set('kind')}>
                <option value="university-proxy">university-proxy</option>
                <option value="default-nat">default-nat</option>
              </select>
            </Field>
            <Field label="Owner"><input value={draft.owner} onChange={set('owner')} placeholder="University IT, network team" /></Field>
            <Field label="Location claim"><input value={draft.locationClaim} onChange={set('locationClaim')} /></Field>
            <Field label="Network type"><input value={draft.networkType} onChange={set('networkType')} placeholder="campus wired, mobile, residential…" /></Field>
            <Field label="Proxy URL" hint="Guest browser is pinned to it by policy"><input value={draft.proxyUrl ?? ''} onChange={set('proxyUrl')} placeholder="http://proxy.uni.example:3128" /></Field>
            <Field label="Expected public IP" hint="Required for proxy exits; checked on every visit"><input value={draft.expectedIp ?? ''} onChange={set('expectedIp')} /></Field>
          </div>
          <Field label="Notes (cost, availability, IT ticket)"><textarea value={draft.notes} onChange={set('notes')} /></Field>
          <div className="row gap" style={{ marginTop: 12 }}>
            <button className="primary" onClick={save} disabled={!draft.id || !draft.owner || !!act.busy}>Save</button>
            <button className="link" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </Section>
      )}
      <Section title="Registry">
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Kind</th><th>Owner / location</th><th>Expected IP</th><th>Approval</th><th>Last test</th><th /></tr></thead>
            <tbody>
              {exits.data?.map((x) => (
                <tr key={x.id}>
                  <td><code>{x.id}</code></td>
                  <td>{x.kind}{x.proxyUrl && <div className="hint">{x.proxyUrl}</div>}</td>
                  <td>{x.owner}<div className="hint">{x.locationClaim} · {x.networkType}</div></td>
                  <td><Unknown value={x.expectedIp} /></td>
                  <td>{x.approvedAt ? <><Pill tone="ok">approved</Pill><div className="hint">{x.approvedBy}, {fmtTime(x.approvedAt)}</div></> : <Pill tone="warn">not approved</Pill>}</td>
                  <td>{x.lastTest ? <><Pill tone={x.lastTest.ok ? 'ok' : 'bad'}>{x.lastTest.ok ? 'ok' : 'failed'}</Pill> <Unknown value={x.lastTest.observedIp} /><div className="hint">{x.lastTest.detail} · {fmtTime(x.lastTest.at)}</div></> : <span className="muted">never</span>}</td>
                  <td>
                    <div className="row gap wrap">
                      <button disabled={!!act.busy} onClick={() => doAct('test', () => call('exits.test', { id: x.id }))}>Test</button>
                      {x.id !== 'default-nat' && <button disabled={!!act.busy || !!draft} onClick={() => setDraft({ ...x, proxyUrl: x.proxyUrl ?? '', expectedIp: x.expectedIp ?? '' })}>Edit</button>}
                      {!x.approvedAt && (
                        <button disabled={!!act.busy} onClick={() => doAct('approve', () => call('exits.approve', { id: x.id, approvedBy: settings.data?.operator || 'operator' }))}>
                          Record approval
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
