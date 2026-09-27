import { existsSync } from 'node:fs';
import { Preset, PresetInput, diffObjects, type DiffEntry } from '@lvd/shared';
import type { HostCapabilities, PresetCheckResult, PrereqCheck } from '@common/ipc';
import { AppError } from '../errors';
import type { Ctx } from './context';
import { newId } from './hash';
import { getExit } from './exits';

/** Memory kept for the host OS and the control app when admitting guests. */
export const HOST_RESERVE_MB = 2048;

export function previewPreset(ctx: Ctx, input: unknown, baseId?: string): { valid: boolean; issues: string[]; diff: DiffEntry[] } {
  const parsed = PresetInput.safeParse(input);
  const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  const base = baseId ? ctx.db.getPreset(baseId) : null;
  const before = base ? PresetInput.parse(base) : {};
  return { valid: parsed.success, issues, diff: diffObjects(before, parsed.success ? parsed.data : input) };
}

/** Saving never edits a preset in place: it appends a new version. */
export function savePreset(ctx: Ctx, input: PresetInput, baseId?: string): Preset {
  const data = PresetInput.parse(input);
  if (!ctx.db.getImage(data.guest.imageId)) throw new AppError('missing-image', 'Preset refers to an unknown image');
  const base = baseId ? ctx.db.getPreset(baseId) : null;
  if (baseId && !base) throw new AppError('not-found', `Unknown preset ${baseId}`);
  if (base && diffObjects(PresetInput.parse(base), data).length === 0) return base;
  const preset = Preset.parse({
    ...data,
    id: base?.id ?? newId('preset'),
    version: (base?.version ?? 0) + 1,
    createdAt: new Date().toISOString(),
    smokeTest: { status: 'untested' },
  });
  ctx.db.insertPreset(preset);
  return preset;
}

export function checkPreset(ctx: Ctx, preset: Preset, caps: HostCapabilities): PresetCheckResult {
  const checks: PrereqCheck[] = [];
  const add = (id: string, label: string, pass: boolean, detail: string) => checks.push({ id, label, pass, detail });
  const qemu = caps.backends.find((b) => b.name === 'qemu');
  const img = ctx.db.getImage(preset.guest.imageId);
  const arch = preset.guest.arch;

  add('host-arch', 'Host architecture allowed', preset.hostConstraint.arch.includes(caps.arch as never),
    `host ${caps.arch}; preset allows ${preset.hostConstraint.arch.join(', ')}`);
  add('host-os', 'Host OS allowed', preset.hostConstraint.os.includes(caps.os as never),
    `host ${caps.os}; preset allows ${preset.hostConstraint.os.join(', ')}`);
  add('host-ram', 'Host RAM meets preset minimum', caps.totalMemMb >= preset.hostConstraint.minHostRamMb,
    `host ${caps.totalMemMb} MB; minimum ${preset.hostConstraint.minHostRamMb} MB`);
  add('hypervisor', 'Hardware hypervisor available', caps.hypervisor.available, caps.hypervisor.detail);
  add('backend', 'QEMU backend installed', !!qemu?.available, qemu?.detail ?? 'no backend');
  add('guest-arch', `Guest architecture ${arch} is natively accelerated`, caps.supportedGuestArch.includes(arch),
    caps.supportedGuestArch.length ? `supported: ${caps.supportedGuestArch.join(', ')}` : 'no accelerated guest architecture on this host');
  if (arch === 'aarch64') add('firmware', 'UEFI firmware present', !!qemu?.firmware.aarch64, qemu?.firmware.aarch64 ?? 'edk2-aarch64-code.fd not found');
  add('image', 'Base image registered and present', !!img && img.status === 'active' && existsSync(img.path),
    img ? `${img.name} ${img.version} (${img.path})` : 'image not registered');
  if (img) {
    add('image-match', 'Image OS/arch match preset', img.guestArch === arch && img.guestOs === preset.guest.os,
      `image ${img.guestOs}/${img.guestArch}; preset ${preset.guest.os}/${arch}`);
  }
  const needDisk = preset.resources.diskGb * 1024;
  add('disk', 'Free disk for the guest disk at full size', caps.freeDiskMb !== null && caps.freeDiskMb >= needDisk,
    `free ${caps.freeDiskMb ?? 'unknown'} MB; need ${needDisk} MB`);
  const committed = ctx.db
    .listGuests()
    .filter((g) => g.state === 'running' || g.state === 'paused' || g.state === 'starting')
    .reduce((sum, g) => sum + (ctx.db.getPreset(g.presetId, g.presetVersion)?.resources.memoryMb ?? 0), 0);
  const available = caps.totalMemMb - HOST_RESERVE_MB - committed;
  add('memory', 'Memory available after running guests and host reserve', preset.resources.memoryMb <= available,
    `need ${preset.resources.memoryMb} MB; available ${available} MB (total ${caps.totalMemMb} − reserve ${HOST_RESERVE_MB} − running guests ${committed})`);
  const exit = getExit(ctx, preset.network.routeId);
  add('route', 'Network exit registered and approved', !!exit?.approvedAt,
    exit ? `${exit.id} (${exit.kind})${exit.approvedAt ? ', approved by ' + exit.approvedBy : ', NOT approved'}` : `unknown route ${preset.network.routeId}`);
  add('vcpus', 'vCPUs do not exceed host CPUs', preset.resources.vcpus <= caps.cpuCount,
    `need ${preset.resources.vcpus}; host has ${caps.cpuCount}`);

  return { presetId: preset.id, launchable: checks.every((c) => c.pass), checks };
}

export function requireLaunchable(ctx: Ctx, preset: Preset, caps: HostCapabilities) {
  const result = checkPreset(ctx, preset, caps);
  if (!result.launchable) {
    const failed = result.checks.filter((c) => !c.pass);
    const first = failed[0];
    const code =
      first.id === 'hypervisor' ? 'hypervisor-unavailable'
      : first.id === 'backend' || first.id === 'firmware' ? 'backend-missing'
      : first.id === 'guest-arch' || first.id === 'host-arch' || first.id === 'image-match' ? 'unsupported-arch'
      : first.id === 'host-os' ? 'unsupported-os'
      : first.id === 'disk' ? 'insufficient-disk'
      : first.id === 'route' ? 'route-mismatch'
      : first.id === 'memory' || first.id === 'host-ram' || first.id === 'vcpus' ? 'insufficient-memory'
      : 'missing-image';
    throw new AppError(code, `Launch blocked: ${first.label} — ${first.detail}`, { failed });
  }
  return result;
}
