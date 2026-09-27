import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { HostCapabilities } from '../src/common/ipc';
import type { Ctx } from '../src/main/services/context';
import { openDb } from '../src/main/services/db';
import { GuestService } from '../src/main/services/guests';
import { RunService } from '../src/main/services/runs';
import { promoteGuestToImage, registerImage, verifyImage } from '../src/main/services/images';
import { savePreset, checkPreset } from '../src/main/services/presets';
import { saveConsent, withdrawConsent } from '../src/main/services/consents';
import { approveExit, saveExit, getExit } from '../src/main/services/exits';
import { chromiumPolicy, cloudInitUserData, smbiosSeedArg, startProvisioningServer, toGuestUrl } from '../src/main/services/provisioning';
import { percentile, perfReport, stat } from '../src/main/services/perf';
import { buildGroundTruth, hostInventory } from '../src/main/services/studyExport';
import { AppError } from '../src/main/errors';

const caps: HostCapabilities = {
  hostId: 'host_t', probedAt: new Date().toISOString(), os: 'darwin', osRelease: 'Darwin 25', arch: 'arm64', cpuModel: 'CPU',
  cpuCount: 8, totalMemMb: 16384, freeMemMb: 8000, freeDiskMb: 100_000, dataDir: '/tmp',
  hypervisor: { available: true, kind: 'hvf', detail: '' },
  backends: [{ name: 'qemu', available: true, version: 'QEMU 10', systemBinaries: { aarch64: '/q' }, qemuImg: '/qi', firmware: { aarch64: '/fw' }, detail: '' }],
  supportedGuestArch: ['aarch64'],
};

function makeCtx(): Ctx {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'lvd-study-'));
  return { db: openDb(dataDir), dataDir, hostId: 'host_t', appVersion: 't', electronVersion: 't', probe: async () => caps, adminKey: () => 'dev-admin-key', runtimeDir: dataDir };
}
const rejectsWith = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

async function presetWithRoute(ctx: Ctx, routeId: string) {
  const src = path.join(ctx.dataDir, 'b.qcow2');
  writeFileSync(src, 'x');
  const img = await registerImage(ctx, src, { name: 'L', version: '1', origin: 'o', guestOs: 'linux', guestArch: 'aarch64', licenseNotes: '', provisioning: 'cloud-init' });
  return savePreset(ctx, {
    name: 'Linux desktop study A', description: '',
    hostConstraint: { arch: ['arm64'], os: ['darwin'], minHostRamMb: 8192, backend: 'qemu' },
    guest: { os: 'linux', arch: 'aarch64', imageId: img.id }, resources: { vcpus: 2, memoryMb: 3072, diskGb: 20 },
    display: { width: 1366, height: 768 }, regional: { timeZone: 'Asia/Tokyo', locale: 'ja-JP' },
    network: { routeId }, expectedBootState: 'desktop-autologin',
  });
}

describe('environments and consent', () => {
  test('physical-control runs require an active consent; vendor runs require product details', async () => {
    const ctx = makeCtx();
    const runs = new RunService(ctx, new GuestService(ctx), () => 'http://127.0.0.1:9');
    await assert.rejects(runs.start({ guestId: null, treatment: 'T3-physical-hosts', notes: '', environment: { kind: 'physical-control', label: 'laptop 1' } }), rejectsWith('invalid-input'));
    const c = saveConsent(ctx, { participantCode: 'P-01', machineDescription: 'ThinkPad', consentFormVersion: 'v1', signedAt: '2026-09-27', obtainedBy: 'officer', notes: '' });
    assert.throws(() => saveConsent(ctx, { participantCode: 'P-01', machineDescription: 'x', consentFormVersion: 'v1', signedAt: '2026-09-27', obtainedBy: 'o', notes: '' }), rejectsWith('conflict'));
    withdrawConsent(ctx, c.id);
    await assert.rejects(runs.start({ guestId: null, treatment: 'T3-physical-hosts', notes: '', environment: { kind: 'physical-control', label: 'laptop 1', consentId: c.id } }), rejectsWith('conflict'));
    await assert.rejects(runs.start({ guestId: null, treatment: 'PILOT', notes: '', environment: { kind: 'vendor-product', label: 'v' } }), rejectsWith('invalid-input'));
    await assert.rejects(runs.start({ guestId: 'guest_x', treatment: 'PILOT', notes: '', environment: { kind: 'host-profile', label: 'p' } }), rejectsWith('invalid-input'));
  });
});

describe('network exit registry', () => {
  test('unapproved or unverifiable exits block launch; changing an exit revokes approval', async () => {
    const ctx = makeCtx();
    assert.throws(() => saveExit(ctx, { id: 'uni-proxy-a', kind: 'university-proxy', owner: 'IT', locationClaim: 'campus', networkType: 'proxy', approvedBy: '' }), rejectsWith('invalid-input'));
    saveExit(ctx, { id: 'uni-proxy-a', kind: 'university-proxy', owner: 'IT', locationClaim: 'campus', networkType: 'proxy', proxyUrl: 'http://proxy.example:3128', expectedIp: '198.51.100.7', approvedBy: '' });
    const p = await presetWithRoute(ctx, 'uni-proxy-a');
    assert.equal(checkPreset(ctx, p, caps).checks.find((c) => c.id === 'route')!.pass, false);
    approveExit(ctx, 'uni-proxy-a', 'Network officer');
    assert.equal(checkPreset(ctx, p, caps).checks.find((c) => c.id === 'route')!.pass, true);
    saveExit(ctx, { ...getExit(ctx, 'uni-proxy-a')!, expectedIp: '198.51.100.8' });
    assert.equal(getExit(ctx, 'uni-proxy-a')!.approvedAt, null);
    assert.equal(getExit(ctx, 'default-nat')!.kind, 'default-nat');
  });
});

describe('provisioning', () => {
  test('cloud-init applies preset regional/display settings and pins the browser to the collector', async () => {
    const ctx = makeCtx();
    saveExit(ctx, { id: 'uni-proxy-a', kind: 'university-proxy', owner: 'IT', locationClaim: 'campus', networkType: 'proxy', proxyUrl: 'http://proxy.example:3128', expectedIp: '198.51.100.7', approvedBy: '' });
    const p = await presetWithRoute(ctx, 'uni-proxy-a');
    const ud = cloudInitUserData({
      guest: { id: 'guest_abc12345', name: 'A' }, preset: p, exit: getExit(ctx, 'uni-proxy-a'), collectorUrl: 'http://localhost:4100',
      runnerBaseUrl: 'http://10.0.2.2:4180/g/guest_abc12345/' + 'a'.repeat(32) + '/', agentSource: 'print(1)',
    });
    assert.match(ud, /^#cloud-config/);
    assert.match(ud, /timezone: Asia\/Tokyo/);
    assert.doesNotMatch(ud, /^locale:/m, 'cloud-init locale module would fail before packages are installed');
    const locScript = ud.split('\n').find((l, i, a) => a[i - 3]?.includes('set-locale.sh'))!.split('content: ')[1];
    assert.match(Buffer.from(locScript, 'base64').toString(), /update-locale LANG=ja_JP\.UTF-8/);
    assert.doesNotMatch(ud, /^\s*(passwd|hashed_passwd|plain_text_passwd):|ssh_authorized_keys/m);
    const policyB64 = ud.split('\n').find((l, i, a) => a[i - 3]?.includes('lvd-study.json'))!.split('content: ')[1];
    const policy = JSON.parse(Buffer.from(policyB64, 'base64').toString());
    assert.deepEqual(policy.URLAllowlist, ['http://10.0.2.2:4100']);
    assert.equal(policy.ProxyServer, 'http://proxy.example:3128');
    assert.equal(chromiumPolicy('https://collector.uni.example', null).ProxyMode, 'direct');
    const derived = cloudInitUserData({
      guest: { id: 'guest_abc12345', name: 'A' }, preset: p, exit: null, collectorUrl: 'http://localhost:4100',
      runnerBaseUrl: 'http://10.0.2.2:4180/g/x/', agentSource: '', packagesPreinstalled: true,
    });
    assert.doesNotMatch(derived, /package_update|^packages:/m, 'derived bases skip the package step');
    assert.match(ud, /^packages:/m);
    assert.equal(toGuestUrl('http://127.0.0.1:4100/t/x'), 'http://10.0.2.2:4100/t/x');
    assert.equal(smbiosSeedArg(4180, 'g1', 's'), 'type=1,serial=ds=nocloud;s=http://10.0.2.2:4180/g/g1/s/');
  });

  test('provisioning server: per-guest secret, current run, append-only events', async () => {
    const ctx = makeCtx();
    const secret = 'b'.repeat(32);
    const now = new Date().toISOString();
    ctx.db.putGuest({
      id: 'guest_1', name: 'A', presetId: 'p', presetVersion: 1, imageId: 'i', diskPath: '/d', state: 'running', pid: null,
      display: 'window', vncPort: null, conditionSeq: 1, lastError: null, createdAt: now, updatedAt: now, snapshots: [],
      provisioning: { mode: 'cloud-init', secret, provisionedAt: null },
    });
    let open: { runToken: string; collectorUrl: string; studyUrl: string } | null = null;
    const server = startProvisioningServer(ctx, 0, { userData: () => '#cloud-config\n', currentRun: () => open });
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/g/guest_1`;
    try {
      assert.equal((await fetch(`${base}/${'c'.repeat(32)}/user-data`)).status, 403);
      assert.equal(await (await fetch(`${base}/${secret}/user-data`)).text(), '#cloud-config\n');
      assert.match(await (await fetch(`${base}/${secret}/meta-data`)).text(), /instance-id: guest_1/);
      assert.equal((await fetch(`${base}/${secret}/current-run`)).status, 204);
      open = { runToken: 'tok_x', collectorUrl: 'http://10.0.2.2:4100', studyUrl: 'http://10.0.2.2:4100/t/tok_x' };
      assert.equal(((await (await fetch(`${base}/${secret}/current-run`)).json()) as { runToken: string }).runToken, 'tok_x');
      assert.equal((await fetch(`${base}/${secret}/events`, { method: 'POST', body: JSON.stringify({ event: 'made-up' }) })).status, 400);
      assert.equal((await fetch(`${base}/${secret}/events`, { method: 'POST', body: JSON.stringify({ event: 'provisioned' }) })).status, 204);
      assert.ok(ctx.db.getGuest('guest_1')!.provisioning.provisionedAt);
      assert.deepEqual(ctx.db.guestEvents('guest_1').map((e) => e.event), ['provisioned']);
    } finally {
      server.close();
    }
  });
});

describe('performance', () => {
  test('percentiles and report derive from events and samples', () => {
    assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
    assert.equal(stat([]).median, null);
    const ctx = makeCtx();
    const now = new Date().toISOString();
    ctx.db.putGuest({
      id: 'guest_1', name: 'A', presetId: 'p', presetVersion: 1, imageId: 'i', diskPath: '/d', state: 'running', pid: 1,
      display: 'window', vncPort: null, conditionSeq: 1, lastError: null, createdAt: now, updatedAt: now, snapshots: [],
      provisioning: { mode: 'manual', secret: null, provisionedAt: null },
    });
    ctx.db.raw.exec(`INSERT INTO guest_events (guest_id, at, event) VALUES
      ('guest_1', '2026-09-27T10:00:00.000Z', 'start-requested'),
      ('guest_1', '2026-09-27T10:00:02.000Z', 'control-ready'),
      ('guest_1', '2026-09-27T10:00:40.000Z', 'runner-started'),
      ('guest_1', '2026-09-27T11:00:00.000Z', 'start-requested'),
      ('guest_1', '2026-09-27T11:00:04.000Z', 'control-ready'),
      ('guest_1', '2026-09-27T12:00:00.000Z', 'start-requested'),
      ('guest_1', '2026-09-27T12:05:00.000Z', 'provisioned'),
      ('guest_1', '2026-09-27T12:06:00.000Z', 'runner-started')`);
    ctx.db.raw.exec(`INSERT INTO samples (guest_id, condition_seq, at, rss_mb, cpu_pct, disk_mb, power) VALUES
      ('guest_1', 1, '2026-09-27T10:01:00Z', 900, 3, 1000, 'AC Power'),
      ('guest_1', 1, '2026-09-27T10:01:05Z', 1400, 80, 1200, 'AC Power')`);
    const g = perfReport(ctx).guests[0];
    assert.equal(g.starts, 3);
    assert.deepEqual([g.controlReadyMs.n, g.controlReadyMs.median], [2, 3000]);
    assert.equal(g.desktopReadyMs.n, 1, 'second start never reached the desktop and is not counted as fast');
    assert.deepEqual([g.provisioningBootMs.n, g.provisioningBootMs.median], [1, 360_000], 'provisioning boot reported apart');
    assert.equal(g.idleRssMb.median, 900);
    assert.equal(g.activeRssMb.median, 1400);
    assert.equal(g.diskGrowthMb, 200);
  });
});

describe('study exports', () => {
  test('ground truth lists runs with environment and pseudonymous participant code; inventory suggests a role', async () => {
    const ctx = makeCtx();
    const c = saveConsent(ctx, { participantCode: 'P-07', machineDescription: 'x', consentFormVersion: 'v1', signedAt: '2026-09-27', obtainedBy: 'o', notes: '' });
    const runs = new RunService(ctx, new GuestService(ctx), () => 'http://127.0.0.1:9');
    await assert.rejects(runs.start({ guestId: null, treatment: 'T3-physical-hosts', notes: '', environment: { kind: 'physical-control', label: 'laptop 7', consentId: c.id } }));
    const gt = buildGroundTruth(ctx, caps);
    assert.equal(gt.schema, 'lvd-ground-truth/1');
    assert.equal(gt.runs.length, 1);
    assert.equal(gt.runs[0].environment!.participantCode, 'P-07');
    assert.equal(gt.runs[0].manifestIntact, true);
    const manifest = JSON.parse(readFileSync(runs.list()[0].manifestPath, 'utf8'));
    assert.equal(manifest.environment.consentId, c.id);
    const inv = await hostInventory(ctx, caps);
    assert.match(inv.markdown, /reference host candidate/);
    assert.match((await hostInventory(ctx, { ...caps, totalMemMb: 8192 })).markdown, /pilot-only/);
  });
});

describe('base image builder', () => {
  test('promotes only a clean, provisioned, stopped guest; output is flattened, hashed and records provenance', async (t) => {
    const qemuImg = ['/opt/homebrew/bin/qemu-img', '/usr/local/bin/qemu-img', '/usr/bin/qemu-img'].find((p) => existsSync(p));
    if (!qemuImg) return t.skip('qemu-img not installed');
    const ctx = makeCtx();
    ctx.probe = async () => ({ ...caps, backends: [{ ...caps.backends[0], qemuImg }] });
    const src = path.join(ctx.dataDir, 'src.qcow2');
    execFileSync(qemuImg, ['create', '-f', 'qcow2', src, '64M']);
    const img = await registerImage(ctx, src, { name: 'Base', version: '1', origin: 'o', guestOs: 'linux', guestArch: 'aarch64', licenseNotes: 'l', provisioning: 'cloud-init' });
    const p = await presetWithRoute(ctx, 'default-nat');
    const disk = path.join(ctx.dataDir, 'overlay.qcow2');
    execFileSync(qemuImg, ['create', '-f', 'qcow2', '-F', 'qcow2', '-b', img.path, disk, '1G']);
    const now = new Date().toISOString();
    ctx.db.putGuest({
      id: 'guest_b', name: 'builder', presetId: p.id, presetVersion: p.version, imageId: img.id, diskPath: disk, state: 'stopped', pid: null,
      display: 'window', vncPort: null, conditionSeq: 1, lastError: null, createdAt: now, updatedAt: now, snapshots: [],
      provisioning: { mode: 'cloud-init', secret: 'c'.repeat(32), provisionedAt: now },
    });
    const out = await promoteGuestToImage(ctx, 'guest_b', 'Builder base', '2026-09-27');
    assert.equal(out.derivedFrom?.imageId, img.id);
    assert.equal(out.derivedFrom?.guestId, 'guest_b');
    const info = JSON.parse(execFileSync(qemuImg, ['info', '--output=json', out.path]).toString());
    assert.equal(info['backing-filename'], undefined, 'promoted image must not depend on a backing file');
    assert.equal((await verifyImage(ctx, out.id)).match, true);

    // A guest that ran study visits is refused (its browser profile is not clean).
    ctx.db.putRun({ id: 'run_x', runToken: 'tok_x', guestId: 'guest_b', treatment: 'PILOT', status: 'complete', statusReason: null, notes: '',
      createdAt: now, finishedAt: now, manifestPath: '/x', manifestSha256: 'x', studyUrl: 'x', guestStudyUrl: 'x' });
    await assert.rejects(promoteGuestToImage(ctx, 'guest_b', 'again', '2'), rejectsWith('conflict'));
  });
});
