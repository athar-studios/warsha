/**
 * Localized mapping for raw daemon RPC errors on the Simple Home composer
 * (R-4). The decision carries a catalog key, never copy: the banner renders
 * `t(key)` so Arabic stays Arabic (same key+detail shape as the U-2 startup
 * errors), with the raw daemon message isolated in a `dir="auto"` detail span
 * for technical debugging.
 */

/** Translator shape shared with the copy helpers (`packages/i18n` `useT`). */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export type RpcErrorKey =
  | 'home.errors.not_git_repo'
  | 'home.errors.clone_failed'
  | 'home.errors.github_not_configured'
  | 'home.errors.repo_name_taken'
  | 'home.errors.folder_exists_not_empty'
  | 'home.errors.folder_missing'
  | 'home.errors.repo_name_empty'
  | 'home.errors.server_error';

/**
 * What an error banner renders for a daemon rejection: a catalog key through
 * `t`, plus the raw detail. Already-localized validation copy keeps flowing
 * as a plain string beside this shape (see the home composer error state).
 */
export interface DescribedRpcError {
  key: string;
  detail: string;
}

const SUBSTRING_RULES: ReadonlyArray<{ needle: string; key: RpcErrorKey }> = [
  { needle: 'not a git repository', key: 'home.errors.not_git_repo' },
  { needle: 'git clone failed', key: 'home.errors.clone_failed' },
  { needle: 'github token is not configured', key: 'home.errors.github_not_configured' },
  { needle: 'name already exists', key: 'home.errors.repo_name_taken' },
  // The daemon reports both "`{}` already exists and is not empty" (clone
  // target) and bare "already exists" variants; both mean the same to the
  // owner, so the bare needle trails the specific one.
  { needle: 'already exists and is not empty', key: 'home.errors.folder_exists_not_empty' },
  { needle: 'already exists', key: 'home.errors.folder_exists_not_empty' },
  { needle: 'does not exist or is not a directory', key: 'home.errors.folder_missing' },
  { needle: 'is not a directory', key: 'home.errors.folder_missing' },
  { needle: 'repository name must not be empty', key: 'home.errors.repo_name_empty' },
];

/** The message of a thrown value, or an empty string when it carries none. */
function detailOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  const message = String(err);
  return message.length > 0 ? message : '';
}

/**
 * Describe a daemon RPC rejection as a localized catalog key plus the raw
 * detail. Matching is on a lowercased substring of the message, in table
 * order above; unknown messages fall back to `home.errors.server_error` with
 * the raw message kept as detail. `t` is accepted (matching the copy-helper
 * convention) but translation happens at render time, so the key stays
 * serializable.
 */
export function describeRpcError(err: unknown, _t: Translate): DescribedRpcError {
  const detail = detailOf(err);
  const lowered = detail.toLowerCase();
  for (const rule of SUBSTRING_RULES) {
    if (lowered.includes(rule.needle)) {
      return { key: rule.key, detail };
    }
  }
  return { key: 'home.errors.server_error', detail };
}
