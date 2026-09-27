import { useEffect, useState } from 'react';
import { call, useAction, useQuery } from '../api';
import { ErrorBox, Field, Pill, Section } from '../ui';

export function SettingsScreen() {
  const s = useQuery('settings.get', undefined);
  const act = useAction();
  const [collectorUrl, setUrl] = useState('');
  const [operator, setOperator] = useState('');
  const [adminKey, setKey] = useState('');
  const [port, setPort] = useState(4180);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (s.data) {
      setUrl(s.data.collectorUrl);
      setOperator(s.data.operator);
      setPort(s.data.provisionPort);
    }
  }, [s.data]);

  const save = async () => {
    setSaved(false);
    const r = await act.run('save', () => call('settings.set', { collectorUrl, operator, provisionPort: port, ...(adminKey ? { adminKey } : {}) }));
    if (r) {
      setKey('');
      setSaved(true);
      void s.reload();
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="muted">The app talks only to this collector. There is no fallback route.</p>
      </div>
      <ErrorBox error={s.error ?? act.error} />
      <Section title="University test service">
        <div className="form-grid">
          <Field label="Collector URL" hint="University-controlled service (development: http://localhost:4100)">
            <input value={collectorUrl} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field label="Operator name" hint="Recorded as the actor on every audit event">
            <input value={operator} onChange={(e) => setOperator(e.target.value)} />
          </Field>
          <Field label="Collector admin key" hint="Stored encrypted with the OS keychain; never shown again">
            <input type="password" value={adminKey} placeholder={s.data?.hasAdminKey ? '•••••• (set)' : 'not set (dev key used in development)'} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <Field label="Guest provisioning port" hint="Loopback only; guests reach it at 10.0.2.2. Takes effect after restart.">
            <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
          </Field>
        </div>
        <div className="row gap">
          <button className="primary" onClick={save} disabled={!!act.busy}>Save</button>
          {saved && <Pill tone="ok">Saved</Pill>}
        </div>
      </Section>
    </>
  );
}
