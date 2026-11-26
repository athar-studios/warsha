// D-RN-UI-R5: every role id the daemon can emit renders a localized label, never a raw key.
import { ALL_ROLES } from '@warsha/client';
import { translate } from '@warsha/i18n/v3';
import type { Locale } from '@warsha/i18n/v3';
import { describe, expect, it } from 'vitest';

import { roleLabel } from './roles';

/**
 * Wire names of `warsha_core::Role` (`rename_all = "snake_case"`, crates/warsha-core/src/lib.rs):
 * `PM` serialises as `p_m` and `QA` as `q_a`.
 */
const DAEMON_ROLE_IDS = [
  'intake',
  'researcher',
  'p_m',
  'designer',
  'architect',
  'coder',
  'reviewer',
  'q_a',
  'security',
  'release',
  'marketer',
  'feedback',
  'secretary',
] as const;

describe('roleLabel (D-RN-UI-R5)', () => {
  it.each(['en', 'ar'] as const)('localizes every daemon and table role id in %s', (locale: Locale) => {
    const t = (key: string): string => translate(locale, key);
    for (const id of [...DAEMON_ROLE_IDS, ...ALL_ROLES]) {
      const label = roleLabel(id, t);
      expect(label, id).not.toContain('settings.role.');
      expect(label, id).not.toBe(id);
      expect(label.length, id).toBeGreaterThan(0);
    }
    expect(roleLabel('p_m', t)).toBe(roleLabel('pm', t));
    expect(roleLabel('q_a', t)).toBe(roleLabel('qa', t));
  });

  it('falls back to the plain id for a role the catalog does not know and never leaks a key', () => {
    const t = (key: string): string => translate('en', key);
    expect(roleLabel('mystery_role', t)).toBe('mystery_role');
    expect(roleLabel(null, t)).toBe('—');
    expect(roleLabel('', t)).toBe('—');
  });
});
