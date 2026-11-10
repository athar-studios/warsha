// apps/desktop/src/v3/pages/settings/sections/PostLaunchSection.tsx
import type { CrashReport, RunId, StoreReview } from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  IconAlert,
  IconButton,
  IconCopy,
  Select,
  SettingsSection,
  Skeleton,
  StatusPill,
  TextField,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useCallback, useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';

export function PostLaunchSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [crashes, setCrashes] = useState<CrashReport[]>([]);
  const [reviews, setReviews] = useState<StoreReview[]>([]);

  const [runIdFilter, setRunIdFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadData = useCallback(async (runId?: string, store?: string) => {
    setLoading(true);
    setReady(false);
    setLoadFailed(false);
    setLoadError(null);
    if (!client) {
      setCrashes([]);
      setReviews([]);
      setLoading(false);
      setReady(true);
      return;
    }
    try {
      const [crashList, reviewList] = await Promise.all([
        client.listCrashReports(runId ? (runId as RunId) : undefined),
        client.listStoreReviews(store || undefined),
      ]);
      setCrashes(crashList);
      setReviews(reviewList);
      setLoading(false);
      setReady(true);
    } catch (err) {
      setLoadFailed(true);
      setLoadError(err instanceof Error ? err.message : null);
      setLoading(false);
      setReady(true);
    }
  }, [client, setReady]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filterCrashesAction = useAction('settings.crashes.filter', async () => {
    if (!client) return;
    const rows = await client.listCrashReports(
      runIdFilter.trim() ? (runIdFilter.trim() as RunId) : undefined
    );
    setCrashes(rows);
  });

  const filterReviewsAction = useAction('settings.reviews.filter', async () => {
    if (!client) return;
    const rows = await client.listStoreReviews(storeFilter || undefined);
    setReviews(rows);
  });

  const handleCopyCrash = (crash: CrashReport): void => {
    const details = `${crash.id} (${crash.run_id}): ${crash.message}${crash.stack_trace ? `\n${crash.stack_trace}` : ''}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(details).catch(() => {});
    }
    setCopiedId(crash.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) {
    return (
      <SettingsSection
        title={t('settings.section.postlaunch')}
        description={t('settings.section.postlaunch.desc')}
        scope={t('settings.scope.all_runs')}
      >
        <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      </SettingsSection>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-5)' }} data-testid="settings-section-postlaunch">
      <SettingsSection
        title={t('settings.section.postlaunch')}
        description={t('settings.section.postlaunch.desc')}
        scope={t('settings.scope.all_runs')}
      >
        {loadFailed && (
          <div style={{ padding: 'var(--w-space-4)' }}>
            <Banner variant="danger">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--w-space-3)', flexWrap: 'wrap' }}>
                <span>{loadError ?? t('common.error')}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="settings.error.retry"
                  onClick={() => {
                    void loadData(runIdFilter.trim() || undefined, storeFilter || undefined);
                  }}
                >
                  {t('common.retry')}
                </Button>
              </div>
            </Banner>
          </div>
        )}

        {copiedId && (
          <div style={{ padding: 'var(--w-space-4)', paddingBlockEnd: 0 }}>
            <Banner variant="success">{t('settings.postlaunch.copied')}</Banner>
          </div>
        )}

        {/* Crash reports filter & header */}
        <div
          style={{
            padding: 'var(--w-space-4)',
            borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: 'var(--w-space-3)',
          }}
        >
          <div style={{ flex: '1 1 var(--w-nav-width)', maxWidth: '100%' }}>
            <TextField
              label={t('settings.postlaunch.filter_run')}
              value={runIdFilter}
              onChange={(e) => setRunIdFilter(e.target.value)}
              dir="ltr"
              data-testid="postlaunch-run-filter-input"
            />
          </div>
          <Button
            size="sm"
            variant="primary"
            loading={filterCrashesAction.pending}
            data-action="settings.crashes.filter"
            onClick={() => {
              void filterCrashesAction.run();
            }}
          >
            {t('settings.postlaunch.filter_btn')}
          </Button>
        </div>

        {/* Crash reports list */}
        <div style={{ padding: 'var(--w-space-3) var(--w-space-4)', borderBlockEnd: 'var(--w-border-width) solid var(--w-line)' }}>
          <strong style={{ fontSize: 'var(--w-font-size-sm)' }}>
            {t('settings.postlaunch.crashes_title')}
          </strong>
        </div>

        {crashes.length === 0 ? (
          !loadFailed && (
            <EmptyState
              icon={<IconAlert size={20} />}
              title={t('settings.postlaunch.crashes_empty')}
            />
          )
        ) : (
          <div>
            {crashes.map((c) => (
              <div key={c.id} className="v3-settings-row" data-testid={`crash-row-${c.id}`}>
                <span className="v3-settings-row-icon" aria-hidden="true">
                  <IconAlert size={18} />
                </span>
                <div className="v3-settings-row-main">
                  <div className="v3-settings-row-title">{c.message}</div>
                  <div className="v3-settings-row-subtitle">
                    <bdi dir="ltr">{c.id}</bdi>
                    {' · '}
                    <bdi dir="ltr">{c.run_id}</bdi>
                  </div>
                  {c.stack_trace && (
                    <pre className="v3-settings-code-block" dir="ltr" style={{ marginBlockStart: 'var(--w-space-2)' }}>
                      {c.stack_trace}
                    </pre>
                  )}
                </div>
                <div className="v3-settings-row-meta">
                  <StatusPill
                    status={c.sent ? 'done' : 'idle'}
                    label={
                      c.sent
                        ? t('settings.postlaunch.crash_sent')
                        : t('settings.postlaunch.crash_pending')
                    }
                  />
                </div>
                <div className="v3-settings-row-actions">
                  <IconButton
                    size="sm"
                    variant="ghost"
                    icon={<IconCopy size={16} />}
                    label={t('settings.postlaunch.copy_crash')}
                    data-action="settings.crash.copy"
                    onClick={() => handleCopyCrash(c)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {/* Store reviews card */}
      <Card title={t('settings.postlaunch.reviews_title')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-4)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 'var(--w-space-3)' }}>
            <div style={{ flex: '1 1 var(--w-nav-width)', maxWidth: '100%' }}>
              <Select
                label={t('settings.postlaunch.reviews_title')}
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                options={[
                  { value: '', label: t('settings.postlaunch.store.all') },
                  { value: 'play', label: t('settings.postlaunch.store.play') },
                  { value: 'ios', label: t('settings.postlaunch.store.ios') },
                ]}
                data-testid="postlaunch-store-select"
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={filterReviewsAction.pending}
              data-action="settings.reviews.filter"
              onClick={() => {
                void filterReviewsAction.run();
              }}
            >
              {t('settings.postlaunch.filter_btn')}
            </Button>
          </div>

          {reviews.length === 0 ? (
            <EmptyState title={t('settings.postlaunch.reviews_empty')} />
          ) : (
            <div>
              {reviews.map((rev) => (
                <div key={rev.id} className="v3-settings-row" data-testid={`review-row-${rev.id}`}>
                  <div className="v3-settings-row-main">
                    <div className="v3-settings-row-title">
                      <span>{rev.author}</span>
                      {' · '}
                      <span>{t('settings.postlaunch.rating', { rating: rev.rating })}</span>
                    </div>
                    <div className="v3-settings-row-subtitle">{rev.body}</div>
                  </div>
                  <div className="v3-settings-row-meta">
                    <StatusPill
                      status="idle"
                      label={
                        rev.store === 'play'
                          ? t('settings.postlaunch.store.play')
                          : rev.store === 'ios'
                            ? t('settings.postlaunch.store.ios')
                            : rev.store
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
