/**
 * Why an observation is absent. Brief §8: "absent data must have a reason code".
 * An absent value is data, never a guess.
 */
export const REASON_CODES = [
  'not-supported', // API does not exist in this browser/version
  'permission-denied', // user or policy denied a permission prompt
  'permission-not-requested', // field needs a prompt that was not triggered in this visit
  'insecure-context', // API requires a secure context
  'blocked', // API exists but threw / was blocked by privacy behaviour
  'timeout', // collection did not finish in the allotted time
  'disabled-by-protocol', // field exists in the dictionary but is not approved for this study
  'error', // unexpected exception; detail carries the message
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];
