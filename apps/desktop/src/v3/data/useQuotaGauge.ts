// apps/desktop/src/v3/data/useQuotaGauge.ts — A3 status-bar gauge state
import type { ProviderQuotaStatus } from '@warsha/client';

import { useClient } from '../app/ClientContext';

import { useEffect, useState } from 'react';

export interface QuotaGaugeState {
  /** Tightest known quota as a percentage used (0-100), or null when no limit is known. */
  percentage: number | null;
  /** The provider whose quota drives the colour ("tightest wins"). */
  tightestProvider: string | null;
  status: 'green' | 'amber' | 'red' | null;
}

export interface GaugeThresholds {
  amber: number; // percent used where amber starts
  red: number; // percent used where red starts
}

export const DEFAULT_GAUGE_THRESHOLDS: GaugeThresholds = { amber: 60, red: 80 };

/** A provider's quota as percent-used, or null when no limit is known. */
export function quotaPercentage(quota: ProviderQuotaStatus['quota']): number | null {
  if (quota.state === 'reported') {
    if (quota.limit === 0) return null;
    return (quota.used / quota.limit) * 100;
  }
  if (quota.state === 'estimated') {
    return quota.usagePercentage;
  }
  return null;
}

/** Gauge colour from percent-used and configurable thresholds. */
export function gaugeStatus(
  percentage: number,
  thresholds: GaugeThresholds = DEFAULT_GAUGE_THRESHOLDS
): 'green' | 'amber' | 'red' {
  if (percentage >= thresholds.red) return 'red';
  if (percentage >= thresholds.amber) return 'amber';
  return 'green';
}

/**
 * The tightest quota among providers that have a known limit wins.
 * Providers without a known limit never drive the colour (A3 spec).
 */
export function tightestQuota(
  quotas: readonly ProviderQuotaStatus[],
  thresholds: GaugeThresholds = DEFAULT_GAUGE_THRESHOLDS
): QuotaGaugeState {
  let worst: { name: string; percentage: number; status: 'green' | 'amber' | 'red' } | null = null;
  for (const entry of quotas) {
    const percentage = quotaPercentage(entry.quota);
    if (percentage === null) continue;
    const status = gaugeStatus(percentage, thresholds);
    if (!worst || status === 'red' || (status === 'amber' && worst.status === 'green') || (status === worst.status && percentage > worst.percentage)) {
      worst = { name: entry.provider, percentage, status };
    }
  }
  if (!worst) {
    return { percentage: null, tightestProvider: null, status: null };
  }
  return { percentage: worst.percentage, tightestProvider: worst.name, status: worst.status };
}

/**
 * Polls every provider's quota on a fixed interval, cached, rate-limited, and
 * stopped while the window is hidden (A3: zero quota calls while hidden).
 */
export function useQuotaGauge(
  intervalMs = 5 * 60 * 1000
): QuotaGaugeState & { reload: () => void } {
  const client = useClient();
  const [state, setState] = useState<QuotaGaugeState>({
    percentage: null,
    tightestProvider: null,
    status: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!client) return;
    let active = true;
    let inFlight = false;

    const poll = async (): Promise<void> => {
      if (inFlight) return; // rate-limit: never overlap two rounds
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const providers = await client.listProviders();
        const statuses = await Promise.all(
          providers.map(async (p) => {
            try {
              return await client.providerQuota(p.name);
            } catch {
              return null;
            }
          })
        );
        if (!active) return;
        setState(tightestQuota(statuses.filter((s): s is ProviderQuotaStatus => s !== null)));
      } catch {
        // Provider list failure leaves the gauge unchanged
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), intervalMs);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [client, intervalMs, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
