import { useCallback, useEffect, useState } from 'react';

import type { HookResult, HookStatus } from './types';

export function useResource<T>(
  fetcher: () => Promise<T | null | undefined>,
  isEmpty: (data: T | null | undefined) => boolean,
  deps: readonly unknown[] = []
): HookResult<T> {
  const [status, setStatus] = useState<HookStatus>('loading');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setError(null);

    Promise.resolve()
      .then(() => fetcher())
      .then((result) => {
        if (!active) return;
        if (isEmpty(result)) {
          setStatus('empty');
          setData((result as T) ?? null);
        } else {
          setStatus('ready');
          setData(result as T);
        }
      })
      .catch((err) => {
        if (!active) return;
        setStatus('error');
        setData(null);
        setError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      active = false;
    };
  }, [...deps, nonce]);

  return { status, data, error, reload };
}
