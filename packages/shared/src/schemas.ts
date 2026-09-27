import { z } from 'zod';
import { REASON_CODES } from './reasonCodes.ts';

/* ------------------------------------------------------------------ */
/* Observations (browser side, brief §8)                               */
/* ------------------------------------------------------------------ */

export const Observation = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), value: z.unknown(), durationMs: z.number().nonnegative().optional() }),
  z.object({ status: z.literal('absent'), reason: z.enum(REASON_CODES), detail: z.string().max(500).optional() }),
]);
export type Observation = z.infer<typeof Observation>;

export const COLLECT_SCHEMA_VERSION = 1;

export const CollectPayload = z.object({
  schemaVersion: z.literal(COLLECT_SCHEMA_VERSION),
  instrumentVersion: z.string().min(1),
  runToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  visitId: z.uuid(),
  clientTime: z.iso.datetime(),
  observations: z.record(z.string(), Observation),
});
export type CollectPayload = z.infer<typeof CollectPayload>;

/* ------------------------------------------------------------------ */
/* Guest agent report (facts from inside the guest, brief §5)          */
/* ------------------------------------------------------------------ */

export const GuestReport = z.object({
  schemaVersion: z.literal(1),
  runToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  reportedAt: z.iso.datetime(),
  agentVersion: z.string(),
  os: z.string(),
  osVersion: z.string().optional(),
  kernel: z.string().optional(),
  timeZone: z.string().optional(),
  locale: z.string().optional(),
  display: z.object({ width: z.number().int(), height: z.number().int(), scale: z.number().optional() }).optional(),
  cpus: z.number().int().optional(),
  memoryMb: z.number().int().optional(),
  chromeVersion: z.string().optional(),
});
export type GuestReport = z.infer<typeof GuestReport>;

/* ------------------------------------------------------------------ */
/* Images, presets (brief §4, §5, §6)                                  */
/* ------------------------------------------------------------------ */

export const GuestArch = z.enum(['aarch64', 'x86_64']);
export const GuestOs = z.enum(['linux', 'windows', 'macos']);
export const HostArch = z.enum(['arm64', 'x64']);
export const HostOs = z.enum(['darwin', 'win32', 'linux']);
export const Backend = z.enum(['qemu']);
export type GuestArch = z.infer<typeof GuestArch>;
export type GuestOs = z.infer<typeof GuestOs>;
export type HostArch = z.infer<typeof HostArch>;
export type HostOs = z.infer<typeof HostOs>;

export const ImageRecord = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(60),
  origin: z.string().min(1).max(500),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  guestOs: GuestOs,
  guestArch: GuestArch,
  format: z.enum(['qcow2', 'raw']),
  licenseNotes: z.string().max(2000),
  path: z.string(),
  addedAt: z.iso.datetime(),
  status: z.enum(['active', 'superseded']),
  /** 'cloud-init': the app applies the preset (timezone, locale, display, browser policy) on first boot. */
  provisioning: z.enum(['cloud-init', 'manual']).default('manual'),
});
export type ImageRecord = z.infer<typeof ImageRecord>;

const IANA_TZ = z.string().regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/);
const BCP47 = z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);

export const PresetInput = z.object({
  name: z.string().min(3).max(80),
  description: z.string().max(1000).default(''),
  hostConstraint: z.object({
    arch: z.array(HostArch).min(1),
    os: z.array(HostOs).min(1),
    minHostRamMb: z.number().int().min(1024),
    backend: Backend,
  }),
  guest: z.object({ os: GuestOs, arch: GuestArch, imageId: z.string().min(1) }),
  resources: z.object({
    vcpus: z.number().int().min(1).max(16),
    memoryMb: z.number().int().min(512).max(65536),
    diskGb: z.number().int().min(4).max(1024),
  }),
  display: z.object({
    width: z.number().int().min(640).max(7680),
    height: z.number().int().min(480).max(4320),
  }),
  regional: z.object({ timeZone: IANA_TZ, locale: BCP47 }),
  network: z.object({ routeId: z.string().min(1).default('default-nat') }),
  expectedBootState: z.enum(['desktop-login', 'desktop-autologin', 'console']),
});
export type PresetInput = z.infer<typeof PresetInput>;

export const Preset = PresetInput.extend({
  id: z.string(),
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  smokeTest: z
    .object({ status: z.enum(['untested', 'passed', 'failed']), at: z.iso.datetime().optional(), note: z.string().optional() })
    .default({ status: 'untested' }),
});
export type Preset = z.infer<typeof Preset>;

/* ------------------------------------------------------------------ */
/* Runs (brief §9, §11, §17)                                           */
/* ------------------------------------------------------------------ */

/** The six first-pass treatment families (brief §9), plus competitor/pilot runs. */
export const TREATMENTS = {
  'T1-profiles-one-os': 'Two browser profiles in one OS',
  'T2-vms-one-host': 'Two VMs on one host',
  'T3-physical-hosts': 'Browsers on two physical hosts',
  'T4-restarts': 'Repeated visits across restarts',
  'T5-display-regional': 'Declared display and regional changes',
  'T6-network': 'Independently verified network changes',
  'PILOT': 'Feasibility pilot (not study data)',
} as const;
export const Treatment = z.enum(Object.keys(TREATMENTS) as [keyof typeof TREATMENTS, ...(keyof typeof TREATMENTS)[]]);
export type Treatment = z.infer<typeof Treatment>;

export const RunStatus = z.enum(['planned', 'running', 'complete', 'interrupted', 'invalid']);
export type RunStatus = z.infer<typeof RunStatus>;

/* ------------------------------------------------------------------ */
/* Environments, network exits, consent (brief §7, §9, §15)            */
/* ------------------------------------------------------------------ */

export const ENVIRONMENT_KINDS = {
  'managed-guest': 'Guest managed by this app',
  'host-profile': 'Browser profile on this host (no guest)',
  'physical-control': 'Physically separate control computer (consent required)',
  'vendor-product': 'Third-party product under the competitor protocol',
  'device-cloud': 'Provider-owned real device',
} as const;
export const EnvironmentKind = z.enum(Object.keys(ENVIRONMENT_KINDS) as [keyof typeof ENVIRONMENT_KINDS, ...(keyof typeof ENVIRONMENT_KINDS)[]]);
export type EnvironmentKind = z.infer<typeof EnvironmentKind>;

export const Environment = z.object({
  kind: EnvironmentKind,
  /** Internal label, e.g. "profile B" or "control laptop 3". Never exported to the blue team. */
  label: z.string().min(1).max(80),
  consentId: z.string().nullable().default(null),
  product: z
    .object({
      name: z.string().min(1).max(80),
      edition: z.string().max(80),
      version: z.string().min(1).max(80),
      configuration: z.string().max(200).default('default'),
      vendorUrl: z.string().max(300),
      lawfulAccess: z.string().min(1).max(300),
      embeddedEngine: z.string().max(80).optional(),
    })
    .nullable()
    .default(null),
});
export type Environment = z.infer<typeof Environment>;

export const NetworkExit = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  kind: z.enum(['default-nat', 'university-proxy']),
  owner: z.string().min(1).max(120),
  locationClaim: z.string().max(120),
  networkType: z.string().max(80),
  /** For proxy exits: the proxy the guest browser is pinned to (e.g. http://proxy.uni.example:3128). */
  proxyUrl: z.string().max(300).nullable().default(null),
  /** Public address the collector is expected to observe; null = take the host's observed exit at run start. */
  expectedIp: z.string().max(64).nullable().default(null),
  approvedBy: z.string().max(120),
  approvedAt: z.iso.datetime().nullable().default(null),
  notes: z.string().max(2000).default(''),
  lastTest: z.object({ at: z.iso.datetime(), observedIp: z.string().nullable(), ok: z.boolean(), detail: z.string() }).nullable().default(null),
});
export type NetworkExit = z.infer<typeof NetworkExit>;

export const Consent = z.object({
  id: z.string(),
  /** Pseudonymous participant code; the name-to-code key is held on paper/offline by the consent officer. */
  participantCode: z.string().regex(/^[A-Za-z0-9-]{2,32}$/),
  machineDescription: z.string().min(1).max(300),
  consentFormVersion: z.string().min(1).max(40),
  signedAt: z.iso.date(),
  obtainedBy: z.string().min(1).max(120),
  withdrawnAt: z.iso.date().nullable().default(null),
  notes: z.string().max(1000).default(''),
});
export type Consent = z.infer<typeof Consent>;

export const RunManifest = z.object({
  manifestVersion: z.literal(1),
  runId: z.string(),
  runToken: z.string(),
  createdAt: z.iso.datetime(),
  treatment: Treatment,
  environment: Environment,
  /** Increments whenever a snapshot is restored: a new experimental condition (brief §11). */
  guestCondition: z.number().int().nullable(),
  /** null for external-browser runs (host profiles, physical control machines). */
  guestId: z.string().nullable(),
  preset: Preset.nullable(),
  image: z.object({ id: z.string(), sha256: z.string(), version: z.string() }).nullable(),
  host: z.object({
    hostId: z.string(),
    arch: z.string(),
    os: z.string(),
    osRelease: z.string(),
    cpuModel: z.string(),
    cpuCount: z.number().int(),
    totalMemMb: z.number().int(),
  }),
  software: z.object({
    appVersion: z.string(),
    electronVersion: z.string(),
    backend: Backend,
    backendVersion: z.string(),
    instrumentVersion: z.string(),
  }),
  network: z.object({ routeId: z.string(), exit: NetworkExit.nullable() }),
  collectorUrl: z.string(),
  /** Study-page conditions, e.g. planting the benign R1 storage token on this visit. */
  studyOptions: z.object({ placeStudyToken: z.boolean() }).default({ placeStudyToken: false }),
});
export type RunManifest = z.infer<typeof RunManifest>;

export const NetworkCheck = z.object({
  runId: z.string(),
  at: z.iso.datetime(),
  phase: z.enum(['start', 'end', 'adhoc']),
  routeId: z.string(),
  collectorReachable: z.boolean(),
  observedIp: z.string().nullable(),
  expectedIp: z.string().nullable(),
  verdict: z.enum(['valid', 'invalid', 'unverified']),
  reason: z.string().optional(),
});
export type NetworkCheck = z.infer<typeof NetworkCheck>;

/* ------------------------------------------------------------------ */
/* Errors and audit (brief §5, §17)                                    */
/* ------------------------------------------------------------------ */

export const ERROR_CODES = [
  'invalid-input',
  'not-found',
  'conflict',
  'missing-image',
  'checksum-mismatch',
  'insufficient-disk',
  'insufficient-memory',
  'unsupported-arch',
  'unsupported-os',
  'hypervisor-unavailable',
  'backend-missing',
  'boot-timeout',
  'collector-unreachable',
  'route-mismatch',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppErrorShape {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export const AuditEvent = z.object({
  id: z.number().int(),
  at: z.iso.datetime(),
  actor: z.string(),
  action: z.string(),
  target: z.string().nullable(),
  outcome: z.enum(['ok', 'error']),
  detail: z.unknown().optional(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;
