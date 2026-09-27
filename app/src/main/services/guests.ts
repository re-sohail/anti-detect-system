import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { GuestRecord, GuestState } from '@common/ipc';
import { AppError, toErrorShape } from '../errors';
import type { Ctx } from './context';
import { newId } from './hash';
import { requireVerifiedImage } from './images';
import { requireLaunchable } from './presets';
import { buildArgs, createOverlay, qmp, snapshot, waitForQmp } from './qemu';
import { smbiosSeedArg } from './provisioning';
import { randomBytes } from 'node:crypto';

/**
 * Guest lifecycle (brief §5). Each guest has an independent disk (copy-on-write over an
 * immutable base) and therefore an independent browser data directory. Every state change
 * is persisted; errors are recorded on the guest but never touch evidence records.
 */

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 60_000;

export type GuestExitListener = (guestId: string, reason: string) => void;

export class GuestService {
  private procs = new Map<string, ChildProcess>();
  private stopping = new Set<string>();
  private exitListeners: GuestExitListener[] = [];

  constructor(private ctx: Ctx, private provisionPort: () => number = () => 4180) {}

  onUnexpectedExit(fn: GuestExitListener) {
    this.exitListeners.push(fn);
  }

  list(): GuestRecord[] {
    return this.ctx.db.listGuests();
  }

  get(id: string): GuestRecord {
    const g = this.ctx.db.getGuest(id);
    if (!g) throw new AppError('not-found', `Unknown guest ${id}`);
    return g;
  }

  private guestDir(id: string) {
    return path.join(this.ctx.dataDir, 'guests', id);
  }

  private qmpPath(id: string) {
    return path.join(this.ctx.runtimeDir, `${id}.qmp`);
  }

  private save(g: GuestRecord, patch: Partial<GuestRecord>): GuestRecord {
    const next = { ...g, ...patch, updatedAt: new Date().toISOString() };
    this.ctx.db.putGuest(next);
    return next;
  }

  private setState(id: string, state: GuestState, patch: Partial<GuestRecord> = {}) {
    return this.save(this.get(id), { state, ...patch });
  }

  async create(presetId: string, name: string): Promise<GuestRecord> {
    const trimmed = name.trim();
    if (!/^[\w .-]{1,60}$/.test(trimmed)) throw new AppError('invalid-input', 'Guest name: 1–60 letters, digits, space, dot, dash or underscore');
    if (this.list().some((g) => g.name === trimmed)) throw new AppError('conflict', `A guest named "${trimmed}" already exists`);
    const preset = this.ctx.db.getPreset(presetId);
    if (!preset) throw new AppError('not-found', `Unknown preset ${presetId}`);
    const caps = await this.ctx.probe();
    requireLaunchable(this.ctx, preset, caps);
    const img = await requireVerifiedImage(this.ctx, preset.guest.imageId);
    const qemuImg = caps.backends[0].qemuImg!;

    const id = newId('guest');
    const dir = this.guestDir(id);
    mkdirSync(dir, { recursive: true });
    const diskPath = path.join(dir, 'disk.qcow2');
    await createOverlay(qemuImg, img.path, img.format, diskPath, preset.resources.diskGb);
    const now = new Date().toISOString();
    const g: GuestRecord = {
      id, name: trimmed, presetId: preset.id, presetVersion: preset.version, imageId: img.id, diskPath,
      state: 'created', pid: null, display: 'window', vncPort: null, conditionSeq: 1, lastError: null,
      createdAt: now, updatedAt: now, snapshots: [],
      provisioning: {
        mode: img.provisioning,
        secret: img.provisioning === 'cloud-init' ? randomBytes(16).toString('hex') : null,
        provisionedAt: null,
      },
    };
    this.ctx.db.putGuest(g);
    return g;
  }

  async start(id: string, display: 'window' | 'headless'): Promise<GuestRecord> {
    const g = this.get(id);
    if (g.state === 'running' || g.state === 'starting' || g.state === 'paused') throw new AppError('conflict', `Guest is already ${g.state}`);
    if (!existsSync(g.diskPath)) throw new AppError('missing-image', `Guest disk missing: ${g.diskPath}`);
    const preset = this.ctx.db.getPreset(g.presetId, g.presetVersion);
    if (!preset) throw new AppError('not-found', 'Preset version for this guest no longer exists');
    const caps = await this.ctx.probe();
    requireLaunchable(this.ctx, preset, caps);
    await requireVerifiedImage(this.ctx, g.imageId);
    const qemu = caps.backends[0];
    const bin = qemu.systemBinaries[preset.guest.arch];
    if (!bin) throw new AppError('backend-missing', `qemu-system for ${preset.guest.arch} not found`);

    mkdirSync(this.ctx.runtimeDir, { recursive: true });
    if (process.platform !== 'win32') chmodSync(this.ctx.runtimeDir, 0o700);
    const qmpSocket = this.qmpPath(id);
    rmSync(qmpSocket, { force: true });
    const vncDisplay = display === 'headless' ? this.freeVncDisplay() : null;
    const dir = this.guestDir(id);
    const smbios = g.provisioning.mode === 'cloud-init' && g.provisioning.secret
      ? smbiosSeedArg(this.provisionPort(), id, g.provisioning.secret)
      : undefined;
    const args = buildArgs(caps, { guestId: id, preset, display, vncDisplay, smbios }, {
      diskPath: g.diskPath, qmpSocket, pidFile: path.join(dir, 'qemu.pid'), firmware: qemu.firmware.aarch64,
      serialLog: path.join(dir, `serial-${Date.now()}.log`),
    });

    this.ctx.db.addGuestEvent(id, 'start-requested', null, { display, conditionSeq: g.conditionSeq });
    const logPath = path.join(dir, 'qemu.log');
    const logFd = openSync(logPath, 'a');
    const child = spawn(bin, args, { stdio: ['ignore', logFd, logFd], detached: true });
    closeSync(logFd);
    this.procs.set(id, child);
    let exited = false;
    child.on('exit', (code, signal) => {
      exited = true;
      this.procs.delete(id);
      const expected = this.stopping.delete(id);
      const cur = this.ctx.db.getGuest(id);
      if (!cur) return;
      if (expected) {
        this.save(cur, { state: 'stopped', pid: null, vncPort: null });
      } else {
        const reason = `hypervisor exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'none'})`;
        this.save(cur, {
          state: cur.state === 'starting' ? 'error' : 'stopped',
          pid: null, vncPort: null,
          lastError: { code: 'internal', message: reason, details: { logTail: tail(logPath) } },
        });
        for (const fn of this.exitListeners) fn(id, reason);
      }
    });
    child.unref();

    this.setState(id, 'starting', { pid: child.pid ?? null, display, vncPort: vncDisplay === null ? null : 5900 + vncDisplay, lastError: null });
    try {
      await waitForQmp(qmpSocket, START_TIMEOUT_MS, () => !exited);
    } catch (e) {
      if (!exited) {
        this.stopping.add(id);
        child.kill('SIGKILL');
      }
      const err = e instanceof AppError ? e : new AppError('boot-timeout', String(e));
      this.setState(id, 'error', { lastError: { ...toErrorShape(err), details: { logTail: tail(logPath) } } });
      throw err;
    }
    this.ctx.db.addGuestEvent(id, 'control-ready', null);
    return this.setState(id, 'running');
  }

  async stop(id: string, force: boolean): Promise<GuestRecord> {
    const g = this.get(id);
    if (g.state !== 'running' && g.state !== 'paused' && g.state !== 'starting') {
      throw new AppError('conflict', `Guest is ${g.state}, not running`);
    }
    this.stopping.add(id);
    this.setState(id, 'stopping');
    const sock = this.qmpPath(id);
    try {
      if (force) {
        await qmp(sock, 'quit');
      } else {
        if (g.state === 'paused') await qmp(sock, 'cont');
        await qmp(sock, 'system_powerdown');
        const done = await this.waitForExit(id, STOP_TIMEOUT_MS);
        if (!done) await qmp(sock, 'quit');
      }
    } catch (e) {
      // Control socket gone: fall back to killing the recorded process.
      if (g.pid && isAlive(g.pid)) process.kill(g.pid, 'SIGKILL');
      if (!(e instanceof AppError)) throw e;
    }
    await this.waitForExit(id, 10_000);
    const cur = this.get(id);
    return cur.state === 'stopping' ? this.save(cur, { state: 'stopped', pid: null, vncPort: null }) : cur;
  }

  async pause(id: string): Promise<GuestRecord> {
    const g = this.get(id);
    if (g.state !== 'running') throw new AppError('conflict', `Guest is ${g.state}, not running`);
    await qmp(this.qmpPath(id), 'stop');
    return this.setState(id, 'paused');
  }

  async resume(id: string): Promise<GuestRecord> {
    const g = this.get(id);
    if (g.state !== 'paused') throw new AppError('conflict', `Guest is ${g.state}, not paused`);
    await qmp(this.qmpPath(id), 'cont');
    return this.setState(id, 'running');
  }

  private async requireStoppedWithTool(id: string) {
    const g = this.get(id);
    if (!['created', 'stopped', 'error'].includes(g.state)) throw new AppError('conflict', 'Stop the guest before changing snapshots');
    const qemuImg = (await this.ctx.probe()).backends[0].qemuImg;
    if (!qemuImg) throw new AppError('backend-missing', 'qemu-img not found');
    return { g, qemuImg };
  }

  async snapshot(id: string, name: string): Promise<GuestRecord> {
    if (!/^[\w.-]{1,40}$/.test(name)) throw new AppError('invalid-input', 'Snapshot name: 1–40 letters, digits, dot, dash or underscore');
    const { g, qemuImg } = await this.requireStoppedWithTool(id);
    if (g.snapshots.includes(name)) throw new AppError('conflict', `Snapshot "${name}" already exists`);
    await snapshot(qemuImg, 'create', g.diskPath, name);
    return this.save(g, { snapshots: await snapshot(qemuImg, 'list', g.diskPath) });
  }

  /** Restoring a snapshot resets cookies and installed state: it starts a new experimental condition (brief §11). */
  async reset(id: string, name: string): Promise<GuestRecord> {
    const { g, qemuImg } = await this.requireStoppedWithTool(id);
    if (!g.snapshots.includes(name)) throw new AppError('not-found', `No snapshot "${name}"`);
    await snapshot(qemuImg, 'apply', g.diskPath, name);
    return this.save(g, { conditionSeq: g.conditionSeq + 1 });
  }

  async delete(id: string, confirmName: string): Promise<{ id: string }> {
    const g = this.get(id);
    if (confirmName !== g.name) throw new AppError('invalid-input', 'Type the guest name exactly to confirm deletion');
    if (!['created', 'stopped', 'error'].includes(g.state)) throw new AppError('conflict', 'Stop the guest before deleting it');
    rmSync(this.guestDir(id), { recursive: true, force: true });
    this.ctx.db.deleteGuest(id);
    return { id };
  }

  /**
   * Crash recovery (brief §5, §11): after an app restart, reconcile recorded state with
   * reality. Guests whose process vanished are marked stopped with a recorded reason.
   * Returns guests that were found not running although recorded as active.
   */
  reconcile(): string[] {
    const lost: string[] = [];
    for (const g of this.list()) {
      if (!['starting', 'running', 'paused', 'stopping'].includes(g.state)) continue;
      if (g.pid && isAlive(g.pid)) continue;
      lost.push(g.id);
      this.save(g, {
        state: 'stopped', pid: null, vncPort: null,
        lastError: { code: 'internal', message: 'Guest was not running when the app restarted (guest crash or host shutdown)' },
      });
    }
    return lost;
  }

  isRunning(id: string): boolean {
    const g = this.ctx.db.getGuest(id);
    return !!g && (g.state === 'running' || g.state === 'paused') && !!g.pid && isAlive(g.pid);
  }

  private freeVncDisplay(): number {
    const used = new Set(this.list().filter((g) => g.vncPort).map((g) => g.vncPort! - 5900));
    for (let n = 10; n < 100; n++) if (!used.has(n)) return n;
    throw new AppError('conflict', 'No free local display slot');
  }

  private async waitForExit(id: string, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (!this.procs.has(id)) {
        const g = this.ctx.db.getGuest(id);
        if (!g?.pid || !isAlive(g.pid)) return true;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tail(p: string, lines = 20): string {
  try {
    return readFileSync(p, 'utf8').split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}
