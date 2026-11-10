import { useCallback, useState } from 'react';

import { notify } from '../app/toast';

import { ACTIONS as benchActions } from './registry/bench';
import { ACTIONS as frameActions } from './registry/frame';
import { ACTIONS as homeActions } from './registry/home';
import { ACTIONS as inboxActions } from './registry/inbox';
import { ACTIONS as onboardingActions } from './registry/onboarding';
import { ACTIONS as projectActions } from './registry/project';
import { ACTIONS as projectsActions } from './registry/projects';
import { ACTIONS as settingsActions } from './registry/settings';
import type { ActionDef } from './types';

export * from './capabilities';
export type { ActionDef } from './types';

export const ALL_ACTIONS: readonly ActionDef[] = [
  ...frameActions,
  ...onboardingActions,
  ...homeActions,
  ...projectsActions,
  ...projectActions,
  ...inboxActions,
  ...benchActions,
  ...settingsActions,
];

export function validateActionRegistry(actions: readonly ActionDef[]): void {
  const seen = new Set<string>();
  for (const action of actions) {
    if (seen.has(action.id)) {
      throw new Error(`Duplicate action id registered: "${action.id}"`);
    }
    seen.add(action.id);
  }
}

if (process.env.NODE_ENV !== 'production') {
  validateActionRegistry(ALL_ACTIONS);
}

export function getAction(id: string): ActionDef | undefined {
  return ALL_ACTIONS.find((action) => action.id === id);
}

export interface UseActionResult<TArgs extends unknown[], TResult> {
  run: (...args: TArgs) => Promise<TResult | undefined>;
  pending: boolean;
  error: Error | null;
}

export function useAction<TArgs extends unknown[] = unknown[], TResult = unknown>(
  id: string,
  fn?: (...args: TArgs) => Promise<TResult>
): UseActionResult<TArgs, TResult> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      setPending(true);
      setError(null);
      try {
        if (!fn) {
          setPending(false);
          return undefined;
        }
        const result = await fn(...args);
        setPending(false);
        return result;
      } catch (err) {
        const failure = err instanceof Error ? err : new Error(String(err));
        setError(failure);
        setPending(false);
        notify({
          type: 'error',
          message: failure.message,
          actionId: id,
        });
        return undefined;
      }
    },
    [id, fn]
  );

  return { run, pending, error };
}
