/**
 * Service-level tests for the control app (plan Phase 10: R1–R5 and negative inputs).
 * Tests that need the collector expect it at COLLECTOR_URL (default http://localhost:4100)
 * and are skipped when it is not running.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { HostCapabilities } from '../src/common/ipc';
import type { Ctx } from '../src/main/services/context';
import { openDb } from '../src/main/services/db';
import { GuestService } from '../src/main/services/guests';
import { registerImage, verifyImage } from '../src/main/services/images';
import { checkPreset, savePreset, previewPreset } from '../src/main/services/presets';
import { RunService } from '../src/main/services/runs';
import { buildArgs } from '../src/main/services/qemu';
import { AppError } from '../src/main/errors';
import type { PresetInput } from '@lvd/shared';

const COLLECTOR = process.env.COLLECTOR_URL ?? 'http://localhost:4100';
const AGENT = path.resolve(import.meta.dirname, '../../guest-agent/lvd-agent.py');

function caps(over: Partial<HostCapabilities> = {}): HostCapabilities {
  return {
    hostId: 'host_test', probedAt: new Date().toISOString(), os: 'darwin', osRelease: 'Darwin 25', arch: 'arm64',
    cpuModel: 'Test CPU', cpuCount: 8, totalMemMb: 16384, freeMemMb: 8000, freeDiskMb: 100_000, dataDir: '/tmp',
    hypervisor: { available: true, kind: 'hvf', detail: 'test' },
    backends: [{
      name: 'qemu', available: true, version: 'QEMU emulator version 10.1.0',
      systemBinaries: { aarch64: '/fake/qemu-system-aarch64' }, qemuImg: '/fake/qemu-img',
      firmware: { aarch64: '/fake/edk2-aarch64-code.fd' }, detail: 'test',
    }],
    supportedGuestArch: ['aarch64'],
    ...over,
  };
}

function makeCtx(c: HostCapabilities = caps()): Ctx {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'lvd-app-'));
  return {
    db: openDb(dataDir), dataDir, hostId: 'host_test', appVersion: '0.1.0-test', electronVersion: 'test',
    probe: async () => c, adminKey: () => process.env.COLLECTOR_ADMIN_KEY ?? 'dev-admin-key', runtimeDir: path.join(dataDir, 'rt'),
  };
}

async function fakeImage(ctx: Ctx, expectedSha256?: string) {
  const src = path.join(ctx.dataDir, 'base.qcow2');
  writeFileSync(src, 'not really a disk image, but bytes to hash');
  return registerImage(ctx, src, {
    name: 'Test Linux', version: '1', origin: 'https://example.invalid/img', guestOs: 'linux', guestArch: 'aarch64',
    licenseNotes: 'test', expectedSha256,
  });
}

const PRESET = (imageId: string): PresetInput => ({
  name: 'Linux desktop study A', description: '',
  hostConstraint: { arch: ['arm64'], os: ['darwin'], minHostRamMb: 8192, backend: 'qemu' },
  guest: { os: 'linux', arch: 'aarch64', imageId },
  resources: { vcpus: 2, memoryMb: 3072, diskGb: 24 },
  display: { width: 1280, height: 800 },
  regional: { timeZone: 'Europe/London', locale: 'en-GB' },
  network: { routeId: 'default-nat' },
  expectedBootState: 'desktop-login',
});

const HOST_PROFILE = { kind: 'host-profile' as const, label: 'profile A' };

const rejectsWith = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

describe('image manager', () => {
  test('registers, makes base read-only, detects later modification', async () => {
    const ctx = makeCtx();
    const img = await fakeImage(ctx);
    assert.match(img.sha256, /^[a-f0-9]{64}$/);
    assert.equal((await verifyImage(ctx, img.id)).match, true);
    chmodSync(img.path, 0o644);
    writeFileSync(img.path, 'tampered');
    assert.equal((await verifyImage(ctx, img.id)).match, false);
  });

  test('negative: wrong published checksum is rejected and not stored', async () => {
    const ctx = makeCtx();
    await assert.rejects(fakeImage(ctx, 'a'.repeat(64)), rejectsWith('checksum-mismatch'));
    assert.equal(ctx.db.listImages().length, 0);
  });
});

describe('presets', () => {
  test('saving an edit appends a new version; unchanged save is a no-op', async () => {
    const ctx = makeCtx();
    const img = await fakeImage(ctx);
    const v1 = savePreset(ctx, PRESET(img.id));
    assert.equal(v1.version, 1);
    assert.equal(savePreset(ctx, PRESET(img.id), v1.id).version, 1);
    const preview = previewPreset(ctx, { ...PRESET(img.id), regional: { timeZone: 'Asia/Tokyo', locale: 'ja-JP' } }, v1.id);
    assert.deepEqual(preview.diff.map((d) => d.path), ['regional.locale', 'regional.timeZone']);
    const v2 = savePreset(ctx, { ...PRESET(img.id), regional: { timeZone: 'Asia/Tokyo', locale: 'ja-JP' } }, v1.id);
    assert.equal(v2.version, 2);
    assert.equal(ctx.db.getPreset(v1.id, 1)?.regional.timeZone, 'Europe/London');
  });

  test('negative: launch checks report unavailable hypervisor, missing backend, low disk, wrong arch', async () => {
    const ctx = makeCtx();
    const img = await fakeImage(ctx);
    const p = savePreset(ctx, PRESET(img.id));
    const failed = (c: HostCapabilities) => checkPreset(ctx, p, c).checks.filter((x) => !x.pass).map((x) => x.id);
    assert.deepEqual(failed(caps()), []);
    assert.ok(failed(caps({ hypervisor: { available: false, kind: 'none', detail: '' }, supportedGuestArch: [] })).includes('hypervisor'));
    assert.ok(failed(caps({ backends: [{ ...caps().backends[0], available: false }] })).includes('backend'));
    assert.ok(failed(caps({ freeDiskMb: 1000 })).includes('disk'));
    assert.ok(failed(caps({ arch: 'x64', supportedGuestArch: ['x86_64'] })).includes('guest-arch'));
  });

  test('negative: guest creation is blocked with a specific error code', async () => {
    const ctx = makeCtx(caps({ freeDiskMb: 100 }));
    const img = await fakeImage(ctx);
    const p = savePreset(ctx, PRESET(img.id));
    await assert.rejects(new GuestService(ctx).create(p.id, 'guest-A'), rejectsWith('insufficient-disk'));
  });
});

describe('qemu adapter', () => {
  test('display is bound to loopback only in headless mode, and firmware is required on aarch64', async () => {
    const ctx = makeCtx();
    const img = await fakeImage(ctx);
    const p = savePreset(ctx, PRESET(img.id));
    const args = buildArgs(caps(), { guestId: 'g1', preset: p, display: 'headless', vncDisplay: 12 }, {
      diskPath: '/d.qcow2', qmpSocket: '/tmp/x.qmp', pidFile: '/tmp/x.pid', firmware: '/fw.fd',
    });
    assert.equal(args[args.indexOf('-vnc') + 1], '127.0.0.1:12');
    assert.equal(args[args.indexOf('-accel') + 1], 'hvf');
    assert.throws(
      () => buildArgs(caps(), { guestId: 'g1', preset: p, display: 'window', vncDisplay: null }, { diskPath: '/d', qmpSocket: '/q', pidFile: '/p' }),
      rejectsWith('backend-missing'),
    );
  });
});

describe('runs against the live collector', () => {
  let up = false;
  before(async () => {
    up = await fetch(`${COLLECTOR}/api/v1/echo`).then((r) => r.ok, () => false);
  });

  test('R3/R4-adjacent: collector unreachable marks the run invalid and never falls back', async () => {
    const ctx = makeCtx();
    const runs = new RunService(ctx, new GuestService(ctx), () => 'http://127.0.0.1:9');
    await assert.rejects(runs.start({ guestId: null, treatment: 'PILOT', notes: '', environment: HOST_PROFILE }), rejectsWith('collector-unreachable'));
    const [r] = runs.list();
    assert.equal(r.status, 'invalid');
    assert.ok(existsSync(r.manifestPath), 'manifest is written before registration is attempted');
  });

  test('full external-browser run: manifest first, browser + agent + server, complete, export, tamper detection', async (t) => {
    if (!up) return t.skip(`collector not running at ${COLLECTOR}`);
    const ctx = makeCtx();
    const runs = new RunService(ctx, new GuestService(ctx), () => COLLECTOR);
    const run = await runs.start({ guestId: null, treatment: 'T1-profiles-one-os', notes: 'test', environment: HOST_PROFILE });
    assert.equal(run.status, 'running');
    const manifest = JSON.parse(readFileSync(run.manifestPath, 'utf8'));
    assert.equal(manifest.runToken, run.runToken);
    assert.equal(manifest.preset, null);

    // Finishing without a browser visit or agent report must not produce a complete run.
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(run.studyUrl);
      await page.locator('[data-testid="status"][data-phase="done"]').waitFor({ timeout: 30000 });
    } finally {
      await browser.close();
    }
    execFileSync('python3', [AGENT, '--collector', COLLECTOR, '--run-token', run.runToken]);

    const detail = await runs.detail(run.id);
    assert.equal(detail.visitCount, 1);
    assert.equal(detail.guestReportCount, 1);
    const tz = detail.compare.find((r) => r.key === 'timeZone')!;
    assert.equal(tz.selected, null, 'external runs have no selected configuration');
    assert.ok(tz.guestReported && tz.browserReported);

    const done = await runs.finish(run.id);
    assert.equal(done.status, 'complete', done.statusReason ?? '');
    const checks = ctx.db.networkChecks(run.id);
    assert.ok(checks.some((c) => c.phase === 'start') && checks.some((c) => c.phase === 'end'));
    assert.ok(checks.filter((c) => c.phase === 'adhoc').every((c) => c.verdict === 'valid'));

    // Export: complete folder with verifiable checksums, no ".partial" left behind.
    const outDir = mkdtempSync(path.join(tmpdir(), 'lvd-export-'));
    const exp = runs.exportRun(run.id, outDir);
    assert.deepEqual(readdirSync(outDir), [path.basename(exp.dir)]);
    for (const line of readFileSync(path.join(exp.dir, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
      const [sum, name] = line.split(/\s+/);
      assert.equal(createHash('sha256').update(readFileSync(path.join(exp.dir, name))).digest('hex'), sum, name);
    }

    // A modified manifest is detected, not silently used.
    chmodSync(run.manifestPath, 0o644);
    writeFileSync(run.manifestPath, readFileSync(run.manifestPath, 'utf8').replace('"T1-profiles-one-os"', '"T2-vms-one-host"'));
    await assert.rejects(runs.detail(run.id), rejectsWith('checksum-mismatch'));
  });

  test('R4: a run whose guest dies is marked interrupted; finishing without agent report is invalid', async (t) => {
    if (!up) return t.skip(`collector not running at ${COLLECTOR}`);
    const ctx = makeCtx();
    const runs = new RunService(ctx, new GuestService(ctx), () => COLLECTOR);
    const a = await runs.start({ guestId: null, treatment: 'PILOT', notes: '', environment: HOST_PROFILE });
    runs.interruptRunsFor(null, 'guest exited: test');
    assert.equal(runs.get(a.id).status, 'interrupted');
    await assert.rejects(runs.finish(a.id), rejectsWith('conflict'));

    const b = await runs.start({ guestId: null, treatment: 'PILOT', notes: '', environment: HOST_PROFILE });
    const done = await runs.finish(b.id);
    assert.equal(done.status, 'invalid');
    assert.match(done.statusReason ?? '', /no browser visit/);
    assert.match(done.statusReason ?? '', /no guest agent report/);
  });
});

describe('audit', () => {
  test('audit log is append-only', () => {
    const ctx = makeCtx();
    ctx.db.audit({ actor: 't', action: 'x', target: null, outcome: 'ok' });
    assert.throws(() => ctx.db.raw.exec("UPDATE audit SET actor = 'y'"), /append-only/);
    assert.throws(() => ctx.db.raw.exec('DELETE FROM audit'), /append-only/);
  });
});
