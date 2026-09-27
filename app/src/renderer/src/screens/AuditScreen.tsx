import { useQuery } from '../api';
import { ErrorBox, Pill, Section, fmtTime } from '../ui';

export function AuditScreen() {
  const audit = useQuery('audit.list', { limit: 500 });
  return (
    <>
      <div className="page-head row between">
        <div>
          <h1>Audit log</h1>
          <p className="muted">Append-only. Every action, successful or failed, with its actor and normalised error.</p>
        </div>
        <button onClick={() => void audit.reload()}>Refresh</button>
      </div>
      <ErrorBox error={audit.error} />
      <Section title="Latest 500 events">
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>At</th><th>Actor</th><th>Action</th><th>Target</th><th>Outcome</th><th>Detail</th></tr></thead>
            <tbody>
              {audit.data?.map((e) => (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>{fmtTime(e.at)}</td>
                  <td>{e.actor}</td>
                  <td><code>{e.action}</code></td>
                  <td><code>{e.target ?? '—'}</code></td>
                  <td><Pill tone={e.outcome === 'ok' ? 'ok' : 'bad'}>{e.outcome}</Pill></td>
                  <td><code style={{ wordBreak: 'break-all' }}>{e.detail ? JSON.stringify(e.detail).slice(0, 240) : ''}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
