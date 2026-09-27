import { statSync } from 'node:fs';
import type { Ctx } from './context';
import { run } from './exec';

/**
 * Performance measurement (brief §11, plan Phase 9). Samples each running guest's hypervisor
 * process (RSS, CPU), its disk growth, and the host's power source and thermal state.
 * Reports medians and tails, never a single best run.
 */

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export interface Stat {
  n: number;
  median: number | null;
  p90: number | null;
  p95: number | null;
  max: number | null;
}

export function stat(values: number[]): Stat {
  return {
    n: values.length,
    median: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    max: values.length ? Math.max(...values) : null,
  };
}

async function hostPower(): Promise<{ power: string | null; thermal: string | null }> {
  if (process.platform !== 'darwin') return { power: null, thermal: null };
  const [b, t] = await Promise.all([run('/usr/bin/pmset', ['-g', 'batt']), run('/usr/bin/pmset', ['-g', 'therm'])]);
  const power = b.stdout.match(/drawing from '([^']+)'/)?.[1] ?? null;
  const limit = t.stdout.match(/CPU_Speed_Limit\s*=\s*(\d+)/)?.[1];
  const thermal = limit ? `cpu-speed-limit=${limit}` : /No thermal warning/i.test(t.stdout) ? 'no-warning' : null;
  return { power, thermal };
}

async function procUsage(pid: number): Promise<{ rssMb: number | null; cpuPct: number | null }> {
  if (process.platform === 'win32') return { rssMb: null, cpuPct: null };
  const r = await run('/bin/ps', ['-o', 'rss=,%cpu=', '-p', String(pid)]);
  const [rss, cpu] = r.stdout.trim().split(/\s+/).map(Number);
  return { rssMb: Number.isFinite(rss) ? Math.round((rss / 1024) * 10) / 10 : null, cpuPct: Number.isFinite(cpu) ? cpu : null };
}

function allocatedMb(p: string): number | null {
  try {
    const s = statSync(p);
    return Math.round(((s.blocks ?? 0) * 512) / 1024 / 1024);
  } catch {
    return null;
  }
}

export class PerfSampler {
  private timer: NodeJS.Timeout | null = null;
  private hostState: { at: number; power: string | null; thermal: string | null } = { at: 0, power: null, thermal: null };

  constructor(private ctx: Ctx, private intervalMs = 5000) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const active = this.ctx.db.listGuests().filter((g) => g.pid && (g.state === 'running' || g.state === 'paused'));
    if (active.length === 0) return;
    if (Date.now() - this.hostState.at > 60_000) this.hostState = { at: Date.now(), ...(await hostPower()) };
    for (const g of active) {
      const u = await procUsage(g.pid!);
      if (u.rssMb === null && u.cpuPct === null) continue;
      this.ctx.db.addSample({
        guestId: g.id, conditionSeq: g.conditionSeq, rssMb: u.rssMb, cpuPct: u.cpuPct, diskMb: allocatedMb(g.diskPath),
        power: this.hostState.power, thermal: this.hostState.thermal,
      });
    }
  }
}

export interface PerfReport {
  generatedAt: string;
  hostId: string;
  guests: Array<{
    guestId: string;
    name: string;
    presetId: string;
    starts: number;
    controlReadyMs: Stat;
    desktopReadyMs: Stat;
    browserLaunchMs: Stat;
    idleRssMb: Stat;
    activeRssMb: Stat;
    cpuPct: Stat;
    diskGrowthMb: number | null;
    powerSources: string[];
    thermalStates: string[];
    samples: number;
  }>;
  maxConcurrentGuests: number;
  note: string;
}

/** Idle = samples below this CPU%; the threshold is recorded in the report. */
const IDLE_CPU = 10;

export function perfReport(ctx: Ctx): PerfReport {
  const guests = ctx.db.listGuests();
  const events = ctx.db.guestEvents();
  const samples = ctx.db.samples();

  // Pair each start with the next milestones of the same guest.
  const durations = (guestId: string, target: string) => {
    const evs = events.filter((e) => e.guestId === guestId);
    const out: number[] = [];
    evs.forEach((e, i) => {
      if (e.event !== 'start-requested') return;
      const nextStart = evs.findIndex((x, j) => j > i && x.event === 'start-requested');
      const hit = evs.find((x, j) => j > i && (nextStart < 0 || j < nextStart) && x.event === target);
      if (hit) out.push(Date.parse(hit.at) - Date.parse(e.at));
    });
    return out;
  };

  // Max simultaneous guests observed = max count of distinct guests sampled in the same 10 s bucket.
  const buckets = new Map<number, Set<string>>();
  for (const s of samples) {
    const b = Math.floor(Date.parse(s.at) / 10_000);
    if (!buckets.has(b)) buckets.set(b, new Set());
    buckets.get(b)!.add(s.guest_id);
  }

  return {
    generatedAt: new Date().toISOString(),
    hostId: ctx.hostId,
    guests: guests.map((g) => {
      const gs = samples.filter((s) => s.guest_id === g.id);
      const rss = (pred: (s: (typeof gs)[number]) => boolean) => gs.filter(pred).map((s) => s.rss_mb).filter((v): v is number => v !== null);
      const disk = gs.map((s) => s.disk_mb).filter((v): v is number => v !== null);
      return {
        guestId: g.id,
        name: g.name,
        presetId: g.presetId,
        starts: events.filter((e) => e.guestId === g.id && e.event === 'start-requested').length,
        controlReadyMs: stat(durations(g.id, 'control-ready')),
        desktopReadyMs: stat(durations(g.id, 'runner-started')),
        browserLaunchMs: stat(durations(g.id, 'browser-launched')),
        idleRssMb: stat(rss((s) => s.cpu_pct !== null && s.cpu_pct < IDLE_CPU)),
        activeRssMb: stat(rss((s) => s.cpu_pct !== null && s.cpu_pct >= IDLE_CPU)),
        cpuPct: stat(gs.map((s) => s.cpu_pct).filter((v): v is number => v !== null)),
        diskGrowthMb: disk.length >= 2 ? disk[disk.length - 1] - disk[0] : null,
        powerSources: [...new Set(gs.map((s) => s.power).filter((v): v is string => !!v))],
        thermalStates: [...new Set(gs.map((s) => s.thermal).filter((v): v is string => !!v))],
        samples: gs.length,
      };
    }),
    maxConcurrentGuests: Math.max(0, ...[...buckets.values()].map((s) => s.size)),
    note: `Idle RSS = samples with CPU < ${IDLE_CPU}%. Desktop-ready = guest runner started after autologin. Browser launch = runner opened the study page. Report medians and tails; a single run is not a benchmark.`,
  };
}
