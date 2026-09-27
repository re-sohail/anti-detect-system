import { NextResponse } from 'next/server';
import { checkAdmin, jsonError, store } from '@/lib/server';

export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!checkAdmin(req)) return jsonError(401, 'invalid-input', 'Admin key required');
  const { token } = await ctx.params;
  const detail = store().runDetail(token);
  if (!detail) return jsonError(404, 'not-found', 'Unknown run token');
  return NextResponse.json({ ok: true, ...detail });
}
