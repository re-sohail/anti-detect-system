/**
 * Feasibility pilot (plan Phase 2), driven through the app's own services without the UI.
 *
 *   COLLECTOR_URL=http://localhost:4100 node --import tsx scripts/pilot.mts \
 *     --image /path/debian-13-generic-arm64.qcow2 --sha512 <published> --origin <url> --out /path/pilot-dir
 *
 * One guest: register + verify image, preset, guest, cloud-init provisioning, desktop, run with
 * browser visit + guest report, finish/verify, stop. Screenshots are taken via QMP at each
 * milestone. Everything measured is written to <out>/pilot-report.json; nothing is estimated.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { openDb } from '../src/main/services/db';
import { probeHost } from '../src/main/services/capabilities';
import type { Ctx } from '../src/main/services/context';
import { GuestService } from '../src/main/services/guests';
import { registerImage } from '../src/main/services/images';
import { checkPreset, savePreset } from '../src/main/services/presets';
import { RunService } from '../src/main/services/runs';
import { PerfSampler, perfReport } from '../src/main/services/perf';
import { cloudInitUserData, guestBaseUrl, readAgentSource, startProvisioningServer } from '../src/main/services/provisioning';
import { getExit } from '../src/main/services/exits';
import { qmp } from '../src/main/services/qemu';
import { CollectorClient } from '../src/main/services/collectorClient';

const { values: args } = parseArgs({
  options: {
    image: { type: 'string' },
    sha512: { type: 'string' },
    origin: { type: 'string' },
    out: { type: 'string' },
    memory: { type: 'string', default: '3072' },
    vcpus: { type: 'string', default: '2' },
    'provision-timeout-min': { type: 'string', default: '40' },
  },
});
if (!args.image || !args.out || !args.origin) {
  console.error('usage: --image FILE --origin URL --out DIR [--sha512 HEX]');
  process.exit(2);
}

const COLLECTOR = process.env.COLLECTOR_URL ?? 'http://localhost:4100';
const PORT = Number(process.env.LVD_PROVISION_PORT ?? 4181);
const out = path.resolve(args.out);
mkdirSync(out, { recursive: true });
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), collector: COLLECTOR, milestones: {} as Record<string, number> };
const t0 = Date.now();
const mark = (name: string) => {
  (report.milestones as Record<string, number>)[name] = Date.now() - t0;
  log(`milestone ${name} at +${((Date.now() - t0) / 1000).toFixed(1)} s`);
};

const dataDir = path.join(out, 'data');
const db = openDb(dataDir);
const ctx: Ctx = {
  db, dataDir, hostId: 'host_pilot', appVersion: 'pilot', electronVersion: 'n/a',
  probe: () => probeHost(dataDir, 'host_pilot'), adminKey: () => process.env.COLLECTOR_ADMIN_KEY ?? 'dev-admin-key',
  runtimeDir: `/tmp/lvd-pilot-${process.getuid?.() ?? 0}`,
};
const guests = new GuestService(ctx, () => PORT);
const runs = new RunService(ctx, guests, () => COLLECTOR);
const agentPath = path.resolve(import.meta.dirname, '../../guest-agent/lvd-agent.py');
const server = startProvisioningServer(ctx, PORT, {
  userData: (g) => {
    const preset = db.getPreset(g.presetId, g.presetVersion)!;
    return cloudInitUserData({
      guest: g, preset, exit: getExit(ctx, preset.network.routeId), collectorUrl: COLLECTOR,
      runnerBaseUrl: guestBaseUrl(PORT, g.id, g.provisioning.secret!), agentSource: readAgentSource(agentPath),
    });
  },
  currentRun: (g) => runs.openRunFor(g.id),
});
const sampler = new PerfSampler(ctx, 5000);
sampler.start();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what: string, ms: number, fn: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(3000);
  }
  throw new Error(`timed out waiting for ${what}`);
}
let shots = 0;
async function screenshot(guestId: string, label: string) {
  const file = path.join(out, `${String(++shots).padStart(2, '0')}-${label}.png`);
  try {
    await qmp(path.join(ctx.runtimeDir, `${guestId}.qmp`), 'screendump', { filename: file, format: 'png' }, 10000);
    log(`screenshot ${file}`);
  } catch (e) {
    log(`screenshot failed: ${(e as Error).message}`);
  }
}

let guestId: string | null = null;
try {
  const caps = await ctx.probe();
  report.host = { arch: caps.arch, os: caps.osRelease, cpu: caps.cpuModel, cpus: caps.cpuCount, ramMb: caps.totalMemMb, hypervisor: caps.hypervisor, qemu: caps.backends[0].version };
  log(`host ${caps.cpuModel}, ${caps.totalMemMb} MB, hypervisor ${caps.hypervisor.kind}, ${caps.backends[0].version}`);

  const tImg = Date.now();
  const img = await registerImage(ctx, args.image, {
    name: 'Debian 13 generic cloud', version: path.basename(args.image), origin: args.origin, guestOs: 'linux', guestArch: 'aarch64',
    licenseNotes: 'Debian: DFSG-free software; see https://www.debian.org/legal/licenses/', expectedSha256: args.sha512, provisioning: 'cloud-init',
  });
  report.image = { id: img.id, sha256: img.sha256, sizeBytes: img.sizeBytes, verifiedAgainst: args.sha512 ? 'published SHA-512' : 'none', registerMs: Date.now() - tImg };
  mark('image-registered');

  const preset = savePreset(ctx, {
    name: 'Linux desktop study A (pilot)', description: 'Feasibility pilot preset',
    hostConstraint: { arch: ['arm64'], os: ['darwin'], minHostRamMb: 8192, backend: 'qemu' },
    guest: { os: 'linux', arch: 'aarch64', imageId: img.id },
    resources: { vcpus: Number(args.vcpus), memoryMb: Number(args.memory), diskGb: 16 },
    display: { width: 1280, height: 800 },
    regional: { timeZone: 'Europe/London', locale: 'en-GB' },
    network: { routeId: 'default-nat' },
    expectedBootState: 'desktop-autologin',
  });
  const check = checkPreset(ctx, preset, caps);
  report.prerequisites = check.checks;
  if (!check.launchable) throw new Error('launch blocked: ' + check.checks.filter((c) => !c.pass).map((c) => c.label).join(', '));

  const g = await guests.create(preset.id, 'pilot-A');
  guestId = g.id;
  mark('guest-created');
  await guests.start(g.id, 'headless');
  mark('control-ready');
  await sleep(20000);
  await screenshot(g.id, 'early-boot');

  const provisionMs = Number(args['provision-timeout-min']) * 60_000;
  await waitFor('cloud-init provisioning (package install)', provisionMs, () => !!db.getGuest(g.id)?.provisioning.provisionedAt);
  mark('provisioned');
  await waitFor('desktop session + runner', 10 * 60_000, () => db.guestEvents(g.id).some((e) => e.event === 'runner-started'));
  mark('desktop-runner-started');
  await sleep(5000);
  await screenshot(g.id, 'desktop');

  const run = await runs.start({ guestId: g.id, treatment: 'PILOT', notes: 'automated feasibility pilot', environment: { kind: 'managed-guest', label: 'pilot-A' } });
  mark('run-started');
  const client = new CollectorClient(COLLECTOR, ctx.adminKey());
  await waitFor('browser visit + guest report', 5 * 60_000, async () => {
    const d = await client.runDetail(run.runToken).catch(() => null);
    return !!d && d.visits.length > 0 && d.guestReports.length > 0;
  });
  mark('visit-and-report-received');
  await sleep(3000);
  await screenshot(g.id, 'study-page');

  const done = await runs.finish(run.id);
  mark('run-finished');
  const detail = await runs.detail(run.id);
  report.run = { id: run.id, status: done.status, statusReason: done.statusReason, compare: detail.compare, networkChecks: detail.networkChecks };
  report.guestEvents = db.guestEvents(g.id);
  log(`run ${done.status}${done.statusReason ? ': ' + done.statusReason : ''}`);

  await sleep(15000); // idle sampling
  await guests.stop(g.id, false);
  mark('guest-stopped');
} catch (e) {
  report.error = (e as Error).message;
  log(`PILOT FAILED: ${(e as Error).message}`);
  if (guestId) {
    await screenshot(guestId, 'failure');
    report.guestEvents = db.guestEvents(guestId);
    report.guest = db.getGuest(guestId);
    await guests.stop(guestId, true).catch(() => undefined);
  }
} finally {
  await sampler.tick();
  sampler.stop();
  report.performance = perfReport(ctx);
  report.finishedAt = new Date().toISOString();
  writeFileSync(path.join(out, 'pilot-report.json'), JSON.stringify(report, null, 2));
  log(`report written to ${path.join(out, 'pilot-report.json')}`);
  server.close();
  process.exit(report.error ? 1 : 0);
}
