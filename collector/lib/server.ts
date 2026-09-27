import 'server-only';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { ErrorCode } from '@lvd/shared';
import { createStore, type PeerInfo, type Store } from './store';

const g = globalThis as unknown as { __lvdStore?: Store };

export function store(): Store {
  if (!g.__lvdStore) {
    g.__lvdStore = createStore(process.env.COLLECTOR_DATA_DIR ?? path.join(process.cwd(), '.data'));
  }
  return g.__lvdStore;
}

export function jsonError(status: number, code: ErrorCode, message: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: { code, message, details } }, { status });
}

/** Admin key protects run registration and reads. Dev falls back to a fixed key with a warning. */
export function checkAdmin(req: Request): boolean {
  let expected = process.env.COLLECTOR_ADMIN_KEY;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') return false;
    expected = 'dev-admin-key';
  }
  const got = req.headers.get('x-admin-key') ?? '';
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The server-observed network endpoint, stamped by server.mjs from the TCP socket
 * (or from X-Forwarded-For only when the socket is a configured trusted proxy).
 * Client-supplied copies of these headers are stripped there. If the app is run
 * without server.mjs the peer is reported as unavailable rather than guessed.
 */
export function observedPeer(req: Request): PeerInfo {
  const ip = req.headers.get('x-lvd-peer');
  const source = req.headers.get('x-lvd-peer-source');
  if (!ip || !source) return { ip: null, source: 'unavailable-no-trusted-server' };
  return { ip, source };
}

const DROP_HEADERS = new Set(['cookie', 'authorization', 'x-admin-key', 'x-lvd-peer', 'x-lvd-peer-source']);

export function serverObservation(req: Request, peer: PeerInfo): Record<string, unknown> {
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (!DROP_HEADERS.has(k)) headers[k] = v;
  });
  return { headers, peer, receivedAtServer: new Date().toISOString(), url: new URL(req.url).pathname };
}

export const MAX_BODY_BYTES = 64 * 1024;

export async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, res: jsonError(413, 'invalid-input', 'Payload too large') };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, res: jsonError(400, 'invalid-input', 'Body is not valid JSON') };
  }
}
