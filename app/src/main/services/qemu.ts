import net from 'node:net';
import type { GuestArch, Preset } from '@lvd/shared';
import type { HostCapabilities } from '@common/ipc';
import { AppError } from '../errors';
import { run } from './exec';

/**
 * QEMU backend adapter (brief §4, §5). This is the only module that builds hypervisor
 * command lines. Every guest gets its own copy-on-write disk over an immutable base,
 * user-mode NAT networking, and a control socket reachable only by this app.
 */

export interface LaunchPaths {
  diskPath: string;
  qmpSocket: string;
  pidFile: string;
  firmware?: string;
  /** Guest serial console captured to a file (boot and cloud-init log; evidence for failures). */
  serialLog?: string;
}

export interface LaunchOptions {
  guestId: string;
  preset: Preset;
  display: 'window' | 'headless';
  vncDisplay: number | null;
  /** cloud-init NoCloud seed location (provisioned guests only). */
  smbios?: string;
}

function accelFor(hv: HostCapabilities['hypervisor']['kind']): string {
  if (hv === 'hvf') return 'hvf';
  if (hv === 'kvm') return 'kvm';
  if (hv === 'whpx') return 'whpx';
  throw new AppError('hypervisor-unavailable', 'No hardware hypervisor is available on this host');
}

function nativeDisplay(): string {
  if (process.platform === 'darwin') return 'cocoa';
  if (process.platform === 'win32') return 'sdl';
  return 'gtk';
}

export function buildArgs(caps: HostCapabilities, opts: LaunchOptions, paths: LaunchPaths): string[] {
  const { preset } = opts;
  const arch: GuestArch = preset.guest.arch;
  const accel = accelFor(caps.hypervisor.kind);
  const args: string[] = [
    '-name', `lvd-${opts.guestId}`,
    '-accel', accel,
    '-smp', String(preset.resources.vcpus),
    '-m', String(preset.resources.memoryMb),
    '-rtc', 'base=utc',
    '-drive', `if=virtio,format=qcow2,file=${paths.diskPath}`,
    '-nic', 'user,model=virtio-net-pci',
    '-device', 'qemu-xhci',
    '-device', 'usb-kbd',
    '-device', 'usb-tablet',
    '-qmp', `unix:${paths.qmpSocket},server=on,wait=off`,
    '-pidfile', paths.pidFile,
  ];
  if (paths.serialLog) args.push('-serial', `file:${paths.serialLog}`);
  if (arch === 'aarch64') {
    if (!paths.firmware) throw new AppError('backend-missing', 'UEFI firmware edk2-aarch64-code.fd not found next to QEMU');
    args.push('-machine', 'virt', '-cpu', 'host', '-bios', paths.firmware, '-device', 'virtio-gpu-pci');
  } else {
    args.push('-machine', 'q35', '-cpu', accel === 'whpx' ? 'max' : 'host', '-device', 'virtio-vga');
  }
  if (opts.smbios) args.push('-smbios', opts.smbios);
  if (opts.display === 'window') {
    args.push('-display', nativeDisplay());
  } else {
    // Display only on loopback, so it is reachable by this machine's controlling app alone (brief §5).
    if (opts.vncDisplay === null) throw new AppError('invalid-input', 'Headless display requires a VNC display number');
    args.push('-display', 'none', '-vnc', `127.0.0.1:${opts.vncDisplay}`);
  }
  return args;
}

export async function createOverlay(qemuImg: string, basePath: string, baseFormat: 'qcow2' | 'raw', overlayPath: string, sizeGb: number) {
  const r = await run(qemuImg, ['create', '-f', 'qcow2', '-F', baseFormat, '-b', basePath, overlayPath, `${sizeGb}G`], 60000);
  if (r.code !== 0) throw new AppError('internal', `qemu-img create failed: ${r.stderr.trim()}`);
}

export async function snapshot(qemuImg: string, op: 'create' | 'apply' | 'list', diskPath: string, name?: string): Promise<string[]> {
  const flag = { create: '-c', apply: '-a', list: '-l' }[op];
  const args = op === 'list' ? ['snapshot', '-l', diskPath] : ['snapshot', flag, name!, diskPath];
  const r = await run(qemuImg, args, 120000);
  if (r.code !== 0) throw new AppError('internal', `qemu-img snapshot ${op} failed: ${r.stderr.trim()}`);
  if (op !== 'list') return [];
  // Table rows: ID TAG VM_SIZE DATE VM_CLOCK ...
  return r.stdout
    .split('\n')
    .slice(2)
    .map((l) => l.trim().split(/\s+/)[1])
    .filter((t): t is string => !!t);
}

/** Minimal QMP client: one connection per command. */
export function qmp(socketPath: string, command: string, args?: Record<string, unknown>, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    let buf = '';
    let stage: 'greeting' | 'caps' | 'cmd' = 'greeting';
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new AppError('boot-timeout', `QMP ${command} timed out`));
    }, timeoutMs);
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      sock.end();
      fn();
    };
    sock.on('error', (e) => finish(() => reject(new AppError('internal', `QMP connection failed: ${e.message}`))));
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as Record<string, unknown>;
        if ('event' in msg) continue;
        if (stage === 'greeting' && 'QMP' in msg) {
          stage = 'caps';
          sock.write(JSON.stringify({ execute: 'qmp_capabilities' }) + '\n');
        } else if (stage === 'caps' && 'return' in msg) {
          stage = 'cmd';
          sock.write(JSON.stringify({ execute: command, ...(args ? { arguments: args } : {}) }) + '\n');
        } else if (stage === 'cmd') {
          if ('error' in msg) finish(() => reject(new AppError('internal', `QMP ${command}: ${JSON.stringify(msg.error)}`)));
          else finish(() => resolve(msg.return));
        }
      }
    });
  });
}

export async function waitForQmp(socketPath: string, timeoutMs: number, isAlive: () => boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive()) throw new AppError('boot-timeout', 'Hypervisor process exited during start');
    try {
      await qmp(socketPath, 'query-status', undefined, 1000);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new AppError('boot-timeout', `Guest control socket not ready after ${timeoutMs} ms`);
}
