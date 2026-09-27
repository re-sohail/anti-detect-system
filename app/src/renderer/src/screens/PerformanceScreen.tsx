import { useState } from 'react';
import type { Stat } from '@common/ipc';
import { call, useAction, useQuery } from '../api';
import { ErrorBox, Section, fmtTime } from '../ui';

const fmt = (s: Stat, unit: string, scale = 1) =>
  s.n === 0 ? <span className="muted">no data</span> : (
    <span>
      {((s.median ?? 0) / scale).toFixed(1)} {unit}
      <span className="hint"> · p90 {((s.p90 ?? 0) / scale).toFixed(1)} · p95 {((s.p95 ?? 0) / scale).toFixed(1)} · n={s.n}</span>
    </span>
  );

export function PerformanceScreen() {
  const report = useQuery('perf.report', undefined);
  const act = useAction();
  const [saved, setSaved] = useState<string | null>(null);
  const r = report.data;
  return (
    <>
      <div className="page-head row between">
        <div>
          <h1>Performance</h1>
          <p className="muted">Sampled every 5 s while guests run. Medians with p90/p95 tails; a single run is not a benchmark.</p>
        </div>
        <div className="row gap">
          <button onClick={() => void report.reload()}>Refresh</button>
          <button className="primary" disabled={!!act.busy} onClick={async () => {
            const x = await act.run('export', () => call('perf.export', undefined));
            if (x) setSaved(x.file);
          }}>Export report + raw samples</button>
        </div>
      </div>
      <ErrorBox error={report.error ?? act.error} onClose={() => act.setError(null)} />
      {saved && <div className="notice">Saved <code>{saved}</code></div>}
      {r && (
        <Section title={`Host ${r.hostId} · generated ${fmtTime(r.generatedAt)} · max simultaneous guests observed: ${r.maxConcurrentGuests}`}>
          {r.guests.length === 0 && <p className="muted">No guests yet.</p>}
          {!!r.guests.length && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Guest</th><th>Starts</th><th>Start → control</th><th>Start → desktop</th><th>Start → browser</th><th>Idle RSS</th><th>Active RSS</th><th>CPU</th><th>Disk growth</th><th>Power / thermal</th></tr>
                </thead>
                <tbody>
                  {r.guests.map((g) => (
                    <tr key={g.guestId}>
                      <td>{g.name}<div className="hint">{g.samples} samples</div></td>
                      <td>{g.starts}</td>
                      <td>{fmt(g.controlReadyMs, 's', 1000)}</td>
                      <td>{fmt(g.desktopReadyMs, 's', 1000)}</td>
                      <td>{fmt(g.browserLaunchMs, 's', 1000)}</td>
                      <td>{fmt(g.idleRssMb, 'MB')}</td>
                      <td>{fmt(g.activeRssMb, 'MB')}</td>
                      <td>{fmt(g.cpuPct, '%')}</td>
                      <td>{g.diskGrowthMb === null ? <span className="muted">no data</span> : `${g.diskGrowthMb} MB`}</td>
                      <td>{g.powerSources.join(', ') || '—'}<div className="hint">{g.thermalStates.join(', ')}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint" style={{ marginTop: 10 }}>{r.note}</p>
        </Section>
      )}
    </>
  );
}
