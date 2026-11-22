// apps/desktop/src/v3/app/quotaAlerts.ts — A3 alerts through the existing notification surface
import { notify } from './toast';

/** Quota alert fires when usage reaches this share of a known limit. */
export const QUOTA_ALERT_THRESHOLD = 80;

/** Spend-cap alert fires when spend reaches this share of the budget. */
export const SPEND_ALERT_THRESHOLD = 80;

/** True when this check crosses the threshold upward since the previous check. */
export function isCrossing(
  previous: number | null,
  current: number,
  threshold: number
): boolean {
  return current >= threshold && (previous === null || previous < threshold);
}

/**
 * Fires each alert exactly once per crossing: the tracker remembers which keys
 * are currently past their threshold and only notifies on the transition.
 * A dip below the threshold clears the mark, so a later re-crossing fires again.
 */
export class CrossingTracker {
  private readonly pastThreshold = new Map<string, boolean>();

  check(
    key: string,
    percentage: number | null,
    threshold: number,
    message: string
  ): void {
    if (percentage === null) return;
    const wasPast = this.pastThreshold.get(key) ?? false;
    const isPast = percentage >= threshold;
    if (isPast && !wasPast) {
      notify({ type: 'warning', message });
    }
    this.pastThreshold.set(key, isPast);
  }
}
