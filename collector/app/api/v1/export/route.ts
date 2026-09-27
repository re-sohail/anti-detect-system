import { NextResponse } from 'next/server';
import { checkAdmin, jsonError, store } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Raw evidence export for the supervisor. Not blinded; the analysis toolkit produces the blinded set. */
export function GET(req: Request) {
  if (!checkAdmin(req)) return jsonError(401, 'invalid-input', 'Admin key required');
  return NextResponse.json({ ok: true, ...store().exportAll() }, { headers: { 'cache-control': 'no-store' } });
}
