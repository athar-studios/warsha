// apps/desktop/src/v3/pages/settings/sections/UsageSection.tsx — A3 usage + quota section
import type { ProviderQuotaStatus, SubscriptionWindow, UsageRow, UsageTimeRow } from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  EmptyState,
  IconGauge,
  SettingsSection,
  Skeleton,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';
import {
  quotaPercentage,
  gaugeStatus,
  DEFAULT_GAUGE_THRESHOLDS,
} from '../../../data/useQuotaGauge';
import {
  useProviders,
  useUsageByDimension,
  useUsageByTime,
  type UsageDimension,
  type UsageGranularity,
} from '../../../data';

const DIMENSIONS: UsageDimension[] = ['provider_id', 'model_id', 'agent_role', 'project_id'];
const GRANULARITIES: UsageGranularity[] = ['day', 'month'];

/** The quota's GaugeStatus tier: red past 80% of a known limit, amber past 60%, green otherwise. */
function quotaStatus(quota: ProviderQuotaStatus['quota']) {
  const percentage = quotaPercentage(quota);
  if (percentage === null) return null;
  return gaugeStatus(percentage, DEFAULT_GAUGE_THRESHOLDS);
}

function quotaLine(
  t: ReturnType<typeof useT>,
  quota: ProviderQuotaStatus['quota']
): string {
  if (quota.state === 'reported') {
    return t('settings.usage.quota.reported', { used: quota.used, limit: quota.limit });
  }
  if (quota.state === 'estimated') {
    return t('settings.usage.quota.estimated', { percentage: quota.usagePercentage });
  }
  return t('settings.usage.quota.unknown');
}

export function UsageSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();

  const [dimension, setDimension] = useState<UsageDimension>('provider_id');
  const [granularity, setGranularity] = useState<UsageGranularity>('day');

  const byDimension = useUsageByDimension(dimension);
  const byTime = useUsageByTime(granularity);
  const providers = useProviders();

  // Subscription windows load once with the section (estimated, from own records).
  const [windowData, setWindowData] = useState<SubscriptionWindow | null>(null);
  const [windowError, setWindowError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let active = true;
    client
      .usageSubscriptionWindow()
      .then((w) => {
        if (active) setWindowData(w);
      })
      .catch(() => {
        if (active) setWindowError(t('settings.usage.quota.unknown'));
      });
    return () => {
      active = false;
    };
  }, [client, t]);

  const [quotas, setQuotas] = useState<Record<string, ProviderQuotaStatus>>({});
  const [quotaErrors, setQuotaErrors] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loading = byDimension.status === 'loading' || byTime.status === 'loading';

  useEffect(() => {
    setReady(!loading);
  }, [loading, setReady]);

  const checkQuotaAction = useAction('settings.usage.quota.check', async (name: string) => {
    if (!client) return;
    try {
      const status = await client.providerQuota(name);
      setQuotas((prev) => ({ ...prev, [name]: status }));
      setQuotaErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      setStatusMessage(t('settings.usage.quota.checked', { name }));
    } catch (error) {
      setQuotaErrors((prev) => ({
        ...prev,
        [name]: error instanceof Error ? error.message : String(error),
      }));
    }
  });

  const dimensionRows: UsageRow[] = byDimension.data ?? [];
  const timeRows: UsageTimeRow[] = byTime.data ?? [];

  return (
    <div data-testid="settings-section-usage">
      <SettingsSection
        title={t('settings.section.usage')}
        description={t('settings.section.usage.desc')}
        scope={<span className="v3-settings-scope">{t('settings.scope.all_runs')}</span>}
      >
        {(byDimension.status === 'loading' || byTime.status === 'loading') && (
          <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
            <Skeleton variant="text" />
            <Skeleton variant="text" />
          </div>
        )}

        {byDimension.status === 'error' && (
          <div style={{ padding: 'var(--w-space-4)' }}>
            <Banner variant="danger">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--w-space-3)', flexWrap: 'wrap' }}>
                <span>{byDimension.error?.message ?? t('common.error')}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="settings.error.retry"
                  onClick={byDimension.reload}
                >
                  {t('common.retry')}
                </Button>
              </div>
            </Banner>
          </div>
        )}

        {statusMessage && (
          <div style={{ padding: 'var(--w-space-4)', paddingBlockEnd: 0 }}>
            <Banner variant="success">{statusMessage}</Banner>
          </div>
        )}

        {byDimension.status !== 'loading' && byTime.status !== 'loading' && (
          <>
            <div style={{ padding: 'var(--w-space-4)', paddingBlockEnd: 0, display: 'flex', gap: 'var(--w-space-2)', flexWrap: 'wrap' }}>
              {DIMENSIONS.map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={dimension === d ? 'primary' : 'secondary'}
                  data-action="settings.usage.dimension.set"
                  data-dimension={d}
                  onClick={() => setDimension(d)}
                >
                  {t(`settings.usage.dimension.${d}`)}
                </Button>
              ))}
            </div>

            {dimensionRows.length === 0 ? (
              <EmptyState
                icon={<IconGauge size={20} />}
                title={t('settings.usage.empty')}
                description={t('settings.section.usage.desc')}
              />
            ) : (
              <div style={{ padding: 'var(--w-space-4)' }} className="v3-settings-table" role="table" aria-label={t('settings.section.usage')}>
                <div role="row" className="v3-settings-table-head">
                  <span role="columnheader">{t(`settings.usage.dimension.${dimension}`)}</span>
                  <span role="columnheader">{t('settings.usage.col.cost')}</span>
                  <span role="columnheader">{t('settings.usage.col.tokens_in')}</span>
                  <span role="columnheader">{t('settings.usage.col.tokens_out')}</span>
                  <span role="columnheader">{t('settings.usage.col.requests')}</span>
                </div>
                {dimensionRows.map((row) => (
                  <div role="row" key={row.key} data-testid={`usage-row-${row.key}`}>
                    <span role="cell">{row.key}</span>
                    <span role="cell" dir="ltr">${(row.costCents / 100).toFixed(2)}{row.costCents > 0 ? '' : ''}</span>
                    <span role="cell" dir="ltr">{row.promptTokens + row.cacheReadTokens + row.cacheWriteTokens}</span>
                    <span role="cell" dir="ltr">{row.completionTokens}</span>
                    <span role="cell" dir="ltr">{row.requests}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ padding: 'var(--w-space-4)', paddingBlockEnd: 0, display: 'flex', gap: 'var(--w-space-2)', flexWrap: 'wrap' }}>
              {GRANULARITIES.map((g) => (
                <Button
                  key={g}
                  size="sm"
                  variant={granularity === g ? 'primary' : 'secondary'}
                  data-action="settings.usage.granularity.set"
                  data-granularity={g}
                  onClick={() => setGranularity(g)}
                >
                  {t(`settings.usage.granularity.${g}`)}
                </Button>
              ))}
            </div>

            {timeRows.length > 0 && (
              <div style={{ padding: 'var(--w-space-4)' }} className="v3-settings-table" role="table" aria-label={t('settings.usage.granularity.' + granularity)}>
                <div role="row" className="v3-settings-table-head">
                  <span role="columnheader">{t('settings.usage.col.cost')}</span>
                  <span role="columnheader">{t('settings.usage.col.tokens_in')}</span>
                  <span role="columnheader">{t('settings.usage.col.tokens_out')}</span>
                  <span role="columnheader">{t('settings.usage.col.requests')}</span>
                </div>
                {timeRows.map((row) => (
                  <div role="row" key={row.period} data-testid={`usage-time-row-${row.period}`}>
                    <span role="cell">{row.period}</span>
                    <span role="cell" dir="ltr">${(row.costCents / 100).toFixed(2)}</span>
                    <span role="cell" dir="ltr">{row.promptTokens + row.cacheReadTokens + row.cacheWriteTokens}</span>
                    <span role="cell" dir="ltr">{row.completionTokens}</span>
                    <span role="cell" dir="ltr">{row.requests}</span>
                  </div>
                ))}
              </div>
            )}

            {windowData && (
              <div style={{ padding: 'var(--w-space-4)' }} data-testid="usage-subscription-windows">
                <div className="v3-settings-row-title">{t('settings.usage.windows.title')}</div>
                <div className="v3-settings-row" data-testid="usage-window-5h">
                  <div className="v3-settings-row-main">
                    <div className="v3-settings-row-title">{t('settings.usage.windows.five_hour')}</div>
                    <div className="v3-settings-row-subtitle" dir="ltr">
                      {t('settings.usage.windows.line', {
                        cost: `$${(windowData.fiveHour.costCents / 100).toFixed(2)}`,
                        requests: windowData.fiveHour.requests,
                      })}
                      {' · '}
                      <span>{t('settings.usage.estimated')}</span>
                    </div>
                  </div>
                </div>
                <div className="v3-settings-row" data-testid="usage-window-7d">
                  <div className="v3-settings-row-main">
                    <div className="v3-settings-row-title">{t('settings.usage.windows.seven_day')}</div>
                    <div className="v3-settings-row-subtitle" dir="ltr">
                      {t('settings.usage.windows.line', {
                        cost: `$${(windowData.sevenDay.costCents / 100).toFixed(2)}`,
                        requests: windowData.sevenDay.requests,
                      })}
                      {' · '}
                      <span>{t('settings.usage.estimated')}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {providers.data && providers.data.length > 0 && (
              <div style={{ padding: 'var(--w-space-4)' }}>
                {providers.data.map((p) => {
                  const quota = quotas[p.name];
                  const quotaError = quotaErrors[p.name];
                  const status = quota ? quotaStatus(quota.quota) : null;
                  return (
                    <div key={p.name} className="v3-settings-row" data-testid={`usage-quota-row-${p.name}`}>
                      <span className="v3-settings-row-icon" aria-hidden="true">
                        <IconGauge size={18} />
                      </span>
                      <div className="v3-settings-row-main">
                        <div className="v3-settings-row-title">{p.name}</div>
                        <div className="v3-settings-row-subtitle">
                          {quota ? (
                            <>
                              <span>{quotaLine(t, quota.quota)}</span>
                              {quota.quota.state !== 'unknown' && (
                                <>
                                  {' · '}
                                  <span>{t('settings.usage.estimated')}</span>
                                </>
                              )}
                              {status && <span data-testid={`usage-quota-status-${p.name}`} data-status={status} />}
                            </>
                          ) : quotaError ? (
                            <span>{quotaError}</span>
                          ) : (
                            <span>{t('settings.usage.quota.unknown')}</span>
                          )}
                        </div>
                      </div>
                      <div className="v3-settings-row-actions">
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={checkQuotaAction.pending}
                          data-action="settings.usage.quota.check"
                          data-provider={p.name}
                          onClick={() => {
                            void checkQuotaAction.run(p.name);
                          }}
                        >
                          {t('settings.usage.quota.check')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </SettingsSection>
    </div>
  );
}
