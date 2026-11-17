// apps/desktop/src/v3/pages/frame/QuotaGaugeButton.tsx — A3 status-bar quota gauge
import { useT } from '@warsha/i18n/v3';
import { Gauge } from '@warsha/ui/v3';
import React from 'react';

import { useNavigate } from '../../router';
import { useQuotaGauge } from '../../data';

/**
 * The status-bar quota gauge (A3): green / amber / red from the tightest quota
 * among providers that have a known limit; providers without a known limit do
 * not drive the colour. Click opens the Usage and quotas settings tab.
 */
export function QuotaGaugeButton(): React.ReactElement | null {
  const t = useT();
  const navigate = useNavigate();
  const gauge = useQuotaGauge();

  if (gauge.status === null || gauge.percentage === null) {
    return null;
  }

  return (
    <button
      type="button"
      className="v3-frame-quota-gauge"
      data-testid="frame-quota-gauge"
      data-status={gauge.status}
      title={
        gauge.tightestProvider
          ? t('frame.quota_gauge.tightest', { name: gauge.tightestProvider })
          : t('frame.quota_gauge_none')
      }
      aria-label={t('frame.quota_gauge_label')}
      onClick={() => navigate('/settings/usage')}
    >
      <Gauge percentage={gauge.percentage} status={gauge.status} />
    </button>
  );
}
