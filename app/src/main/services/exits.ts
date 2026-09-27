import { NetworkExit } from '@lvd/shared';
import { AppError } from '../errors';
import { CollectorClient } from './collectorClient';
import type { Ctx } from './context';

/**
 * Network exit registry (brief §7). Every route a run may use has an ID, owner, location claim,
 * network type and server-observed test result. `default-nat` is built in: guests share the
 * host's public exit. Other exits must be approved before a run may use them.
 */
export const DEFAULT_EXIT_ID = 'default-nat';

export function defaultExit(): NetworkExit {
  return NetworkExit.parse({
    id: DEFAULT_EXIT_ID, kind: 'default-nat', owner: 'host network', locationClaim: 'same as host',
    networkType: 'host connection via QEMU user-mode NAT', approvedBy: 'built-in', approvedAt: new Date(0).toISOString(),
    notes: 'Separate guests have distinct private addresses but share one public exit [22].',
  });
}

export function listExits(ctx: Ctx): NetworkExit[] {
  const stored = ctx.db.listExits();
  return stored.some((e) => e.id === DEFAULT_EXIT_ID) ? stored : [defaultExit(), ...stored];
}

export function getExit(ctx: Ctx, id: string): NetworkExit | null {
  return id === DEFAULT_EXIT_ID ? ctx.db.getExit(id) ?? defaultExit() : ctx.db.getExit(id);
}

export function saveExit(ctx: Ctx, input: unknown): NetworkExit {
  const e = NetworkExit.parse(input);
  if (e.id === DEFAULT_EXIT_ID && e.kind !== 'default-nat') throw new AppError('invalid-input', 'default-nat is reserved');
  if (e.kind === 'university-proxy' && !e.proxyUrl) throw new AppError('invalid-input', 'A university-proxy exit needs a proxy URL');
  if (e.kind === 'university-proxy' && e.proxyUrl && !/^(https?|socks5):\/\/[^\s/]+(:\d+)?\/?$/.test(e.proxyUrl)) {
    throw new AppError('invalid-input', 'Proxy URL must look like http://host:port or socks5://host:port');
  }
  const prev = ctx.db.getExit(e.id);
  // Changing where an exit goes invalidates its approval and last test.
  const material = (x: NetworkExit) => JSON.stringify([x.kind, x.proxyUrl, x.expectedIp]);
  const next = prev && material(prev) !== material(e) ? { ...e, approvedAt: null, lastTest: null } : e;
  ctx.db.putExit(next);
  return next;
}

export function approveExit(ctx: Ctx, id: string, approvedBy: string): NetworkExit {
  const e = getExit(ctx, id);
  if (!e) throw new AppError('not-found', `Unknown exit ${id}`);
  if (!approvedBy.trim()) throw new AppError('invalid-input', 'Approver name required');
  const next = { ...e, approvedBy: approvedBy.trim(), approvedAt: new Date().toISOString() };
  ctx.db.putExit(next);
  return next;
}

/**
 * Host-side test. For default-nat this is the real exit. A proxy exit can only be proven from
 * inside a guest pinned to it, so the host test records that honestly instead of guessing.
 */
export async function testExit(ctx: Ctx, id: string, collectorUrl: string): Promise<NetworkExit> {
  const e = getExit(ctx, id);
  if (!e) throw new AppError('not-found', `Unknown exit ${id}`);
  let lastTest: NetworkExit['lastTest'];
  if (e.kind === 'university-proxy') {
    lastTest = { at: new Date().toISOString(), observedIp: null, ok: false, detail: 'Proxy exits are verified per visit by the collector from inside the guest; no host-side result.' };
  } else {
    try {
      const echo = await new CollectorClient(collectorUrl, null).echo();
      const ok = e.expectedIp === null || echo.observedIp === e.expectedIp;
      lastTest = { at: echo.serverTime, observedIp: echo.observedIp, ok, detail: ok ? 'collector observed expected exit' : `expected ${e.expectedIp}` };
    } catch (err) {
      lastTest = { at: new Date().toISOString(), observedIp: null, ok: false, detail: (err as Error).message };
    }
  }
  const next = { ...e, lastTest };
  ctx.db.putExit(next);
  return next;
}
