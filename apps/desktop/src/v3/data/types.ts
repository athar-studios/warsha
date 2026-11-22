export type HookStatus = 'loading' | 'empty' | 'error' | 'ready';

export interface HookResult<T> {
  status: HookStatus;
  data: T | null;
  error?: Error | null;
  reload: () => void;
}
