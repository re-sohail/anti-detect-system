import os from 'node:os';
import path from 'node:path';
import { existsSync, statfsSync } from 'node:fs';
import type { GuestArch } from '@lvd/shared';
import type { HostCapabilities } from '@common/ipc';
import { run } from './exec';

/**
 * Host capability probe (brief §4). The guest catalogue is derived from these checks,
 * never from hard-coded promises. Only natively accelerated guest architectures are
 * offered: emulating a foreign architecture would not be a comparable study condition.
 */

const EXE = process.platform === 'win32' ? '.exe' : '';

function candidateDirs(): string[] {
  const dirs = [
    process.env.LVD_QEMU_DIR,
    ...(process.env.PATH ?? '').split(path.delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    'C:\\Program Files\\qemu',
  ].filter((d): d is string => !!d);
  return [...new Set(dirs)];
}

function findBinary(name: string): string | null {
  for (const d of candidateDirs()) {
    const p = path.join(d, name + EXE);
    if (existsSync(p)) return p;
  }
  return null;
}

const SYSTEM_BIN: Record<GuestArch, string> = { aarch64: 'qemu-system-aarch64', x86_64: 'qemu-system-x86_64' };

async function probeHypervisor(): Promise<HostCapabilities['hypervisor']> {
  if (process.platform === 'darwin') {
    const r = await run('/usr/sbin/sysctl', ['-n', 'kern.hv_support']);
    const ok = r.stdout.trim() === '1';
    return { available: ok, kind: ok ? 'hvf' : 'none', detail: `kern.hv_support=${r.stdout.trim() || 'unknown'}` };
  }
  if (process.platform === 'linux') {
    const ok = existsSync('/dev/kvm');
    return { available: ok, kind: ok ? 'kvm' : 'none', detail: ok ? '/dev/kvm present' : '/dev/kvm missing' };
  }
  if (process.platform === 'win32') {
    const r = await run('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_ComputerSystem).HypervisorPresent']);
    const ok = r.stdout.trim().toLowerCase() === 'true';
    return {
      available: ok,
      kind: ok ? 'whpx' : 'none',
      detail: ok ? 'Hypervisor present (Windows Hypervisor Platform must also be enabled)' : 'No hypervisor present',
    };
  }
  return { available: false, kind: 'none', detail: `Unsupported platform ${process.platform}` };
}

async function probeQemu(): Promise<HostCapabilities['backends'][number]> {
  const systemBinaries: Partial<Record<GuestArch, string>> = {};
  const firmware: Partial<Record<GuestArch, string>> = {};
  let version: string | null = null;
  let qemuImg: string | null = null;
  for (const arch of Object.keys(SYSTEM_BIN) as GuestArch[]) {
    const bin = findBinary(SYSTEM_BIN[arch]);
    if (!bin) continue;
    systemBinaries[arch] = bin;
    const dir = path.dirname(bin);
    // Prefer the qemu-img shipped next to qemu-system (avoids unrelated older copies on PATH).
    qemuImg ??= existsSync(path.join(dir, 'qemu-img' + EXE)) ? path.join(dir, 'qemu-img' + EXE) : null;
    if (!version) {
      const r = await run(bin, ['-version']);
      version = r.stdout.split('\n')[0]?.trim() || null;
    }
    if (arch === 'aarch64') {
      for (const share of [path.join(dir, '..', 'share', 'qemu'), path.join(dir, 'share')]) {
        const fw = path.join(share, 'edk2-aarch64-code.fd');
        if (existsSync(fw)) {
          firmware.aarch64 = path.resolve(fw);
          break;
        }
      }
    }
  }
  const available = Object.keys(systemBinaries).length > 0 && !!qemuImg;
  return {
    name: 'qemu',
    available,
    version,
    systemBinaries,
    qemuImg,
    firmware,
    detail: available
      ? `Found ${Object.values(systemBinaries).join(', ')}`
      : 'QEMU not found. Install it (macOS: `brew install qemu`) or set LVD_QEMU_DIR to the folder containing qemu-system-* and qemu-img.',
  };
}

/**
 * Memory the OS can hand to a new process now. On macOS os.freemem() excludes reclaimable
 * cache (free + inactive + speculative + purgeable pages), which badly understates it.
 */
async function availableMemMb(): Promise<number> {
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/vm_stat', []);
    const page = Number(r.stdout.match(/page size of (\d+) bytes/)?.[1] ?? 0);
    const count = (k: string) => Number(r.stdout.match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] ?? 0);
    const pages = count('Pages free') + count('Pages inactive') + count('Pages speculative') + count('Pages purgeable');
    if (page && pages) return Math.floor((pages * page) / 1024 / 1024);
  }
  return Math.floor(os.freemem() / 1024 / 1024);
}

export async function probeHost(dataDir: string, hostId: string): Promise<HostCapabilities> {
  const [hypervisor, qemu, freeMemMb] = await Promise.all([probeHypervisor(), probeQemu(), availableMemMb()]);
  let freeDiskMb: number | null = null;
  try {
    const s = statfsSync(dataDir);
    freeDiskMb = Math.floor((s.bavail * s.bsize) / 1024 / 1024);
  } catch {
    freeDiskMb = null;
  }
  const arch = os.arch();
  const nativeGuest: GuestArch | null = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : null;
  const supportedGuestArch: GuestArch[] =
    nativeGuest && hypervisor.available && qemu.systemBinaries[nativeGuest] ? [nativeGuest] : [];
  const cpus = os.cpus();
  return {
    hostId,
    probedAt: new Date().toISOString(),
    os: process.platform,
    osRelease: `${os.type()} ${os.release()}`,
    arch,
    cpuModel: cpus[0]?.model ?? 'unknown',
    cpuCount: cpus.length,
    totalMemMb: Math.floor(os.totalmem() / 1024 / 1024),
    freeMemMb,
    freeDiskMb,
    dataDir,
    hypervisor,
    backends: [qemu],
    supportedGuestArch,
  };
}
