/**
 * IPC contract between the renderer and the privileged main process (brief §5).
 * The renderer can call ONLY these channels, through the preload bridge. It never
 * receives filesystem, process or VM-management primitives.
 * No Node imports here: this file is shared with the renderer.
 */
import type {
  AppErrorShape, AuditEvent, Consent, DiffEntry, Environment, GuestArch, GuestOs, ImageRecord, NetworkCheck, NetworkExit,
  Preset, PresetInput, RunManifest, RunStatus, Treatment,
} from '@lvd/shared';

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape };

export interface HostCapabilities {
  hostId: string;
  probedAt: string;
  os: 'darwin' | 'win32' | 'linux' | string;
  osRelease: string;
  arch: 'arm64' | 'x64' | string;
  cpuModel: string;
  cpuCount: number;
  totalMemMb: number;
  freeMemMb: number;
  freeDiskMb: number | null;
  dataDir: string;
  hypervisor: { available: boolean; kind: 'hvf' | 'whpx' | 'kvm' | 'none'; detail: string };
  backends: Array<{
    name: 'qemu';
    available: boolean;
    version: string | null;
    systemBinaries: Partial<Record<GuestArch, string>>;
    qemuImg: string | null;
    firmware: Partial<Record<GuestArch, string>>;
    detail: string;
  }>;
  supportedGuestArch: GuestArch[];
}

export interface PrereqCheck {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface PresetCheckResult {
  presetId: string;
  launchable: boolean;
  checks: PrereqCheck[];
}

export type GuestState = 'created' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'error';

export interface GuestRecord {
  id: string;
  name: string;
  presetId: string;
  presetVersion: number;
  imageId: string;
  diskPath: string;
  state: GuestState;
  pid: number | null;
  display: 'window' | 'headless';
  vncPort: number | null;
  conditionSeq: number;
  lastError: AppErrorShape | null;
  createdAt: string;
  updatedAt: string;
  snapshots: string[];
  provisioning: { mode: 'cloud-init' | 'manual'; secret: string | null; provisionedAt: string | null };
}

export interface RunRecord {
  id: string;
  runToken: string;
  guestId: string | null;
  treatment: Treatment;
  status: RunStatus;
  statusReason: string | null;
  notes: string;
  createdAt: string;
  finishedAt: string | null;
  manifestPath: string;
  manifestSha256: string;
  studyUrl: string;
  guestStudyUrl: string;
}

export interface CompareRow {
  key: string;
  label: string;
  selected: string | null;
  guestReported: string | null;
  browserReported: string | null;
  serverObserved: string | null;
  mismatch: boolean;
}

export interface RunDetail {
  run: RunRecord;
  manifest: RunManifest;
  networkChecks: NetworkCheck[];
  collector: unknown | null;
  collectorError: AppErrorShape | null;
  compare: CompareRow[];
  visitCount: number;
  guestReportCount: number;
}

export interface Settings {
  collectorUrl: string;
  operator: string;
  hasAdminKey: boolean;
  provisionPort: number;
}

export interface Stat { n: number; median: number | null; p90: number | null; p95: number | null; max: number | null }

export interface PerfReport {
  generatedAt: string;
  hostId: string;
  guests: Array<{
    guestId: string; name: string; presetId: string; starts: number;
    controlReadyMs: Stat; provisioningBootMs: Stat; desktopReadyMs: Stat; browserLaunchMs: Stat;
    idleRssMb: Stat; activeRssMb: Stat; cpuPct: Stat;
    diskGrowthMb: number | null; powerSources: string[]; thermalStates: string[]; samples: number;
  }>;
  maxConcurrentGuests: number;
  note: string;
}

export interface StartRunInput {
  guestId: string | null;
  treatment: Treatment;
  notes: string;
  environment: { kind: Environment['kind']; label: string; consentId?: string | null; product?: Environment['product'] };
  routeId?: string;
  /** R1: the study page plants a benign token in this browser's storage. */
  placeStudyToken?: boolean;
}

export interface ImageMeta {
  name: string;
  version: string;
  origin: string;
  guestOs: GuestOs;
  guestArch: GuestArch;
  licenseNotes: string;
  expectedSha256?: string;
  provisioning?: 'cloud-init' | 'manual';
}

/** channel -> [input, output] */
export interface Channels {
  'host.probe': [void, HostCapabilities];
  'settings.get': [void, Settings];
  'settings.set': [{ collectorUrl?: string; operator?: string; adminKey?: string; provisionPort?: number }, Settings];
  'images.list': [void, ImageRecord[]];
  'images.pickAndRegister': [ImageMeta, ImageRecord | null];
  'images.verify': [{ id: string }, { id: string; match: boolean; actual: string }];
  'images.promoteGuest': [{ guestId: string; name: string; version: string }, ImageRecord];
  'presets.list': [void, Preset[]];
  'presets.preview': [{ input: unknown; baseId?: string }, { valid: boolean; issues: string[]; diff: DiffEntry[] }];
  'presets.save': [{ input: PresetInput; baseId?: string }, Preset];
  'presets.check': [{ id: string }, PresetCheckResult];
  'guests.list': [void, GuestRecord[]];
  'guests.create': [{ presetId: string; name: string }, GuestRecord];
  'guests.start': [{ id: string; display: 'window' | 'headless' }, GuestRecord];
  'guests.stop': [{ id: string; force: boolean }, GuestRecord];
  'guests.pause': [{ id: string }, GuestRecord];
  'guests.resume': [{ id: string }, GuestRecord];
  'guests.snapshot': [{ id: string; name: string }, GuestRecord];
  'guests.reset': [{ id: string; name: string }, GuestRecord];
  'guests.delete': [{ id: string; confirmName: string }, { id: string }];
  'runs.list': [void, RunRecord[]];
  'runs.start': [StartRunInput, RunRecord];
  'runs.finish': [{ id: string }, RunRecord];
  'runs.detail': [{ id: string }, RunDetail];
  'runs.export': [{ id: string }, { dir: string; files: string[] } | null];
  'audit.list': [{ limit: number }, AuditEvent[]];
  'exits.list': [void, NetworkExit[]];
  'exits.save': [Omit<NetworkExit, 'approvedAt' | 'lastTest'>, NetworkExit];
  'exits.approve': [{ id: string; approvedBy: string }, NetworkExit];
  'exits.test': [{ id: string }, NetworkExit];
  'consents.list': [void, Consent[]];
  'consents.save': [Omit<Consent, 'id' | 'withdrawnAt'> & { id?: string }, Consent];
  'consents.withdraw': [{ id: string }, Consent];
  'perf.report': [void, PerfReport];
  'perf.export': [void, { file: string } | null];
  'study.hostInventory': [void, { inventory: Record<string, unknown>; markdown: string }];
  'study.saveHostInventory': [void, { files: string[] } | null];
  'study.exportGroundTruth': [void, { file: string; runs: number } | null];
}

export type Channel = keyof Channels;
export type In<C extends Channel> = Channels[C][0];
export type Out<C extends Channel> = Channels[C][1];

export const CHANNELS = [
  'host.probe', 'settings.get', 'settings.set',
  'images.list', 'images.pickAndRegister', 'images.verify', 'images.promoteGuest',
  'presets.list', 'presets.preview', 'presets.save', 'presets.check',
  'guests.list', 'guests.create', 'guests.start', 'guests.stop', 'guests.pause', 'guests.resume',
  'guests.snapshot', 'guests.reset', 'guests.delete',
  'runs.list', 'runs.start', 'runs.finish', 'runs.detail', 'runs.export',
  'audit.list',
  'exits.list', 'exits.save', 'exits.approve', 'exits.test',
  'consents.list', 'consents.save', 'consents.withdraw',
  'perf.report', 'perf.export',
  'study.hostInventory', 'study.saveHostInventory', 'study.exportGroundTruth',
] as const satisfies readonly Channel[];

export type LvdApi = {
  invoke<C extends Channel>(channel: C, input: In<C>): Promise<Result<Out<C>>>;
};
