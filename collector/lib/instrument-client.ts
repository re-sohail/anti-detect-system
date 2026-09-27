import { INSTRUMENT_FIELDS, type Observation, type ReasonCode } from '@lvd/shared';

/**
 * Browser-side collectors for instrument v1. Each returns a value or an explicit
 * absence reason; nothing is ever guessed or defaulted (brief §6, §8).
 */

export const STUDY_TOKEN_KEY = 'lvd.studyToken.v1';

/**
 * RFC 4122 v4 UUID from crypto.getRandomValues. crypto.randomUUID() exists only in secure
 * contexts, and guests reach a development collector over plain HTTP (http://10.0.2.2).
 */
export function uuidV4(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const FIELD_TIMEOUT_MS = 4000;

export interface CollectOptions {
  /** Condition from the run URL: request geolocation (a browser prompt appears). */
  requestGeolocation: boolean;
  /** Condition from the run URL: place a benign study token after reading (R1). */
  placeStudyToken: boolean;
}

type Collector = (opts: CollectOptions) => Promise<Observation> | Observation;

const ok = (value: unknown): Observation => ({ status: 'ok', value });
const absent = (reason: ReasonCode, detail?: string): Observation => ({ status: 'absent', reason, detail });

interface NavigatorExt extends Navigator {
  deviceMemory?: number;
  userAgentData?: { brands: { brand: string; version: string }[]; mobile: boolean; platform: string };
}
const nav = () => navigator as NavigatorExt;

const COLLECTORS: Record<string, Collector> = {
  'nav.userAgent': () => ok(navigator.userAgent),
  'nav.platform': () => (navigator.platform ? ok(navigator.platform) : absent('not-supported')),
  'nav.languages': () => (navigator.languages ? ok([...navigator.languages]) : absent('not-supported')),
  'nav.hardwareConcurrency': () =>
    typeof navigator.hardwareConcurrency === 'number' ? ok(navigator.hardwareConcurrency) : absent('not-supported'),
  'nav.deviceMemory': () => (typeof nav().deviceMemory === 'number' ? ok(nav().deviceMemory) : absent('not-supported')),
  'nav.cookieEnabled': () => ok(navigator.cookieEnabled),
  'nav.webdriver': () => (typeof navigator.webdriver === 'boolean' ? ok(navigator.webdriver) : absent('not-supported')),
  'uach.lowEntropy': () => {
    const d = nav().userAgentData;
    return d ? ok({ brands: d.brands, mobile: d.mobile, platform: d.platform }) : absent('not-supported');
  },
  'screen.size': () =>
    ok({ width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight }),
  'screen.colorDepth': () => ok(screen.colorDepth),
  'screen.devicePixelRatio': () => ok(window.devicePixelRatio),
  'screen.viewport': () => ok({ innerWidth: window.innerWidth, innerHeight: window.innerHeight }),
  'intl.timeZone': () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz ? ok(tz) : absent('not-supported');
  },
  'intl.locale': () => ok(Intl.DateTimeFormat().resolvedOptions().locale),
  'intl.timezoneOffsetMin': () => ok(new Date().getTimezoneOffset()),
  'perm.states': async () => {
    if (!navigator.permissions?.query) return absent('not-supported');
    const out: Record<string, string> = {};
    for (const name of ['geolocation', 'notifications'] as PermissionName[]) {
      try {
        out[name] = (await navigator.permissions.query({ name })).state;
      } catch (e) {
        out[name] = `error:${(e as Error).name}`;
      }
    }
    return ok(out);
  },
  'geo.position': (opts) => {
    if (!opts.requestGeolocation) return absent('permission-not-requested');
    if (!window.isSecureContext) return absent('insecure-context');
    if (!navigator.geolocation) return absent('not-supported');
    return new Promise<Observation>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve(
            ok({
              // Rounded before leaving the page (privacy note in the field dictionary).
              lat: Math.round(p.coords.latitude * 100) / 100,
              lon: Math.round(p.coords.longitude * 100) / 100,
              accuracyM: Math.round(p.coords.accuracy),
            }),
          ),
        (err) =>
          resolve(
            err.code === err.PERMISSION_DENIED
              ? absent('permission-denied')
              : err.code === err.TIMEOUT
                ? absent('timeout')
                : absent('error', err.message),
          ),
        { timeout: FIELD_TIMEOUT_MS - 500, maximumAge: 0 },
      );
    });
  },
  'storage.testToken': (opts) => {
    try {
      const existing = localStorage.getItem(STUDY_TOKEN_KEY);
      let placed: string | null = null;
      if (opts.placeStudyToken && !existing) {
        placed = uuidV4();
        localStorage.setItem(STUDY_TOKEN_KEY, placed);
      }
      // `existing` is what this browser had BEFORE this visit, which is what R1 checks.
      return ok({ existingToken: existing, placedToken: placed });
    } catch (e) {
      return absent('blocked', (e as Error).name);
    }
  },
  'perf.timerResolution': () => {
    let min = Infinity;
    let last = performance.now();
    for (let i = 0; i < 1000; i++) {
      const now = performance.now();
      const d = now - last;
      if (d > 0 && d < min) min = d;
      last = now;
    }
    return Number.isFinite(min) ? ok(Math.round(min * 1e6) / 1e6) : absent('error', 'no non-zero delta observed');
  },
  'perf.navigation': () => {
    const [n] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (!n) return absent('not-supported');
    return ok({ domInteractive: Math.round(n.domInteractive), loadEventEnd: Math.round(n.loadEventEnd) });
  },
};

function withTimeout(p: Promise<Observation>): Promise<Observation> {
  return Promise.race([
    p,
    new Promise<Observation>((resolve) => setTimeout(() => resolve(absent('timeout')), FIELD_TIMEOUT_MS)),
  ]);
}

export async function collectAll(opts: CollectOptions): Promise<Record<string, Observation>> {
  const entries = await Promise.all(
    INSTRUMENT_FIELDS.map(async (field): Promise<[string, Observation]> => {
      if (field.reviewStatus !== 'approved') return [field.id, absent('disabled-by-protocol')];
      const fn = COLLECTORS[field.id];
      if (!fn) return [field.id, absent('error', 'no collector implemented for this field')];
      const started = performance.now();
      try {
        let obs = await withTimeout(Promise.resolve(fn(opts)));
        // A secure-context-only API that is missing on an insecure page is absent for that reason.
        if (obs.status === 'absent' && obs.reason === 'not-supported' && field.secureContextOnly && !window.isSecureContext) {
          obs = absent('insecure-context');
        }
        return [field.id, obs.status === 'ok' ? { ...obs, durationMs: Math.round(performance.now() - started) } : obs];
      } catch (e) {
        return [field.id, absent('error', String((e as Error)?.message ?? e).slice(0, 200))];
      }
    }),
  );
  return Object.fromEntries(entries);
}
