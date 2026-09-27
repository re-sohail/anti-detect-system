import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CollectPayload, INSTRUMENT_VERSION } from '@lvd/shared';
import { jsonError, observedPeer, readJson, serverObservation, store } from '@/lib/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  const input = CollectPayload.safeParse(parsed.body);
  if (!input.success) return jsonError(400, 'invalid-input', 'Payload does not match collect schema', z.treeifyError(input.error));
  const payload = input.data;
  if (payload.instrumentVersion !== INSTRUMENT_VERSION) {
    return jsonError(409, 'conflict', `Instrument version ${payload.instrumentVersion} does not match server ${INSTRUMENT_VERSION}`);
  }
  const s = store();
  if (!s.isRegistered(payload.runToken)) return jsonError(403, 'not-found', 'Run token is not registered');

  const peer = observedPeer(req);
  const result = s.recordVisit(payload, peer, serverObservation(req, peer));
  if (result.status === 'conflict') return jsonError(409, 'conflict', 'A different payload was already recorded for this visit');
  return NextResponse.json(
    { ok: true, status: result.status, visitId: payload.visitId, receivedAt: result.receivedAt },
    { status: result.status === 'created' ? 201 : 200 },
  );
}
