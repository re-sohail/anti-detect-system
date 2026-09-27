/**
 * Two-guest pilot (plan Phases 2–3, treatments T2 + T4, requirement R1, claim C17).
 *
 *   node --import tsx scripts/pilot-two-guests.mts --image FILE --sha512 HEX --origin URL --out DIR
 *
 * Guests A and B from one preset on one host. Run 1: A plants the benign study token, B does not.
 * Both guests restart. Run 2: both read storage again. Checks, from recorded evidence only:
 *   R1   A retains its own token after restart; B never sees one.
 *   C17  both guests reach the collector through the same server-observed exit (shared NAT).
 *   R2   selected / guest / browser / server values per run (mismatches kept).
 * Also writes the ground-truth and collector exports that the analysis toolkit consumes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { openDb } from '../src/main/services/db';
import { probeHost } from '../src/main/services/capabilities';
import type { Ctx } from '../src/main/services/context';
import { GuestService } from '../src/main/services/guests';
import { registerImage } from '../src/main/services/images';
import { savePreset } from '../src/main/services/presets';
import { RunService } from '../src/main/services/runs';
import { PerfSampler, perfReport } from '../src/main/services/perf';
import { cloudInitUserData, guestBaseUrl, readAgentSource, startProvisioningServer } from '../src/main/services/provisioning';
import { getExit } from '../src/main/services/exits';
import { qmp } from '../src/main/services/qemu';
import { CollectorClient, type CollectorRunDetail } from '../src/main/services/collectorClient';
import { buildGroundTruth } from '../src/main/services/studyExport';
import type { RunRecord } from '../src/common/ipc';

const { values: args } = parseArgs({
  options: { image: { type: 'string' }, sha512: { type: 'string' }, origin: { type: 'string' }, out: { type: 'string' } },
});
if (!args.image || !args.out || !args.origin) {
  console.error('usage: --image FILE --origin URL --out DIR [--sha512 HEX]');
  process.exit(2);
}
const COLLECTOR = process.env.COLLECTOR_URL ?? 'http://localhost:4100';
const PORT = Number(process.env.LVD_PROVISION_PORT ?? 4182);
const out = path.resolve(args.out);
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const log = (m: string) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what: string, ms: number, fn: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(3000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const dataDir = path.join(out, 'data');
const db = openDb(dataDir);
const ctx: Ctx = {
  db, dataDir, hostId: 'host_pilot2', appVersion: 'pilot', electronVersion: 'n/a',
  probe: () => probeHost(dataDir, 'host_pilot2'), adminKey: () => process.env.COLLECTOR_ADMIN_KEY ?? 'dev-admin-key',
  runtimeDir: `/tmp/lvd-pilot2-${process.getuid?.() ?? 0}`,
};
const guests = new GuestService(ctx, () => PORT);
const runs = new RunService(ctx, guests, () => COLLECTOR);
const client = new CollectorClient(COLLECTOR, ctx.adminKey());
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

async function screenshot(guestId: string, label: string) {
  const file = path.join(out, `${label}.png`);
  await qmp(path.join(ctx.runtimeDir, `${guestId}.qmp`), 'screendump', { filename: file, format: 'png' }, 10000).catch(() => undefined);
}
const eventsSince = (guestId: string, since: string, event: string) =>
  db.guestEvents(guestId).some((e) => e.event === event && e.at > since);

async function runAndFinish(guestId: string, label: string, treatment: 'T2-vms-one-host' | 'T4-restarts', place: boolean) {
  const run = await runs.start({ guestId, treatment, notes: `pilot ${label}`, environment: { kind: 'managed-guest', label }, placeStudyToken: place });
  await waitFor(`visit + report for ${label}`, 5 * 60_000, async () => {
    const d = await client.runDetail(run.runToken).catch(() => null);
    return !!d && d.visits.length > 0 && d.guestReports.length > 0;
  });
  await sleep(2000);
  await screenshot(guestId, `${label}-study-page`);
  const done = await runs.finish(run.id);
  log(`${label}: run ${done.status}${done.statusReason ? ' — ' + done.statusReason : ''}`);
  return done;
}

const report: Record<string, unknown> = { startedAt: new Date().toISOString(), collector: COLLECTOR };
const ids: string[] = [];
try {
  const img = await registerImage(ctx, args.image, {
    name: 'Debian 13 generic cloud', version: path.basename(args.image), origin: args.origin, guestOs: 'linux', guestArch: 'aarch64',
    licenseNotes: 'Debian: DFSG-free software', expectedSha256: args.sha512, provisioning: 'cloud-init',
  });
  const preset = savePreset(ctx, {
    name: 'Linux desktop study A (two-guest pilot)', description: 'T2/T4 pilot',
    hostConstraint: { arch: ['arm64'], os: ['darwin'], minHostRamMb: 8192, backend: 'qemu' },
    guest: { os: 'linux', arch: 'aarch64', imageId: img.id },
    resources: { vcpus: 2, memoryMb: 3072, diskGb: 16 }, display: { width: 1280, height: 800 },
    regional: { timeZone: 'Europe/London', locale: 'en-GB' }, network: { routeId: 'default-nat' }, expectedBootState: 'desktop-autologin',
  });
  const A = await guests.create(preset.id, 'guest-A');
  const B = await guests.create(preset.id, 'guest-B');
  ids.push(A.id, B.id);
  const firstStart = new Date().toISOString();
  await guests.start(A.id, 'headless');
  await guests.start(B.id, 'headless');
  log('both guests started; provisioning');
  await waitFor('both guests provisioned and on the desktop', 45 * 60_000, () =>
    [A.id, B.id].every((id) => eventsSince(id, firstStart, 'runner-started') && !!db.getGuest(id)?.provisioning.provisionedAt));
  log('both desktops up');

  const run1 = await Promise.all([runAndFinish(A.id, 'A-run1', 'T2-vms-one-host', true), runAndFinish(B.id, 'B-run1', 'T2-vms-one-host', false)]);

  log('restarting both guests');
  await Promise.all([guests.stop(A.id, false), guests.stop(B.id, false)]);
  const restartAt = new Date().toISOString();
  await guests.start(A.id, 'headless');
  await guests.start(B.id, 'headless');
  await waitFor('desktops after restart', 10 * 60_000, () => [A.id, B.id].every((id) => eventsSince(id, restartAt, 'runner-started')));
  log('both desktops up after restart');
  const run2 = await Promise.all([runAndFinish(A.id, 'A-run2', 'T4-restarts', false), runAndFinish(B.id, 'B-run2', 'T4-restarts', false)]);

  // ---- evidence-based checks ----
  const details: Record<string, CollectorRunDetail> = {};
  for (const r of [...run1, ...run2] as RunRecord[]) details[r.id] = await client.runDetail(r.runToken);
  const tok = (r: RunRecord) => (details[r.id].visits[0].payload_json.observations['storage.testToken'] as { value: { existingToken: string | null; placedToken: string | null } }).value;
  const [a1, b1] = run1;
  const [a2, b2] = run2;
  const exitOf = (r: RunRecord) => details[r.id].visits[0].peer_ip;
  const checks = {
    'R1: A planted a token in run 1': !!tok(a1).placedToken,
    'R1: A retained its token after restart': tok(a2).existingToken === tok(a1).placedToken && !!tok(a1).placedToken,
    'R1: B never saw a token': [b1, b2].every((r) => tok(r).existingToken === null),
    'C17: A and B share one server-observed exit': new Set([a1, b1, a2, b2].map(exitOf)).size === 1,
    'all four runs complete': [...run1, ...run2].every((r) => r.status === 'complete'),
  };
  for (const [k, v] of Object.entries(checks)) log(`${v ? 'PASS' : 'FAIL'}  ${k}`);
  report.checks = checks;
  report.runs = await Promise.all([...run1, ...run2].map(async (r) => {
    const d = await runs.detail(r.id);
    return { id: r.id, status: r.status, reason: r.statusReason, treatment: r.treatment, guest: r.guestId, compare: d.compare };
  }));
  report.guestEvents = Object.fromEntries(ids.map((id) => [id, db.guestEvents(id)]));

  // ---- exports for the analysis toolkit ----
  writeFileSync(path.join(out, 'ground-truth.json'), JSON.stringify(buildGroundTruth(ctx, await ctx.probe()), null, 2));
  const exp = await fetch(new URL('/api/v1/export', COLLECTOR), { headers: { 'x-admin-key': ctx.adminKey()! } }).then((r) => r.json());
  writeFileSync(path.join(out, 'collector-export.json'), JSON.stringify(exp, null, 2));

  await Promise.all(ids.map((id) => guests.stop(id, false)));
} catch (e) {
  report.error = (e as Error).message;
  log(`PILOT FAILED: ${(e as Error).message}`);
  for (const id of ids) {
    await screenshot(id, `failure-${id}`);
    await guests.stop(id, true).catch(() => undefined);
  }
  report.guestEvents = Object.fromEntries(ids.map((id) => [id, db.guestEvents(id)]));
} finally {
  await sampler.tick();
  sampler.stop();
  report.performance = perfReport(ctx);
  report.finishedAt = new Date().toISOString();
  writeFileSync(path.join(out, 'pilot-report.json'), JSON.stringify(report, null, 2));
  log(`report: ${path.join(out, 'pilot-report.json')}`);
  server.close();
  process.exit(report.error ? 1 : 0);
}
