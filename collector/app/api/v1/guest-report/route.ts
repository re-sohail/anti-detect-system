import { NextResponse } from 'next/server';
import { z } from 'zod';
import { GuestReport } from '@lvd/shared';
import { jsonError, observedPeer, readJson, store } from '@/lib/server';

export const runtime = 'nodejs';

/** The guest agent reports facts from inside its own OS (brief §5). */
export async function POST(req: Request) {
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  const input = GuestReport.safeParse(parsed.body);
  if (!input.success) return jsonError(400, 'invalid-input', 'Invalid guest report', z.treeifyError(input.error));
  const s = store();
  if (!s.isRegistered(input.data.runToken)) return jsonError(403, 'not-found', 'Run token is not registered');
  const { receivedAt } = s.recordGuestReport(input.data, observedPeer(req));
  return NextResponse.json({ ok: true, receivedAt }, { status: 201 });
}
