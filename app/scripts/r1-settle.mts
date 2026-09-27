/**
 * R1 lifecycle experiment: does a planted storage token survive a graceful guest restart,
 * as a function of how long the browser runs after planting ("settle" time)?
 *
 *   node --import tsx scripts/r1-settle.mts --data <pilot data dir> --guest <guest id> --settle 5,60
 *
 * Reuses an already provisioned guest. For each settle value: run with ?place=1, wait, graceful
 * stop, start, plain run, and compare the token read back with the one planted.
 */
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDb } from '../src/main/services/db';
import { probeHost } from '../src/main/services/capabilities';
import type { Ctx } from '../src/main/services/context';
import { GuestService } from '../src/main/services/guests';
import { RunService } from '../src/main/services/runs';
import { cloudInitUserData, guestBaseUrl, readAgentSource, startProvisioningServer } from '../src/main/services/provisioning';
import { getExit } from '../src/main/services/exits';
import { CollectorClient } from '../src/main/services/collectorClient';

const { values: args } = parseArgs({ options: { data: { type: 'string' }, guest: { type: 'string' }, settle: { type: 'string', default: '5,60' } } });
const COLLECTOR = process.env.COLLECTOR_URL ?? 'http://localhost:4100';
const PORT = Number(process.env.LVD_PROVISION_PORT ?? 4182);
const dataDir = path.resolve(args.data!);
const db = openDb(dataDir);
const ctx: Ctx = {
  db, dataDir, hostId: 'host_pilot2', appVersion: 'pilot', electronVersion: 'n/a',
  probe: () => probeHost(dataDir, 'host_pilot2'), adminKey: () => 'dev-admin-key', runtimeDir: `/tmp/lvd-pilot2-${process.getuid?.() ?? 0}`,
};
const guests = new GuestService(ctx, () => PORT);
const runs = new RunService(ctx, guests, () => COLLECTOR);
const client = new CollectorClient(COLLECTOR, 'dev-admin-key');
const agentPath = path.resolve(import.meta.dirname, '../../guest-agent/lvd-agent.py');
const server = startProvisioningServer(ctx, PORT, {
  userData: (g) => {
    const preset = db.getPreset(g.presetId, g.presetVersion)!;
    return cloudInitUserData({ guest: g, preset, exit: getExit(ctx, preset.network.routeId), collectorUrl: COLLECTOR,
      runnerBaseUrl: guestBaseUrl(PORT, g.id, g.provisioning.secret!), agentSource: readAgentSource(agentPath), packagesPreinstalled: !!db.getImage(g.imageId)?.derivedFrom });
  },
  currentRun: (g) => runs.openRunFor(g.id),
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m: string) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const id = args.guest!;

async function bootToDesktop() {
  const since = new Date().toISOString();
  await guests.start(id, 'headless');
  while (!db.guestEvents(id).some((e) => e.event === 'runner-started' && e.at > since)) await sleep(2000);
}
async function visit(place: boolean) {
  const run = await runs.start({ guestId: id, treatment: 'T4-restarts', notes: `R1 settle experiment place=${place}`, environment: { kind: 'managed-guest', label: 'guest-A' }, placeStudyToken: place });
  let tok: { existingToken: string | null; placedToken: string | null } | null = null;
  while (!tok) {
    const d = await client.runDetail(run.runToken).catch(() => null);
    const v = d?.visits[0];
    if (v && d!.guestReports.length) tok = (v.payload_json.observations['storage.testToken'] as { value: typeof tok }).value;
    else await sleep(2000);
  }
  await runs.finish(run.id);
  return tok!;
}

const results: unknown[] = [];
try {
  for (const settle of args.settle!.split(',').map(Number)) {
    await bootToDesktop();
    const before = await visit(true);
    log(`settle ${settle}s: token held before restart ${before.placedToken ?? before.existingToken} (${before.placedToken ? 'planted now' : 'already stored'})`);
    await sleep(settle * 1000);
    const stopAt = Date.now();
    await guests.stop(id, false);
    const shutdownMs = Date.now() - stopAt;
    await bootToDesktop();
    const after = await visit(false);
    // The page plants only when no token exists; the token held before the restart is either one.
    const held = before.placedToken ?? before.existingToken;
    const retained = !!held && after.existingToken === held;
    log(`settle ${settle}s: shutdown took ${shutdownMs} ms; read back ${after.existingToken} -> ${retained ? 'RETAINED' : 'LOST'}`);
    results.push({ settleSeconds: settle, planted: before.placedToken, previouslyStored: before.existingToken, held, readBack: after.existingToken, retained, shutdownMs });
    await guests.stop(id, false);
  }
} finally {
  writeFileSync(path.join(dataDir, '..', `r1-settle-${Date.now()}.json`), JSON.stringify(results, null, 2));
  server.close();
  process.exit(0);
}
