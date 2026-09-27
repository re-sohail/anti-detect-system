import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkAdmin, jsonError, readJson, store } from '@/lib/server';

export const runtime = 'nodejs';

const RegisterRun = z.object({
  runToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  runId: z.string().min(1).max(64),
  routeId: z.string().min(1).max(64),
  expectedIp: z.string().max(64).nullable().optional(),
});

/** Called by the control app before a guest may contact the collector (brief §17). */
export async function POST(req: Request) {
  if (!checkAdmin(req)) return jsonError(401, 'invalid-input', 'Admin key required');
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  const input = RegisterRun.safeParse(parsed.body);
  if (!input.success) return jsonError(400, 'invalid-input', 'Invalid run registration', z.treeifyError(input.error));
  const result = store().registerRun(input.data);
  if (result.status === 'conflict') return jsonError(409, 'conflict', 'Run token already registered to a different run');
  return NextResponse.json({ ok: true, ...result }, { status: result.status === 'created' ? 201 : 200 });
}
