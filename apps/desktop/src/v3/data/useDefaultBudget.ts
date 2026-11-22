import type { WarshaClient } from '@warsha/client';
import { useCallback, useEffect, useState } from 'react';

import { useClient } from '../app/ClientContext';
import {
  DEFAULT_BUDGET_CHANGED_EVENT,
  DEFAULT_BUDGET_FALLBACK_USD,
  readDefaultBudget,
} from '../app/defaultBudget';

export interface DefaultBudgetResult {
  /** The current default budget in USD; the fresh-install default until the first read lands. */
  value: number;
  /** True until the first read has settled. */
  loading: boolean;
  reload: () => void;
}

/**
 * The owner's default run budget, kept fresh: read on mount, re-read when the window regains focus or becomes
 * visible again, and re-read when a save anywhere in the app announces a change. A failed read keeps the last
 * good value instead of blanking the screen.
 */
export function useDefaultBudget(overrideClient?: WarshaClient | null): DefaultBudgetResult {
  const contextClient = useClient();
  const client = overrideClient !== undefined ? overrideClient : contextClient;
  const [value, setValue] = useState<number>(DEFAULT_BUDGET_FALLBACK_USD);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    readDefaultBudget(client)
      .then((next) => {
        if (active) setValue(next);
      })
      .catch(() => {
        // Keep the last good value; Settings › General owns the error state for this setting.
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, nonce]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onFocus = (): void => reload();
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener(DEFAULT_BUDGET_CHANGED_EVENT, onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(DEFAULT_BUDGET_CHANGED_EVENT, onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reload]);

  return { value, loading, reload };
}
