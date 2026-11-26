/**
 * Role labels (D-RN-UI-R5).
 *
 * `warsha_core::Role` serialises with `rename_all = "snake_case"`, so the daemon answers
 * `p_m` and `q_a` where the catalog keys are the short ids `pm` and `qa`. Every screen that
 * prints a stored role goes through `canonicalRoleKey` here instead of building
 * `settings.role.${role}` by hand, so a wire id can never leak as a raw key.
 */
import { canonicalRoleKey } from '@warsha/client';

/** The catalog name for a stored role id; the plain id when no catalog entry exists. */
export function roleLabel(role: string | null, t: (key: string) => string): string {
  if (role === null || role.trim().length === 0) return '—';
  const canonical = canonicalRoleKey(role);
  if (canonical === null) return role;
  const key = `settings.role.${canonical}`;
  const label = t(key);
  // A missing entry comes back as the key itself; a stub `t` that echoes its argument
  // does the same. Never show a key: fall back to the id.
  if (label === key) return role;
  return label;
}
