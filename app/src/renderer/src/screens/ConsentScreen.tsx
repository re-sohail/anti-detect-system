import { useState } from 'react';
import { call, useAction, useQuery } from '../api';
import { ErrorBox, Field, Pill, Section } from '../ui';

const EMPTY = { participantCode: '', machineDescription: '', consentFormVersion: 'v1', signedAt: new Date().toISOString().slice(0, 10), obtainedBy: '', notes: '' };

export function ConsentScreen() {
  const consents = useQuery('consents.list', undefined);
  const act = useAction();
  const [draft, setDraft] = useState(EMPTY);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <>
      <div className="page-head">
        <h1>Consent register</h1>
        <p className="muted">
          Physical control runs require an active consent record. Only a pseudonymous participant code is stored here; the code-to-name key stays with the consent officer.
        </p>
      </div>
      <ErrorBox error={consents.error ?? act.error} onClose={() => act.setError(null)} />
      <Section title="Record signed consent">
        <div className="form-grid">
          <Field label="Participant code" hint="e.g. P-01"><input value={draft.participantCode} onChange={set('participantCode')} /></Field>
          <Field label="Machine description" hint="Hardware and OS, as consented"><input value={draft.machineDescription} onChange={set('machineDescription')} /></Field>
          <Field label="Consent form version"><input value={draft.consentFormVersion} onChange={set('consentFormVersion')} /></Field>
          <Field label="Signed on"><input type="date" value={draft.signedAt} onChange={set('signedAt')} /></Field>
          <Field label="Obtained by"><input value={draft.obtainedBy} onChange={set('obtainedBy')} /></Field>
        </div>
        <Field label="Notes"><textarea value={draft.notes} onChange={set('notes')} /></Field>
        <button className="primary" style={{ marginTop: 12 }} disabled={!draft.participantCode || !draft.machineDescription || !draft.obtainedBy || !!act.busy} onClick={async () => {
          const r = await act.run('save', () => call('consents.save', draft));
          if (r) {
            setDraft(EMPTY);
            void consents.reload();
          }
        }}>Save</button>
      </Section>
      <Section title="Records">
        {consents.data?.length === 0 && <p className="muted">None yet.</p>}
        {!!consents.data?.length && (
          <table>
            <thead><tr><th>Participant</th><th>Machine</th><th>Form</th><th>Signed</th><th>Obtained by</th><th>Status</th><th /></tr></thead>
            <tbody>
              {consents.data.map((c) => (
                <tr key={c.id}>
                  <td><code>{c.participantCode}</code></td><td>{c.machineDescription}</td><td>{c.consentFormVersion}</td>
                  <td>{c.signedAt}</td><td>{c.obtainedBy}</td>
                  <td>{c.withdrawnAt ? <Pill tone="bad">withdrawn {c.withdrawnAt}</Pill> : <Pill tone="ok">active</Pill>}</td>
                  <td>{!c.withdrawnAt && <button className="danger" disabled={!!act.busy} onClick={async () => {
                    await act.run('withdraw', () => call('consents.withdraw', { id: c.id }));
                    void consents.reload();
                  }}>Record withdrawal</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}
