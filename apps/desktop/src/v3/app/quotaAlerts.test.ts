import { describe, expect, it, vi } from 'vitest';

import { CrossingTracker, isCrossing, QUOTA_ALERT_THRESHOLD } from './quotaAlerts';
import { clearToastListeners, subscribeToast } from './toast';

describe('isCrossing', () => {
  it('fires when current reaches the threshold with no previous', () => {
    expect(isCrossing(null, 80, QUOTA_ALERT_THRESHOLD)).toBe(true);
  });

  it('fires when crossing upward past the threshold', () => {
    expect(isCrossing(70, 85, QUOTA_ALERT_THRESHOLD)).toBe(true);
  });

  it('does not fire when already past the threshold', () => {
    expect(isCrossing(85, 90, QUOTA_ALERT_THRESHOLD)).toBe(false);
  });

  it('does not fire below the threshold', () => {
    expect(isCrossing(null, 50, QUOTA_ALERT_THRESHOLD)).toBe(false);
  });
});

describe('CrossingTracker', () => {
  it('notifies once per crossing, not on every check', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeToast((msg) => seen.push(msg.message));
    try {
      const tracker = new CrossingTracker();
      tracker.check('p1', 50, 80, 'first');
      tracker.check('p1', 85, 80, 'crossed');
      tracker.check('p1', 90, 80, 'still-past');
      tracker.check('p1', 40, 80, 'dipped');
      tracker.check('p1', 85, 80, 're-crossed');
      expect(seen).toEqual(['crossed', 're-crossed']);
    } finally {
      unsubscribe();
      clearToastListeners();
    }
  });

  it('never notifies for null percentages', () => {
    const notifySpy = vi.fn();
    const unsubscribe = subscribeToast(notifySpy);
    try {
      const tracker = new CrossingTracker();
      tracker.check('p1', null, 80, 'never');
      expect(notifySpy).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      clearToastListeners();
    }
  });
});
