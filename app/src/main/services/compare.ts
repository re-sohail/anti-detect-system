import type { Preset, GuestReport } from '@lvd/shared';
import type { CompareRow } from '@common/ipc';
import type { CollectorRunDetail } from './collectorClient';

/**
 * Selected vs guest-reported vs browser-reported vs server-observed (brief §6).
 * Unknown values stay null (shown as "unknown"); a mismatch is data, not an error.
 */
export function buildCompare(preset: Preset | null, detail: CollectorRunDetail | null, expectedExit: string | null): CompareRow[] {
  const visit = detail?.visits.at(-1);
  const obs = visit?.payload_json.observations ?? {};
  const val = (id: string): unknown => (obs[id]?.status === 'ok' ? (obs[id] as { value: unknown }).value : null);
  const absentWhy = (id: string): string | null => (obs[id]?.status === 'absent' ? `unknown (${(obs[id] as { reason: string }).reason})` : null);
  const guest = (detail?.guestReports.at(-1)?.report_json ?? null) as Partial<GuestReport> | null;
  const headers = visit?.server_json.headers ?? {};
  const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

  const screen = val('screen.size') as { width: number; height: number } | null;
  const ua = s(val('nav.userAgent'));
  const uaChrome = ua?.match(/Chrome\/([\d.]+)/)?.[1] ?? null;
  const uach = val('uach.lowEntropy') as { platform?: string } | null;
  const langs = val('nav.languages') as string[] | null;

  const rows: Array<Omit<CompareRow, 'mismatch'> & { compare?: Array<keyof CompareRow> ; norm?: (v: string) => string }> = [
    {
      key: 'timeZone', label: 'Time zone',
      selected: s(preset?.regional.timeZone), guestReported: s(guest?.timeZone),
      browserReported: s(val('intl.timeZone')) ?? absentWhy('intl.timeZone'), serverObserved: null,
    },
    {
      key: 'locale', label: 'Locale / language',
      selected: s(preset?.regional.locale), guestReported: s(guest?.locale?.split('.')[0]?.replace('_', '-')),
      browserReported: s(langs?.[0]) ?? s(val('intl.locale')), serverObserved: s(headers['accept-language']?.split(',')[0]),
      norm: (v) => v.toLowerCase().split('-')[0],
    },
    {
      key: 'display', label: 'Display (CSS px for browser)',
      selected: preset ? `${preset.display.width}x${preset.display.height}` : null,
      guestReported: guest?.display ? `${guest.display.width}x${guest.display.height}` : null,
      browserReported: screen ? `${screen.width}x${screen.height} @${s(val('screen.devicePixelRatio')) ?? '?'}x` : absentWhy('screen.size'),
      serverObserved: null,
      norm: (v) => v.split(' ')[0],
      compare: ['selected', 'guestReported'],
    },
    {
      key: 'cpus', label: 'Logical CPUs',
      selected: s(preset?.resources.vcpus), guestReported: s(guest?.cpus),
      browserReported: s(val('nav.hardwareConcurrency')) ?? absentWhy('nav.hardwareConcurrency'), serverObserved: null,
    },
    {
      key: 'memory', label: 'Memory (browser value is a coarse GB bucket)',
      selected: preset ? `${preset.resources.memoryMb} MB` : null,
      guestReported: guest?.memoryMb ? `${guest.memoryMb} MB` : null,
      browserReported: val('nav.deviceMemory') !== null ? `${val('nav.deviceMemory')} GB` : absentWhy('nav.deviceMemory'),
      serverObserved: null,
      compare: [],
    },
    {
      key: 'os', label: 'Operating system',
      selected: s(preset?.guest.os), guestReported: s(guest?.os),
      browserReported: s(uach?.platform) ?? s(val('nav.platform')), serverObserved: s(headers['sec-ch-ua-platform']?.replaceAll('"', '')),
      norm: (v) => v.toLowerCase().replace('macos', 'macos').replace(/^mac.*/, 'macos').replace(/^win.*/, 'windows').replace(/^linux.*/, 'linux'),
    },
    {
      key: 'chrome', label: 'Chrome version',
      selected: null, guestReported: s(guest?.chromeVersion?.match(/[\d.]+/)?.[0]),
      browserReported: uaChrome, serverObserved: s(headers['user-agent']?.match(/Chrome\/([\d.]+)/)?.[1]),
      norm: (v) => v.split('.')[0],
    },
    {
      key: 'exit', label: 'Network exit (server-observed)',
      selected: s(preset?.network.routeId), guestReported: null, browserReported: null,
      serverObserved: s(visit?.peer_ip),
      compare: [],
    },
  ];

  return rows.map(({ compare, norm, ...r }) => {
    const cols = compare ?? (['selected', 'guestReported', 'browserReported', 'serverObserved'] as const);
    const vals = cols
      .map((c) => r[c as keyof typeof r] as string | null)
      .filter((v): v is string => v !== null && !v.startsWith('unknown'))
      .map((v) => (norm ? norm(v) : v));
    let mismatch = new Set(vals).size > 1;
    if (r.key === 'exit' && expectedExit && r.serverObserved && r.serverObserved !== expectedExit) mismatch = true;
    return { ...r, mismatch };
  });
}
