import { NextResponse } from 'next/server';
import { INSTRUMENT_VERSION } from '@lvd/shared';
import { observedPeer, store } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Egress check (brief §7): returns the endpoint the server actually observed. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('runToken');
  const runToken = token && /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : null;
  const peer = observedPeer(req);
  const { receivedAt } = store().recordEcho(runToken, peer);
  return NextResponse.json(
    { ok: true, observedIp: peer.ip, peerSource: peer.source, serverTime: receivedAt, instrumentVersion: INSTRUMENT_VERSION },
    { headers: { 'cache-control': 'no-store' } },
  );
}
