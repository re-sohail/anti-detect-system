import type { AppErrorShape, ErrorCode } from '@lvd/shared';

/** Normalised error model (brief §5): every failure has a specific, preserved code. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function toErrorShape(e: unknown): AppErrorShape {
  if (e instanceof AppError) return { code: e.code, message: e.message, details: e.details };
  return { code: 'internal', message: e instanceof Error ? e.message : String(e) };
}
