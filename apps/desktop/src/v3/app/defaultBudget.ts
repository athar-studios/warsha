// apps/desktop/src/v3/app/defaultBudget.ts
//
// The owner's default run budget is a plain value: "the next project starts with $N". It used to be written
// through `preferences.record`, which is the taste-scoring API — every save is a signal folded into a decayed,
// weighted *sum* — so a second save added to the first (11 then 10 read back as ~21) and the value would also
// halve every 30 days. The daemon never reads this key; only the webview does. It therefore lives where the
// other plain webview settings (`app_mode`, `onboarding_complete`) live: the shell's atomic key/value file
// behind `get_config` / `set_config`, mirrored to localStorage for a browser build without the shell.
import { invoke } from '@tauri-apps/api/core';
import type { WarshaClient } from '@warsha/client';

/** Shell config key (and legacy preference target) for the default budget, in USD. */
export const DEFAULT_BUDGET_KEY = 'default_budget_usd';
/** localStorage mirror used when there is no Tauri shell (browser dev build, tests). */
export const DEFAULT_BUDGET_STORAGE_KEY = 'warsha.default_budget_usd';
/** What a fresh install starts every project with. */
export const DEFAULT_BUDGET_FALLBACK_USD = 10;
/** Upper bound for a *default*: a bigger budget is still possible per project, deliberately. */
export const MAX_DEFAULT_BUDGET_USD = 1000;
/** Window event fired after a successful save so a mounted screen can re-read. */
export const DEFAULT_BUDGET_CHANGED_EVENT = 'warsha:default-budget-changed';

export type BudgetParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: 'invalid' | 'too-high' };

/** Validate what the owner typed: a finite number above zero and at most the cap. */
export function parseDefaultBudget(input: string | number): BudgetParseResult {
  const text = typeof input === 'number' ? String(input) : input.trim();
  if (text === '') return { ok: false, reason: 'invalid' };
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, reason: 'invalid' };
  if (value > MAX_DEFAULT_BUDGET_USD) return { ok: false, reason: 'too-high' };
  return { ok: true, value };
}

function accept(raw: unknown): number | null {
  if (typeof raw === 'number') {
    const parsed = parseDefaultBudget(raw);
    return parsed.ok ? parsed.value : null;
  }
  if (typeof raw === 'string') {
    const parsed = parseDefaultBudget(raw);
    return parsed.ok ? parsed.value : null;
  }
  return null;
}

function inTauriShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function readMirror(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    return accept(window.localStorage.getItem(DEFAULT_BUDGET_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeMirror(value: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEFAULT_BUDGET_STORAGE_KEY, String(value));
  } catch {
    // A webview without storage still has the shell file.
  }
}

/**
 * Read the default budget. Order: the shell config (the source of truth when the shell is there), the
 * localStorage mirror (no shell), then a one-time legacy read of the old preference rows — accepted only when
 * the score is a sane value, because an accumulated score is not one — and finally the fresh-install default.
 *
 * Rejects only when nothing local is set and the legacy read itself failed, so a screen can offer a retry.
 */
export async function readDefaultBudget(client: WarshaClient | null | undefined): Promise<number> {
  let shellAnswered = false;
  try {
    const raw = await invoke<string>('get_config', { key: DEFAULT_BUDGET_KEY });
    shellAnswered = true;
    const fromShell = accept(raw);
    if (fromShell !== null) return fromShell;
  } catch {
    // No shell: fall through to the mirror.
  }
  if (!shellAnswered) {
    const fromMirror = readMirror();
    if (fromMirror !== null) return fromMirror;
  }
  if (client) {
    for (const projectId of ['global', '*']) {
      const prefs = await client.listPreferences(projectId);
      if (!Array.isArray(prefs)) continue;
      const legacy = accept(prefs.find((p) => p.key === DEFAULT_BUDGET_KEY)?.score);
      if (legacy !== null) return legacy;
    }
  }
  return DEFAULT_BUDGET_FALLBACK_USD;
}

/**
 * Store the default budget, replacing whatever was there. The caller validates first; this re-checks so no
 * path can store a value the reader would refuse.
 */
export async function writeDefaultBudget(value: number): Promise<void> {
  const parsed = parseDefaultBudget(value);
  if (!parsed.ok) throw new Error(`invalid default budget: ${parsed.reason}`);
  try {
    await invoke('set_config', { key: DEFAULT_BUDGET_KEY, value: String(parsed.value) });
  } catch (error) {
    // Inside the shell a failed write is a real failure; outside it the mirror is the store.
    if (inTauriShell()) throw error;
  }
  writeMirror(parsed.value);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DEFAULT_BUDGET_CHANGED_EVENT, { detail: parsed.value }));
  }
}
