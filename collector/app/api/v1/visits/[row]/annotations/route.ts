import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkAdmin, jsonError, readJson, store } from '@/lib/server';

export const runtime = 'nodejs';

const Annotation = z.object({ author: z.string().min(1).max(80), note: z.string().min(1).max(4000) });

export async function POST(req: Request, ctx: { params: Promise<{ row: string }> }) {
  if (!checkAdmin(req)) return jsonError(401, 'invalid-input', 'Admin key required');
  const row = Number((await ctx.params).row);
  if (!Number.isInteger(row) || row < 1) return jsonError(400, 'invalid-input', 'Invalid visit row');
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  const input = Annotation.safeParse(parsed.body);
  if (!input.success) return jsonError(400, 'invalid-input', 'Invalid annotation', z.treeifyError(input.error));
  const a = store().addAnnotation(row, input.data.author, input.data.note);
  if (!a) return jsonError(404, 'not-found', 'Unknown visit row');
  return NextResponse.json({ ok: true, annotation: a }, { status: 201 });
}
