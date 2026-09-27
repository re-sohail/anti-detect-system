import { useQuery } from '../api';
import { ErrorBox, Pill, Section, fmtMb, fmtTime } from '../ui';

export function HostScreen() {
  const caps = useQuery('host.probe', undefined);
  const guests = useQuery('guests.list', undefined);
  const presets = useQuery('presets.list', undefined);
  const c = caps.data;
  const running = (guests.data ?? []).filter((g) => ['running', 'paused', 'starting'].includes(g.state));
  const committed = running.reduce(
    (s, g) => s + (presets.data?.find((p) => p.id === g.presetId)?.resources.memoryMb ?? 0),
    0,
  );
  const qemu = c?.backends[0];

  return (
    <>
      <div className="page-head row between">
        <div>
          <h1>Host capacity</h1>
          <p className="muted">Measured on this machine. The guest catalogue is derived from these checks, not assumed.</p>
        </div>
        <button onClick={() => { void caps.reload(); void guests.reload(); }} disabled={caps.loading}>Re-probe</button>
      </div>
      <ErrorBox error={caps.error} />
      {c && (
        <>
          <div className="grid2">
            <Section title="Host">
              <dl className="kv">
                <dt>Study host ID</dt><dd><code>{c.hostId}</code></dd>
                <dt>OS</dt><dd>{c.os} · {c.osRelease}</dd>
                <dt>Architecture</dt><dd>{c.arch}</dd>
                <dt>CPU</dt><dd>{c.cpuModel} ({c.cpuCount} logical)</dd>
                <dt>Probed</dt><dd>{fmtTime(c.probedAt)}</dd>
              </dl>
            </Section>
            <Section title="Virtualization">
              <dl className="kv">
                <dt>Hypervisor</dt>
                <dd>{c.hypervisor.available ? <Pill tone="ok">{c.hypervisor.kind}</Pill> : <Pill tone="bad">unavailable</Pill>} <span className="muted">{c.hypervisor.detail}</span></dd>
                <dt>QEMU</dt>
                <dd>{qemu?.available ? <Pill tone="ok">installed</Pill> : <Pill tone="bad">missing</Pill>} <span className="muted">{qemu?.version ?? ''}</span></dd>
                <dt>Guest arch</dt>
                <dd>{c.supportedGuestArch.length ? c.supportedGuestArch.join(', ') : <span className="muted">none launchable on this host</span>}</dd>
              </dl>
              {!qemu?.available && <div className="notice" style={{ marginTop: 12 }}>{qemu?.detail}</div>}
            </Section>
          </div>
          <Section title="Capacity">
            <div className="grid2">
              <div>
                <strong>Memory</strong>
                <div className="meter"><span style={{ width: `${Math.min(100, ((c.totalMemMb - c.freeMemMb) / c.totalMemMb) * 100)}%` }} /></div>
                <div className="muted">
                  {fmtMb(c.totalMemMb)} total · {fmtMb(c.freeMemMb)} available now · {fmtMb(committed)} allocated to {running.length} active guest(s) · 2.0 GB reserved for host
                </div>
              </div>
              <div>
                <strong>Disk (data folder)</strong>
                <div className="muted">{fmtMb(c.freeDiskMb)} free</div>
                <div className="hint"><code>{c.dataDir}</code></div>
              </div>
            </div>
          </Section>
        </>
      )}
    </>
  );
}
