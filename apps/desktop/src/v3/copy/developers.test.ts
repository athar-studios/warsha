import { translate } from '@warsha/i18n/v3';
import { describe, expect, it } from 'vitest';

import { centsLabel, centsPerHourLabel, eventKindLabel, sessionStatusLabel, stageLabel } from './developers';

const tr = (locale: 'ar' | 'en') => (key: string, vars?: Record<string, string | number>): string => translate(locale, key, vars);

describe('developers copy helpers (D-RN-CLEAN3-COPY-1)', () => {
  it('renders Arabic labels with no wire ids or bare cent signs', () => {
    const t = tr('ar');
    expect(sessionStatusLabel('done', t)).toBe('انتهت');
    expect(sessionStatusLabel('waiting_on_owner', t)).toBe('ينتظرك');
    expect(stageLabel('gate_b', t)).toBe('بوابة ب');
    expect(eventKindLabel('agent_step', t)).toBe('خطوة الوكيل');
    expect(eventKindLabel('AgentStep', t)).toBe('خطوة الوكيل');
    expect(centsLabel(7, t)).toBe('7 سنت');
    expect(centsPerHourLabel(4457, t)).toBe('4457 سنت في الساعة');
  });

  it('keeps the English units', () => {
    const t = tr('en');
    expect(sessionStatusLabel('done', t)).toBe('Done');
    expect(stageLabel('gate_b', t)).toBe('Gate B');
    expect(eventKindLabel('agent_step', t)).toBe('Agent step');
    expect(centsLabel('7.0', t)).toBe('7.0 ¢');
    expect(centsPerHourLabel(4457, t)).toBe('4457 ¢/h');
  });

  it('falls back to the raw id for values the catalog does not know', () => {
    const t = tr('ar');
    expect(sessionStatusLabel('mystery', t)).toBe('mystery');
    expect(stageLabel('mystery', t)).toBe('mystery');
    expect(eventKindLabel('mystery_kind', t)).toBe('mystery_kind');
  });
});
