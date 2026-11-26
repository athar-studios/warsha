/**
 * Developers-mode copy (D-RN-CLEAN3-COPY-1).
 *
 * The developers table and session detail used to print daemon wire ids (`done`,
 * `gate_b`, `agent_step`) and a bare `¢/h` straight into Arabic text. These helpers turn
 * each one into its catalog label and fall back to the raw id only when the catalog has
 * no entry, so an unknown future value still shows something truthful instead of a key.
 */
import { getEventKey } from './events';

type T = (key: string, vars?: Record<string, string | number>) => string;

function labelOr(t: T, key: string, fallback: string): string {
  const label = t(key);
  return label === key ? fallback : label;
}

/** `warsha_core::SessionStatus` wire id → its catalog label. */
export function sessionStatusLabel(status: string, t: T): string {
  return labelOr(t, `developers.status.${status}`, status);
}

/** A daemon stage (`gate_b`, `code`, …) → the shared bench stage label. */
export function stageLabel(stage: string, t: T): string {
  return labelOr(t, `bench.stage.${stage}`, stage);
}

/** An event kind in either wire form (`AgentStep` or `agent_step`) → its plain-language label. */
export function eventKindLabel(kind: string, t: T): string {
  const normalized = kind.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const key = getEventKey(normalized);
  return key === 'events.unknown' ? kind : labelOr(t, key, kind);
}

/** Whole cents, locale-formatted unit. */
export function centsLabel(cents: number | string, t: T): string {
  return t('developers.cost.cents', { cents });
}

/** Cents per hour, locale-formatted unit (no bare `¢/h` in Arabic). */
export function centsPerHourLabel(cents: number, t: T): string {
  return t('developers.cost.cents_per_hour', { cents });
}
