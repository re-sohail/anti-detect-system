import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RunManifest } from '@lvd/shared';
import type { HostCapabilities } from '@common/ipc';
import { AppError } from '../errors';
import type { Ctx } from './context';
import { run } from './exec';
import { sha256 } from './hash';

/**
 * Supervisor-side exports (plan Phases 1, 4, 5).
 * - Ground truth: which run token came from which host, guest, condition and environment.
 *   It is kept apart from observations and must never be given to the detection team.
 * - Host inventory: the one-page inventory the brief names as the immediate next artifact.
 */

export const GROUND_TRUTH_SCHEMA = 'lvd-ground-truth/1';

export function buildGroundTruth(ctx: Ctx, caps: HostCapabilities) {
  const runs = ctx.db.listRuns().map((r) => {
    let manifest: RunManifest | null = null;
    let manifestOk = false;
    if (existsSync(r.manifestPath)) {
      const text = readFileSync(r.manifestPath, 'utf8');
      manifestOk = sha256(text) === r.manifestSha256;
      manifest = RunManifest.parse(JSON.parse(text));
    }
    const consent = manifest?.environment.consentId ? ctx.db.getConsent(manifest.environment.consentId) : null;
    return {
      runToken: r.runToken,
      runId: r.id,
      status: r.status,
      statusReason: r.statusReason,
      treatment: r.treatment,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      manifestSha256: r.manifestSha256,
      manifestIntact: manifestOk,
      hostId: manifest?.host.hostId ?? caps.hostId,
      environment: manifest
        ? {
            kind: manifest.environment.kind,
            label: manifest.environment.label,
            participantCode: consent?.participantCode ?? null,
            consentWithdrawn: consent?.withdrawnAt ?? null,
            product: manifest.environment.product,
          }
        : null,
      guestId: r.guestId,
      guestCondition: manifest?.guestCondition ?? null,
      preset: manifest?.preset
        ? { id: manifest.preset.id, version: manifest.preset.version, name: manifest.preset.name, guestOs: manifest.preset.guest.os }
        : null,
      image: manifest?.image ?? null,
      routeId: manifest?.network.routeId ?? null,
      exitKind: manifest?.network.exit?.kind ?? null,
      software: manifest?.software ?? null,
    };
  });
  return {
    schema: GROUND_TRUTH_SCHEMA,
    exportedAt: new Date().toISOString(),
    hostId: caps.hostId,
    appVersion: ctx.appVersion,
    host: { arch: caps.arch, os: caps.os, osRelease: caps.osRelease, cpuModel: caps.cpuModel, cpuCount: caps.cpuCount, totalMemMb: caps.totalMemMb },
    exits: ctx.db.listExits(),
    runs,
  };
}

export function exportGroundTruth(ctx: Ctx, caps: HostCapabilities, targetDir: string) {
  const data = buildGroundTruth(ctx, caps);
  const stamp = data.exportedAt.replace(/[:.]/g, '-');
  const file = path.join(targetDir, `lvd-groundtruth-${caps.hostId}-${stamp}.json`);
  if (existsSync(file)) throw new AppError('conflict', `File exists: ${file}`);
  const text = JSON.stringify(data, null, 2);
  writeFileSync(file, text, { flag: 'wx' });
  writeFileSync(file + '.sha256', `${sha256(text)}  ${path.basename(file)}\n`, { flag: 'wx' });
  chmodSync(file, 0o400); // supervisor-only
  return { file, runs: data.runs.length };
}

async function hardwareExtras(): Promise<Record<string, string | null>> {
  if (process.platform === 'darwin') {
    const [model, gpu, sip] = await Promise.all([
      run('/usr/sbin/sysctl', ['-n', 'hw.model']),
      run('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json'], 20000),
      run('/usr/bin/sw_vers', []),
    ]);
    let gpuName: string | null = null;
    try {
      gpuName = (JSON.parse(gpu.stdout).SPDisplaysDataType?.[0]?.sppci_model as string) ?? null;
    } catch {
      gpuName = null;
    }
    const v = (k: string) => sip.stdout.match(new RegExp(`${k}:\\s*(\\S+)`))?.[1];
    return { model: model.stdout.trim() || null, gpu: gpuName, osBuild: v('ProductVersion') ? `macOS ${v('ProductVersion')} (${v('BuildVersion')})` : null };
  }
  if (process.platform === 'linux') {
    const model = await run('/bin/cat', ['/sys/devices/virtual/dmi/id/product_name']);
    return { model: model.stdout.trim() || null, gpu: null, osBuild: null };
  }
  return { model: null, gpu: null, osBuild: null };
}

export async function hostInventory(ctx: Ctx, caps: HostCapabilities) {
  const extras = await hardwareExtras();
  const qemu = caps.backends[0];
  const role =
    caps.supportedGuestArch.length === 0 ? 'control-only (no launchable guest)'
    : caps.totalMemMb < 12_288 || caps.cpuCount < 4 ? 'pilot-only (one light guest)'
    : 'reference host candidate (two-guest trials)';
  const inventory = {
    generatedAt: new Date().toISOString(),
    hostId: caps.hostId,
    model: extras.model,
    osBuild: extras.osBuild ?? caps.osRelease,
    arch: caps.arch,
    cpu: `${caps.cpuModel} (${caps.cpuCount} logical)`,
    ramMb: caps.totalMemMb,
    freeDiskMb: caps.freeDiskMb,
    gpu: extras.gpu,
    hypervisor: caps.hypervisor,
    qemu: { available: qemu.available, version: qemu.version },
    launchableGuestArch: caps.supportedGuestArch,
    suggestedRole: role,
    licensingNotes: 'TO FILL: guest OS licences, university licence references',
  };
  const md = [
    `# Host inventory — ${caps.hostId}`,
    '',
    `Generated ${inventory.generatedAt} by LVD Research Control ${ctx.appVersion}.`,
    '',
    '| Item | Value |',
    '|---|---|',
    `| Model | ${inventory.model ?? 'unknown'} |`,
    `| OS build | ${inventory.osBuild} |`,
    `| CPU architecture | ${inventory.arch} |`,
    `| CPU | ${inventory.cpu} |`,
    `| RAM | ${(inventory.ramMb / 1024).toFixed(1)} GB |`,
    `| Free disk (data folder) | ${inventory.freeDiskMb === null ? 'unknown' : (inventory.freeDiskMb / 1024).toFixed(1) + ' GB'} |`,
    `| GPU | ${inventory.gpu ?? 'unknown'} |`,
    `| Hardware virtualization | ${caps.hypervisor.available ? caps.hypervisor.kind : 'unavailable'} (${caps.hypervisor.detail}) |`,
    `| QEMU | ${qemu.available ? qemu.version : 'not installed'} |`,
    `| Launchable guest architectures | ${caps.supportedGuestArch.join(', ') || 'none'} |`,
    `| Suggested role | ${role} |`,
    `| Licensing | ${inventory.licensingNotes} |`,
    '',
    'Role rule: fewer than 12 GB RAM or 4 logical CPUs means pilot-only. The brief (§4) warns that the 2017 MacBook Air is a pilot host, not a reference host.',
    '',
  ].join('\n');
  return { inventory, markdown: md };
}
