import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Environment, INSTRUMENT_VERSION, RunManifest, canonicalJson, type NetworkCheck, type NetworkExit } from '@lvd/shared';
import type { RunDetail, RunRecord, StartRunInput } from '@common/ipc';
import { AppError, toErrorShape } from '../errors';
import { CollectorClient, type CollectorRunDetail } from './collectorClient';
import { buildCompare } from './compare';
import type { Ctx } from './context';
import type { GuestService } from './guests';
import { newId, sha256 } from './hash';
import { requireVerifiedImage } from './images';
import { requireActiveConsent } from './consents';
import { DEFAULT_EXIT_ID, getExit } from './exits';
import { toGuestUrl } from './provisioning';

/**
 * Runs (brief §9, §11, §17).
 * - The manifest is written and hashed BEFORE the run token is registered, so no guest
 *   can contact the collector before its configuration is on record.
 * - A run is complete only when the guest agent, the browser page and the server all
 *   recorded the same run token.
 * - Unexpected egress, collector outage or a crashed guest mark the run invalid or
 *   interrupted. Observations are never fabricated or silently retried.
 */

export const DEFAULT_ROUTE = DEFAULT_EXIT_ID;


export class RunService {
  constructor(
    private ctx: Ctx,
    private guests: GuestService,
    private collectorUrl: () => string,
  ) {}

  private client() {
    return new CollectorClient(this.collectorUrl(), this.ctx.adminKey());
  }

  private runDir(id: string) {
    return path.join(this.ctx.dataDir, 'runs', id);
  }

  list(): RunRecord[] {
    return this.ctx.db.listRuns();
  }

  get(id: string): RunRecord {
    const r = this.ctx.db.getRun(id);
    if (!r) throw new AppError('not-found', `Unknown run ${id}`);
    return r;
  }

  private update(id: string, patch: Partial<RunRecord>): RunRecord {
    const next = { ...this.get(id), ...patch };
    this.ctx.db.putRun(next);
    return next;
  }

  async start(input: StartRunInput): Promise<RunRecord> {
    const env = Environment.parse({ consentId: null, product: null, ...input.environment });
    if ((env.kind === 'managed-guest') !== !!input.guestId) {
      throw new AppError('invalid-input', 'A managed-guest run needs a guest, and only managed-guest runs may have one');
    }
    if (env.kind === 'physical-control') requireActiveConsent(this.ctx, env.consentId);
    else env.consentId = null;
    if ((env.kind === 'vendor-product' || env.kind === 'device-cloud') && !env.product) {
      throw new AppError('invalid-input', 'Record the product name, edition, version and lawful-access basis for this run');
    }
    const caps = await this.ctx.probe();
    const guest = input.guestId ? this.guests.get(input.guestId) : null;
    if (guest && this.list().some((r) => r.guestId === guest.id && (r.status === 'running' || r.status === 'planned'))) {
      throw new AppError('conflict', 'This guest already has an open run; finish it first');
    }
    const preset = guest ? this.ctx.db.getPreset(guest.presetId, guest.presetVersion) : null;
    if (guest && !preset) throw new AppError('not-found', 'Preset version for this guest no longer exists');
    const image = guest ? await requireVerifiedImage(this.ctx, guest.imageId) : null;
    const qemu = caps.backends[0];
    const routeId = preset?.network.routeId ?? input.routeId ?? DEFAULT_ROUTE;
    const exit = getExit(this.ctx, routeId);
    if (!exit) throw new AppError('route-mismatch', `Route ${routeId} is not in the exit registry`);
    if (!exit.approvedAt) throw new AppError('route-mismatch', `Exit ${routeId} has not been approved`);
    if (exit.kind === 'university-proxy' && !exit.expectedIp) {
      throw new AppError('route-mismatch', `Exit ${routeId} has no expected public address, so its use could not be verified`);
    }

    const runId = newId('run');
    const runToken = 'tok_' + randomBytes(12).toString('hex');
    const collectorUrl = this.collectorUrl();

    const manifest = RunManifest.parse({
      manifestVersion: 1,
      runId,
      runToken,
      createdAt: new Date().toISOString(),
      treatment: input.treatment,
      environment: env,
      guestCondition: guest?.conditionSeq ?? null,
      guestId: guest?.id ?? null,
      preset,
      image: image ? { id: image.id, sha256: image.sha256, version: image.version } : null,
      host: {
        hostId: caps.hostId, arch: caps.arch, os: caps.os, osRelease: caps.osRelease,
        cpuModel: caps.cpuModel, cpuCount: caps.cpuCount, totalMemMb: caps.totalMemMb,
      },
      software: {
        appVersion: this.ctx.appVersion,
        electronVersion: this.ctx.electronVersion,
        backend: 'qemu',
        backendVersion: qemu.version ?? 'unavailable',
        instrumentVersion: INSTRUMENT_VERSION,
      },
      network: { routeId, exit },
      collectorUrl,
      studyOptions: { placeStudyToken: !!input.placeStudyToken },
    });

    const dir = this.runDir(runId);
    mkdirSync(dir, { recursive: true });
    const manifestPath = path.join(dir, 'manifest.json');
    const manifestText = JSON.stringify(JSON.parse(canonicalJson(manifest)), null, 2);
    writeFileSync(manifestPath, manifestText, { flag: 'wx' });
    chmodSync(manifestPath, 0o444);

    const studyUrl = new URL(`/t/${runToken}${input.placeStudyToken ? '?place=1' : ''}`, collectorUrl).toString();

    const run: RunRecord = {
      id: runId, runToken, guestId: guest?.id ?? null, treatment: input.treatment, status: 'planned', statusReason: null,
      notes: input.notes.slice(0, 2000), createdAt: manifest.createdAt, finishedAt: null,
      manifestPath, manifestSha256: sha256(manifestText), studyUrl, guestStudyUrl: toGuestUrl(studyUrl),
    };
    this.ctx.db.putRun(run);

    const client = this.client();
    try {
      await client.registerRun({ runToken, runId, routeId });
    } catch (e) {
      const err = toErrorShape(e);
      this.update(runId, { status: 'invalid', statusReason: `registration failed: ${err.message}`, finishedAt: new Date().toISOString() });
      throw e;
    }
    await this.recordEgress(runId, runToken, routeId, 'start', exit.kind === 'default-nat' ? exit.expectedIp : null);
    return this.update(runId, { status: 'running' });
  }

  /** Host-side egress check through the collector's echo endpoint. */
  private async recordEgress(runId: string, runToken: string, routeId: string, phase: NetworkCheck['phase'], expectedIp: string | null): Promise<NetworkCheck> {
    let check: NetworkCheck;
    try {
      const echo = await this.client().echo(runToken);
      const changed = expectedIp !== null && echo.observedIp !== expectedIp;
      check = {
        runId, at: new Date().toISOString(), phase, routeId, collectorReachable: true,
        observedIp: echo.observedIp, expectedIp,
        verdict: changed ? 'invalid' : expectedIp ? 'valid' : 'unverified',
        reason: changed ? 'host egress changed during run' : expectedIp ? undefined : 'baseline: host egress recorded as expected exit for default NAT route',
      };
    } catch (e) {
      check = {
        runId, at: new Date().toISOString(), phase, routeId, collectorReachable: false,
        observedIp: null, expectedIp, verdict: 'invalid', reason: toErrorShape(e).message,
      };
    }
    this.ctx.db.addNetworkCheck(check);
    return check;
  }

  async finish(id: string): Promise<RunRecord> {
    const run = this.get(id);
    if (run.status !== 'running') throw new AppError('conflict', `Run is ${run.status}; only running runs can be finished`);
    const manifest = this.readManifest(run);
    const routeId = manifest.network.routeId;
    const startCheck = this.ctx.db.networkChecks(id).find((c) => c.phase === 'start');
    const exit: NetworkExit | null = manifest.network.exit;
    // Proxy exits must match their registered address; the default route must match the host's exit at start.
    const expected = exit?.kind === 'university-proxy' ? exit.expectedIp : exit?.expectedIp ?? startCheck?.observedIp ?? null;
    const hostExpected = exit?.kind === 'university-proxy' ? startCheck?.observedIp ?? null : expected;

    // If the collector is down this throws and the run stays open, to be finished once it is back.
    const detail = await this.client().runDetail(run.runToken);
    const endCheck = await this.recordEgress(id, run.runToken, routeId, 'end', hostExpected);

    // R3: every visit must have arrived from the expected exit.
    const visitChecks: NetworkCheck[] = detail.visits.map((v) => {
      const ok = expected !== null && v.peer_ip === expected;
      return {
        runId: id, at: v.received_at, phase: 'adhoc', routeId, collectorReachable: true,
        observedIp: v.peer_ip, expectedIp: expected,
        verdict: expected === null ? 'unverified' : ok ? 'valid' : 'invalid',
        reason: expected === null ? 'no baseline exit recorded' : ok ? `visit ${v.visit_id}` : `visit ${v.visit_id} arrived from unexpected exit`,
      };
    });
    visitChecks.forEach((c) => this.ctx.db.addNetworkCheck(c));

    const problems: string[] = [];
    if (detail.visits.length === 0) problems.push('no browser visit recorded');
    if (detail.guestReports.length === 0) problems.push('no guest agent report recorded');
    if (visitChecks.some((c) => c.verdict === 'invalid')) problems.push('visit from unexpected network exit');
    if (visitChecks.some((c) => c.verdict === 'unverified')) problems.push('visit exit could not be verified');
    if (endCheck.verdict === 'invalid') problems.push(`egress check at end failed: ${endCheck.reason}`);
    const stale = detail.visits.filter((v) => v.instrument_version !== manifest.software.instrumentVersion);
    if (stale.length) problems.push('instrument version differs from manifest');

    const status = problems.length ? 'invalid' : 'complete';
    const finishedAt = new Date().toISOString();
    const dir = this.runDir(id);
    const snapshotText = JSON.stringify(detail, null, 2);
    writeFileSync(path.join(dir, 'collector-snapshot.json'), snapshotText, { flag: 'wx' });
    const completion = {
      runId: id, finishedAt, status, problems,
      manifestSha256: run.manifestSha256,
      collectorSnapshotSha256: sha256(snapshotText),
      networkChecks: this.ctx.db.networkChecks(id),
    };
    const completionText = JSON.stringify(completion, null, 2);
    writeFileSync(path.join(dir, 'completion.json'), completionText, { flag: 'wx' });
    for (const f of ['collector-snapshot.json', 'completion.json']) chmodSync(path.join(dir, f), 0o444);
    return this.update(id, { status, statusReason: problems.join('; ') || null, finishedAt });
  }

  /** Called when a guest exits unexpectedly, and at startup for runs left open (R4). */
  interruptRunsFor(guestId: string | null, reason: string) {
    for (const r of this.list()) {
      if ((r.status === 'running' || r.status === 'planned') && (guestId === null || r.guestId === guestId)) {
        this.update(r.id, { status: 'interrupted', statusReason: reason, finishedAt: new Date().toISOString() });
      }
    }
  }

  /** The open run for a guest, as served to the in-guest runner. */
  openRunFor(guestId: string): { runToken: string; collectorUrl: string; studyUrl: string } | null {
    const r = this.list().find((x) => x.guestId === guestId && x.status === 'running');
    if (!r) return null;
    return { runToken: r.runToken, collectorUrl: new URL(r.guestStudyUrl).origin, studyUrl: r.guestStudyUrl };
  }

  /** A run still 'planned' at startup never finished registering: it cannot be trusted. */
  interruptPlanned(reason: string) {
    for (const r of this.list()) {
      if (r.status === 'planned') this.update(r.id, { status: 'interrupted', statusReason: reason, finishedAt: new Date().toISOString() });
    }
  }

  readManifest(run: RunRecord) {
    if (!existsSync(run.manifestPath)) throw new AppError('not-found', 'Run manifest file is missing');
    const text = readFileSync(run.manifestPath, 'utf8');
    if (sha256(text) !== run.manifestSha256) throw new AppError('checksum-mismatch', 'Run manifest has been modified since it was written');
    return RunManifest.parse(JSON.parse(text));
  }

  async detail(id: string): Promise<RunDetail> {
    const run = this.get(id);
    const manifest = this.readManifest(run);
    let collector: CollectorRunDetail | null = null;
    let collectorError = null;
    const snapPath = path.join(this.runDir(id), 'collector-snapshot.json');
    if (run.status === 'running' || !existsSync(snapPath)) {
      try {
        collector = await this.client().runDetail(run.runToken);
      } catch (e) {
        collectorError = toErrorShape(e);
      }
    } else {
      collector = JSON.parse(readFileSync(snapPath, 'utf8')) as CollectorRunDetail;
    }
    const networkChecks = this.ctx.db.networkChecks(id);
    const expected = networkChecks.find((c) => c.phase === 'start')?.observedIp ?? null;
    return {
      run, manifest, networkChecks, collector, collectorError,
      compare: buildCompare(manifest.preset, collector, expected),
      visitCount: collector?.visits.length ?? 0,
      guestReportCount: collector?.guestReports.length ?? 0,
    };
  }

  /**
   * Operator export of one run (not the blinded dataset). Written to a ".partial" folder and
   * renamed only once every file and the SHA256SUMS list are written, so an interrupted export
   * is visibly incomplete (brief §17).
   */
  exportRun(id: string, targetDir: string): { dir: string; files: string[] } {
    const run = this.get(id);
    this.readManifest(run); // integrity check first
    const finalDir = path.join(targetDir, `lvd-${run.id}`);
    if (existsSync(finalDir)) throw new AppError('conflict', `Export already exists: ${finalDir}`);
    const partial = finalDir + '.partial';
    mkdirSync(partial, { recursive: true });
    const files: Record<string, string> = {
      'manifest.json': readFileSync(run.manifestPath, 'utf8'),
      'run.json': JSON.stringify(run, null, 2),
      'network-checks.json': JSON.stringify(this.ctx.db.networkChecks(id), null, 2),
      'audit.json': JSON.stringify(this.ctx.db.listAudit(10_000, id), null, 2),
    };
    for (const f of ['collector-snapshot.json', 'completion.json']) {
      const p = path.join(this.runDir(id), f);
      if (existsSync(p)) files[f] = readFileSync(p, 'utf8');
    }
    const sums: string[] = [];
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(path.join(partial, name), text);
      sums.push(`${sha256(text)}  ${name}`);
    }
    writeFileSync(path.join(partial, 'SHA256SUMS'), sums.join(os.EOL) + os.EOL);
    renameSync(partial, finalDir);
    return { dir: finalDir, files: [...Object.keys(files), 'SHA256SUMS'] };
  }
}
