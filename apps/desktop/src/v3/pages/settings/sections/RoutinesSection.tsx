// apps/desktop/src/v3/pages/settings/sections/RoutinesSection.tsx
import type { Routine, RoutineSchedule, RoutineState } from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  Dialog,
  EmptyState,
  IconCalendar,
  SettingsSection,
  Skeleton,
  StatusPill,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';
import { useRoutines } from '../../../data';

function formatSchedule(
  schedule: RoutineSchedule,
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  if (schedule === 'manual') return t('settings.routines.schedule.manual');
  if ('cron' in schedule) return t('settings.routines.schedule.cron', { expr: schedule.cron });
  return t('settings.routines.schedule.interval', { seconds: schedule.intervalSeconds });
}

function mapRoutineState(
  state: RoutineState,
  t: (key: string) => string
): { pill: 'idle' | 'running' | 'paused' | 'failed'; label: string } {
  if (state === 'running') return { pill: 'running', label: t('settings.routines.state.running') };
  if (state === 'paused') return { pill: 'paused', label: t('settings.routines.state.paused') };
  if (state === 'idle') return { pill: 'idle', label: t('settings.routines.state.idle') };
  return { pill: 'failed', label: `${t('settings.routines.state.failed')}: ${state.failed}` };
}

export function RoutinesSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();
  const { status, data: routines, error, reload } = useRoutines();

  const [viewTarget, setViewTarget] = useState<Routine | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setReady(status !== 'loading');
  }, [status, setReady]);

  const runNowAction = useAction('settings.routine.run-now', async (id: string) => {
    if (!client) return;
    await client.runRoutineNow(id);
    setStatusMessage(t('settings.common.action_done'));
    reload();
  });

  const pauseAction = useAction('settings.routine.pause', async (id: string) => {
    if (!client) return;
    await client.pauseRoutine(id);
    setStatusMessage(t('settings.common.action_done'));
    reload();
  });

  const resumeAction = useAction('settings.routine.resume', async (id: string) => {
    if (!client) return;
    await client.resumeRoutine(id);
    setStatusMessage(t('settings.common.action_done'));
    reload();
  });

  const viewAction = useAction('settings.routine.view', async (id: string) => {
    if (!client) return;
    const routine = await client.getRoutine(id);
    if (routine) {
      setViewTarget(routine);
    } else {
      const local = routines?.find((r) => r.id === id) ?? null;
      if (local) setViewTarget(local);
    }
  });

  if (status === 'loading') {
    return (
      <SettingsSection
        title={t('settings.section.routines')}
        description={t('settings.section.routines.desc')}
        scope={t('settings.scope.daemon')}
      >
        <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      </SettingsSection>
    );
  }

  return (
    <div data-testid="settings-section-routines">
      <SettingsSection
        title={t('settings.section.routines')}
        description={t('settings.section.routines.desc')}
        scope={t('settings.scope.daemon')}
      >
        {status === 'error' && (
          <div style={{ padding: 'var(--w-space-4)' }}>
            <Banner variant="danger">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--w-space-3)', flexWrap: 'wrap' }}>
                <span>{error?.message ?? t('common.error')}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="settings.error.retry"
                  onClick={reload}
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

        {status === 'empty' || !routines || routines.length === 0 ? (
          status !== 'error' && (
            <EmptyState
              icon={<IconCalendar size={20} />}
              title={t('settings.routines.empty.title')}
              description={t('settings.routines.empty.desc')}
            />
          )
        ) : (
          <div>
            {routines.map((r) => {
              const st = mapRoutineState(r.state, t);
              return (
                <div key={r.id} className="v3-settings-row" data-testid={`routine-row-${r.id}`}>
                  <span className="v3-settings-row-icon" aria-hidden="true">
                    <IconCalendar size={18} />
                  </span>
                  <div className="v3-settings-row-main">
                    <div className="v3-settings-row-title">
                      {r.name || <bdi dir="ltr">{r.id}</bdi>}
                    </div>
                    <div className="v3-settings-row-subtitle">
                      <span>
                        {r.description && (
                          <>
                            <span>{r.description}</span>
                            {' · '}
                          </>
                        )}
                        <span>{formatSchedule(r.schedule, t)}</span>
                      </span>
                    </div>
                  </div>
                  <div className="v3-settings-row-meta">
                    <StatusPill status={st.pill} label={st.label} />
                  </div>
                  <div className="v3-settings-row-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={runNowAction.pending}
                      data-action="settings.routine.run-now"
                      onClick={() => {
                        void runNowAction.run(r.id);
                      }}
                    >
                      {t('settings.routines.run_now')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={r.state === 'paused'}
                      loading={pauseAction.pending}
                      data-action="settings.routine.pause"
                      onClick={() => {
                        void pauseAction.run(r.id);
                      }}
                    >
                      {t('settings.routines.pause')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={r.state === 'running' || r.state === 'idle'}
                      loading={resumeAction.pending}
                      data-action="settings.routine.resume"
                      onClick={() => {
                        void resumeAction.run(r.id);
                      }}
                    >
                      {t('settings.routines.resume')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={viewAction.pending}
                      data-action="settings.routine.view"
                      onClick={() => {
                        void viewAction.run(r.id);
                      }}
                    >
                      {t('settings.routines.view')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingsSection>

      {/* View Routine Details Dialog */}
      <Dialog
        open={Boolean(viewTarget)}
        onClose={() => setViewTarget(null)}
        title={viewTarget ? `${t('settings.routines.detail.title')}: ${viewTarget.name}` : ''}
        data-testid="routine-view-dialog"
      >
        {viewTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
            <pre className="v3-settings-code-block" dir="ltr">
              {JSON.stringify(viewTarget, null, 2)}
            </pre>
            <div className="v3-settings-dialog-actions">
              <Button
                variant="secondary"
                data-action="settings.dialog.cancel"
                onClick={() => setViewTarget(null)}
              >
                {t('common.close')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
