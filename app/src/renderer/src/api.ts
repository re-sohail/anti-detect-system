import { useCallback, useEffect, useState } from 'react';
import type { AppErrorShape } from '@lvd/shared';
import type { Channel, In, Out } from '@common/ipc';

export class UiError extends Error {
  constructor(public shape: AppErrorShape) {
    super(shape.message);
  }
}

export async function call<C extends Channel>(channel: C, input: In<C>): Promise<Out<C>> {
  const r = await window.lvd.invoke(channel, input);
  if (!r.ok) throw new UiError(r.error);
  return r.data;
}

/** Load data from a read-only channel; `reload` re-fetches. */
export function useQuery<C extends Channel>(channel: C, input: In<C>, deps: unknown[] = []) {
  const [data, setData] = useState<Out<C> | null>(null);
  const [error, setError] = useState<AppErrorShape | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(input ?? null);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await call(channel, input));
      setError(null);
    } catch (e) {
      setError(e instanceof UiError ? e.shape : { code: 'internal', message: String(e) });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, key, ...deps]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

/** Run a mutating action, surfacing its normalised error. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AppErrorShape | null>(null);
  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof UiError ? e.shape : { code: 'internal', message: String(e) });
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, error, setError, run };
}
