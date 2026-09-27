import { Consent } from '@lvd/shared';
import { AppError } from '../errors';
import type { Ctx } from './context';
import { newId } from './hash';

/**
 * Consent register for volunteers' physical control machines (brief §2, §9). Holds only a
 * pseudonymous participant code; the code-to-name key stays with the consent officer.
 */
export function saveConsent(ctx: Ctx, input: Omit<Consent, 'id' | 'withdrawnAt'> & { id?: string }): Consent {
  const prev = input.id ? ctx.db.getConsent(input.id) : null;
  if (input.id && !prev) throw new AppError('not-found', `Unknown consent ${input.id}`);
  if (!prev && ctx.db.listConsents().some((c) => c.participantCode === input.participantCode && !c.withdrawnAt)) {
    throw new AppError('conflict', `Participant ${input.participantCode} already has an active consent record`);
  }
  const c = Consent.parse({ ...input, id: prev?.id ?? newId('consent'), withdrawnAt: prev?.withdrawnAt ?? null });
  ctx.db.putConsent(c);
  return c;
}

export function withdrawConsent(ctx: Ctx, id: string): Consent {
  const c = ctx.db.getConsent(id);
  if (!c) throw new AppError('not-found', `Unknown consent ${id}`);
  const next = { ...c, withdrawnAt: new Date().toISOString().slice(0, 10) };
  ctx.db.putConsent(next);
  return next;
}

export function requireActiveConsent(ctx: Ctx, id: string | null): Consent {
  if (!id) throw new AppError('invalid-input', 'Physical control runs require a consent record');
  const c = ctx.db.getConsent(id);
  if (!c) throw new AppError('not-found', `Unknown consent ${id}`);
  if (c.withdrawnAt) throw new AppError('conflict', `Consent ${c.participantCode} was withdrawn on ${c.withdrawnAt}`);
  return c;
}
