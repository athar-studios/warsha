// E2: the owner-alert engine — pure, so a fixture list and a fake clock test every rule.
//
// Four conditions warn the owner (plan §8 ### E2): a gate waiting longer than ten
// minutes, a failed run, quota near exhaustion, spend near the cap. Each fires ONCE
// per condition until the condition clears and re-arms (a same-condition repeat must
// not nag), honours quiet hours, and reads only daemon records — nothing here invents
// a number the store has not kept.

import type { RunSummary } from '@warsha/client';

export interface OwnerAlertInput {
  /** RFC 3339 stamps the daemon recorded; `null` where it has none. */
  oldestWaitingGateAt: string | null;
  /** The failed runs the daemon still reports (retry lives in the inbox, not here). */
  failedRuns: readonly RunSummary[];
  /** The tightest quota percentage the provider table knows, 0-100; `null` = unknown. */
  quotaPercent: number | null;
  /** Run spend against the run's cap, both cents; `null` where no cap. */
  spendPercent: number | null;
  /** The hour of the owner's clock now (0-23). */
  hour: number;
  /** Conditions already raised and not yet cleared, by key. */
  raised: Readonly<Record<string, string>>;
  /** Quiet hours window, inclusive start hour and exclusive end hour. */
  quietHours: { start: number; end: number };
}

export interface OwnerAlert {
  key: OwnerAlertKey;
  /** The i18n key the surface renders. */
  messageKey: string;
  /** Message interpolation, already redacted by the caller. */
  params: Record<string, string | number>;
}

export type OwnerAlertKey =
  | 'gate_waiting'
  | 'run_failed'
  | 'quota_near'
  | 'spend_near';

export const GATE_WAIT_THRESHOLD_MINUTES = 10;
export const QUOTA_NEAR_PERCENT = 80;
export const SPEND_NEAR_PERCENT = 80;

/** When a raised condition clears, its key drops out — the next occurrence re-arms. */
export function ownerAlerts(input: OwnerAlertInput): OwnerAlert[] {
  if (inQuietHours(input.hour, input.quietHours)) return [];
  const alerts: OwnerAlert[] = [];

  if (input.oldestWaitingGateAt !== null) {
    const minutes = minutesSince(input.oldestWaitingGateAt);
    if (minutes >= GATE_WAIT_THRESHOLD_MINUTES && input.raised['gate_waiting'] === undefined) {
      alerts.push({
        key: 'gate_waiting',
        messageKey: 'home.alerts.gate_waiting',
        params: { minutes: Math.floor(minutes) },
      });
    }
  }

  if (input.failedRuns.length > 0 && input.raised['run_failed'] === undefined) {
    alerts.push({
      key: 'run_failed',
      messageKey: 'home.alerts.run_failed',
      params: { count: input.failedRuns.length },
    });
  }

  if (
    input.quotaPercent !== null &&
    input.quotaPercent >= QUOTA_NEAR_PERCENT &&
    input.raised['quota_near'] === undefined
  ) {
    alerts.push({
      key: 'quota_near',
      messageKey: 'home.alerts.quota_near',
      params: { percent: Math.round(input.quotaPercent) },
    });
  }

  if (
    input.spendPercent !== null &&
    input.spendPercent >= SPEND_NEAR_PERCENT &&
    input.raised['spend_near'] === undefined
  ) {
    alerts.push({
      key: 'spend_near',
      messageKey: 'home.alerts.spend_near',
      params: { percent: Math.round(input.spendPercent) },
    });
  }

  return alerts;
}

/** The keys this scan still satisfies — the caller merges them into its raised map. */
export function raisedKeysAfter(alerts: readonly OwnerAlert[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const alert of alerts) next[alert.key] = alert.messageKey;
  return next;
}

function inQuietHours(hour: number, quiet: { start: number; end: number }): boolean {
  if (quiet.start === quiet.end) return false;
  return quiet.start < quiet.end
    ? hour >= quiet.start && hour < quiet.end
    : hour >= quiet.start || hour < quiet.end;
}

function minutesSince(iso: string): number {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 0;
  return (Date.now() - then) / 60_000;
}
