/** Deterministic JSON (sorted keys) so manifest hashes are reproducible. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export interface DiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

/** Leaf-level diff used by the preset editor's explicit change preview (brief §17). */
export function diffObjects(before: unknown, after: unknown, path = ''): DiffEntry[] {
  const isObj = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
    return [...keys].sort().flatMap((k) =>
      diffObjects((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k], path ? `${path}.${k}` : k),
    );
  }
  return canonicalJson(before) === canonicalJson(after) ? [] : [{ path, before, after }];
}
