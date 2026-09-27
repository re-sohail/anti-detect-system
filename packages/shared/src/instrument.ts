/**
 * Instrument field dictionary (brief §8). Every field declares how it is collected,
 * its expected stability, sensitivity, whether it needs a permission, and its privacy
 * review status. Fields still 'pending-review' are recorded as absent with reason
 * 'disabled-by-protocol' until the privacy review (plan Phase 0, Q6) approves them.
 *
 * Any change to this list or to a collection method MUST bump INSTRUMENT_VERSION
 * (brief §9: a changed field creates a new instrument version and a labelled rerun).
 */
export const INSTRUMENT_VERSION = '1.1.0';
/*
 * 1.1.0 (2026-09-27): secure-context-only APIs report 'insecure-context' instead of
 * 'not-supported' when the page is not a secure context (found in the feasibility pilot).
 * 1.0.0: initial field set.
 */

export type FieldFamily =
  | 'navigator'
  | 'client-hints'
  | 'screen'
  | 'intl'
  | 'permissions'
  | 'geolocation'
  | 'rendering'
  | 'performance'
  | 'storage';

export interface FieldDefinition {
  id: string;
  family: FieldFamily;
  method: string;
  stability: 'stable' | 'session' | 'volatile';
  sensitivity: 'low' | 'medium' | 'high';
  requiresPermission: boolean;
  privacyNote: string;
  reviewStatus: 'approved' | 'pending-review';
  source?: string;
  /** Exposed only in secure contexts (HTTPS or localhost); absent over plain HTTP. */
  secureContextOnly?: boolean;
}

export const INSTRUMENT_FIELDS: readonly FieldDefinition[] = [
  { id: 'nav.userAgent', family: 'navigator', method: 'navigator.userAgent', stability: 'stable', sensitivity: 'medium', requiresPermission: false, privacyNote: 'Reduced UA string in Chrome [19].', reviewStatus: 'approved', source: '[19]' },
  { id: 'nav.platform', family: 'navigator', method: 'navigator.platform', stability: 'stable', sensitivity: 'low', requiresPermission: false, privacyNote: 'Legacy, frozen in reduced UA.', reviewStatus: 'approved' },
  { id: 'nav.languages', family: 'navigator', method: 'navigator.languages', stability: 'stable', sensitivity: 'medium', requiresPermission: false, privacyNote: 'May be reduced by browser privacy behaviour [27].', reviewStatus: 'approved', source: '[27]' },
  { id: 'nav.hardwareConcurrency', family: 'navigator', method: 'navigator.hardwareConcurrency', stability: 'stable', sensitivity: 'medium', requiresPermission: false, privacyNote: 'In a guest this reflects virtual CPUs, not a physical CPU.', reviewStatus: 'approved' },
  { id: 'nav.deviceMemory', family: 'navigator', method: 'navigator.deviceMemory', stability: 'stable', sensitivity: 'medium', requiresPermission: false, privacyNote: 'Bucketed by the browser; Chromium only.', reviewStatus: 'approved', secureContextOnly: true },
  { id: 'nav.cookieEnabled', family: 'navigator', method: 'navigator.cookieEnabled', stability: 'stable', sensitivity: 'low', requiresPermission: false, privacyNote: '-', reviewStatus: 'approved' },
  { id: 'nav.webdriver', family: 'navigator', method: 'navigator.webdriver', stability: 'stable', sensitivity: 'low', requiresPermission: false, privacyNote: 'Distinguishes automated from manual sessions (experiment condition).', reviewStatus: 'approved' },
  { id: 'uach.lowEntropy', family: 'client-hints', method: 'navigator.userAgentData.{brands,mobile,platform}', stability: 'stable', sensitivity: 'low', requiresPermission: false, privacyNote: 'Absent outside Chromium [19].', reviewStatus: 'approved', source: '[19]', secureContextOnly: true },
  { id: 'uach.highEntropy', family: 'client-hints', method: 'navigator.userAgentData.getHighEntropyValues([...])', stability: 'stable', sensitivity: 'high', requiresPermission: false, privacyNote: 'Platform version, architecture, model; requires privacy review.', reviewStatus: 'pending-review', source: '[19]', secureContextOnly: true },
  { id: 'screen.size', family: 'screen', method: 'screen.{width,height,availWidth,availHeight}', stability: 'session', sensitivity: 'medium', requiresPermission: false, privacyNote: 'CSS pixels, not physical pixels [20].', reviewStatus: 'approved', source: '[20]' },
  { id: 'screen.colorDepth', family: 'screen', method: 'screen.colorDepth', stability: 'stable', sensitivity: 'low', requiresPermission: false, privacyNote: '-', reviewStatus: 'approved' },
  { id: 'screen.devicePixelRatio', family: 'screen', method: 'window.devicePixelRatio', stability: 'session', sensitivity: 'low', requiresPermission: false, privacyNote: 'Changes with zoom and display scaling [20].', reviewStatus: 'approved', source: '[20]' },
  { id: 'screen.viewport', family: 'screen', method: 'window.{innerWidth,innerHeight}', stability: 'volatile', sensitivity: 'low', requiresPermission: false, privacyNote: 'Changes with window size.', reviewStatus: 'approved' },
  { id: 'intl.timeZone', family: 'intl', method: 'Intl.DateTimeFormat().resolvedOptions().timeZone', stability: 'stable', sensitivity: 'medium', requiresPermission: false, privacyNote: 'Does not establish geographic location.', reviewStatus: 'approved' },
  { id: 'intl.locale', family: 'intl', method: 'Intl.DateTimeFormat().resolvedOptions().locale', stability: 'stable', sensitivity: 'low', requiresPermission: false, privacyNote: '-', reviewStatus: 'approved' },
  { id: 'intl.timezoneOffsetMin', family: 'intl', method: 'new Date().getTimezoneOffset()', stability: 'session', sensitivity: 'low', requiresPermission: false, privacyNote: 'Changes with DST.', reviewStatus: 'approved' },
  { id: 'perm.states', family: 'permissions', method: 'navigator.permissions.query for geolocation, notifications', stability: 'session', sensitivity: 'low', requiresPermission: false, privacyNote: 'Reads state only; never prompts.', reviewStatus: 'approved' },
  { id: 'geo.position', family: 'geolocation', method: 'navigator.geolocation.getCurrentPosition (user-initiated only)', stability: 'session', sensitivity: 'high', requiresPermission: true, privacyNote: 'Requires permission and secure context [21]; coordinates are rounded to 2 decimals before storage.', reviewStatus: 'approved', source: '[21]', secureContextOnly: true },
  { id: 'storage.testToken', family: 'storage', method: 'localStorage read of benign study token (R1)', stability: 'stable', sensitivity: 'low', requiresPermission: false, privacyNote: 'Token is study-generated; no personal data.', reviewStatus: 'approved' },
  { id: 'render.canvas2d', family: 'rendering', method: 'SHA-256 of fixed 2D canvas payload v1, repeated 3x', stability: 'stable', sensitivity: 'high', requiresPermission: false, privacyNote: 'Not a hardware identity; requires privacy review.', reviewStatus: 'pending-review' },
  { id: 'render.webglRenderer', family: 'rendering', method: 'WEBGL_debug_renderer_info UNMASKED_RENDERER', stability: 'stable', sensitivity: 'high', requiresPermission: false, privacyNote: 'May reveal virtual GPU; requires privacy review.', reviewStatus: 'pending-review' },
  { id: 'perf.timerResolution', family: 'performance', method: 'min non-zero delta of performance.now() over 1000 samples', stability: 'volatile', sensitivity: 'low', requiresPermission: false, privacyNote: '-', reviewStatus: 'approved' },
  { id: 'perf.navigation', family: 'performance', method: 'PerformanceNavigationTiming {domInteractive, loadEventEnd}', stability: 'volatile', sensitivity: 'low', requiresPermission: false, privacyNote: '-', reviewStatus: 'approved' },
];

export const FIELD_IDS = INSTRUMENT_FIELDS.map((f) => f.id);

export function fieldById(id: string): FieldDefinition | undefined {
  return INSTRUMENT_FIELDS.find((f) => f.id === id);
}
