import { invoke } from '@tauri-apps/api/core';
import type { GateSummary, ProjectSummary, RunSummary, Stage } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import {
  Badge,
  Banner,
  Button,
  IconButton,
  IconInbox,
  IconSettings,
  ToastProvider,
  TopBar,
  useToast,
  // eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAction } from '../../actions';
import { useClient } from '../../app/ClientContext';
import { useDataReady } from '../../app/DataReadyContext';
import { useDensity, type AppMode } from '../../app/DensityContext';
import { subscribeToast, type ToastMessage } from '../../app/toast';
import { useHealth, useProjects } from '../../data';
import { useNavigate, useRoute } from '../../router';

// eslint-disable-next-line import/no-unresolved
import '@warsha/ui/v3/tokens/tokens.css';

import { FrameProjectSwitcher } from './FrameProjectSwitcher';
import './frame.css';

export interface FrameProps {
  children?: React.ReactNode;
}

/**
 * Counts waiting gates limited strictly to the gate at the run's CURRENT stage.
 * Amendment §5.5-b: never count future gates.
 */
export function countPendingGatesAtCurrentStage(
  gates: readonly GateSummary[],
  runStage: Stage
): number {
  return gates.filter(
    (gate) => gate.state.state === 'pending' && gate.stage === runStage
  ).length;
}

function ToastBridge(): null {
  const { toast } = useToast();
  const t = useT();

  useEffect(() => {
    return subscribeToast((msg: ToastMessage) => {
      const variantMap = {
        error: 'danger',
        warning: 'attention',
        success: 'success',
        info: 'info',
      } as const;
      const variant = variantMap[msg.type] ?? 'info';
      toast({
        id: msg.id,
        variant,
        description: msg.message,
        dismissLabel: t('common.close'),
      });
    });
  }, [toast, t]);

  return null;
}

export function Frame({ children }: FrameProps): React.ReactElement {
  const t = useT();
  const { isReady } = useDataReady();
  const { mode, density, setMode } = useDensity();
  const client = useClient();
  const navigate = useNavigate();
  const { params } = useRoute();

  const projectsResult = useProjects();
  const healthResult = useHealth();

  const [inboxCount, setInboxCount] = useState<number>(0);
  const [runsByProject, setRunsByProject] = useState<Record<string, RunSummary[]>>({});
  const initialModeSyncedRef = useRef(false);

  // Sync mode with Tauri shell config on mount if available
  useEffect(() => {
    if (initialModeSyncedRef.current) return;
    initialModeSyncedRef.current = true;

    try {
      invoke<string>('get_config', { key: 'app_mode' })
        .then((stored) => {
          if (stored === 'simple' || stored === 'advanced') {
            setMode(stored);
          }
        })
        .catch(() => {
          // Ignore in non-Tauri / test environments
        });
    } catch {
      // Ignore invoke failure
    }
  }, [setMode]);

  // Load runs and count inbox decisions across all projects
  useEffect(() => {
    if (!client || !projectsResult.data || projectsResult.data.length === 0) {
      setInboxCount(0);
      setRunsByProject({});
      return;
    }

    let active = true;
    const projectList = projectsResult.data;

    const loadData = async (): Promise<void> => {
      const runsMap: Record<string, RunSummary[]> = {};
      let totalWaiting = 0;

      await Promise.all(
        projectList.map(async (project: ProjectSummary) => {
          try {
            const runs = await client.listRuns(project.id);
            runsMap[project.id] = runs;

            // For each non-terminal run, inspect gates.list
            for (const run of runs) {
              if (
                run.status === 'completed' ||
                run.status === 'cancelled' ||
                run.status === 'failed'
              ) {
                continue;
              }

              try {
                const gates = await client.getGates(run.id);
                // Amendment §5.5-b: only count the gate at the run's current stage
                totalWaiting += countPendingGatesAtCurrentStage(gates, run.stage);
              } catch {
                // Ignore gate query failure for single run
              }
            }
          } catch {
            // Ignore run query failure for single project
          }
        })
      );

      if (active) {
        setRunsByProject(runsMap);
        setInboxCount(totalWaiting);
      }
    };

    void loadData();

    return () => {
      active = false;
    };
  }, [client, projectsResult.data]);

  const daemonOffline = healthResult.status === 'error';

  const retryAction = useAction('frame.daemon.retry', async () => {
    if (!client) {
      throw new Error(t('frame.daemon_offline'));
    }
    await client.health();
    healthResult.reload();
    projectsResult.reload();
  });

  const handleSwitchMode = useCallback(
    (nextMode: AppMode): void => {
      setMode(nextMode);
      try {
        invoke('set_config', { key: 'app_mode', value: nextMode }).catch(() => {
          // Ignore in non-Tauri / test environments
        });
      } catch {
        // Ignore in non-Tauri / test environments
      }
    },
    [setMode]
  );

  const handleModeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, current: AppMode): void => {
      if (
        e.key === 'ArrowRight' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp'
      ) {
        e.preventDefault();
        const next: AppMode = current === 'simple' ? 'advanced' : 'simple';
        handleSwitchMode(next);
        const group = e.currentTarget.parentElement;
        const target = group?.querySelector<HTMLButtonElement>(`[data-action="frame.mode.${next}"]`);
        target?.focus();
      }
    },
    [handleSwitchMode]
  );

  const handleSkipToMain = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    const main = document.getElementById('main');
    main?.focus();
  };

  const handleOpenInbox = (): void => {
    navigate('/inbox');
  };

  const handleOpenSettings = (): void => {
    navigate('/settings/general');
  };

  const handleSelectProject = (projectId: string): void => {
    navigate(`/p/${projectId}`);
  };

  const handleNewProject = (): void => {
    navigate('/');
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const composer = document.querySelector('main textarea') as HTMLElement | null;
        composer?.focus();
      });
    }
  };

  const inboxAriaLabel =
    inboxCount > 0
      ? t('frame.inbox_pending', { count: inboxCount })
      : t('frame.inbox_label');

  const brandElement = useMemo(
    () => (
      <div className="v3-frame-brand">
        <svg
          viewBox="0 0 24 24"
          className="v3-frame-brand-hex"
          aria-hidden="true"
        >
          <path
            d="M12 2l8.66 5v10L12 22l-8.66-5V7z"
            fill="var(--w-primary)"
          />
          <circle cx="12" cy="12" r="3.5" fill="var(--w-on-primary)" />
        </svg>
        <span>{t('common.app_name')}</span>
      </div>
    ),
    [t]
  );

  const modeSwitchElement = useMemo(
    () => (
      <div
        role="radiogroup"
        aria-label={t('frame.mode_label')}
        className="w-segmented"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          backgroundColor: 'var(--w-sunken)',
          borderRadius: 'var(--w-radius-sm)',
          padding: 'var(--w-space-1)',
          gap: 'var(--w-space-1)',
          fontFamily: 'var(--w-font-sans)',
        }}
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'simple'}
          tabIndex={mode === 'simple' ? 0 : -1}
          data-action="frame.mode.simple"
          onClick={() => handleSwitchMode('simple')}
          onKeyDown={(e) => handleModeKeyDown(e, 'simple')}
          className={`w-segmented__item ${mode === 'simple' ? 'w-segmented__item--selected' : ''}`.trim()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            borderRadius: 'var(--w-radius-sm)',
            paddingBlock: 'var(--w-space-1)',
            paddingInline: 'var(--w-space-3)',
            minBlockSize: 'var(--w-control-height)',
            fontSize: 'var(--w-font-size-sm)',
            lineHeight: 'var(--w-line-height-sm)',
            fontWeight:
              mode === 'simple'
                ? 'var(--w-font-weight-medium)'
                : 'var(--w-font-weight-regular)',
            backgroundColor: mode === 'simple' ? 'var(--w-surface)' : 'transparent',
            color: mode === 'simple' ? 'var(--w-text)' : 'var(--w-text-muted)',
            boxShadow: mode === 'simple' ? 'var(--w-shadow-1)' : 'none',
            cursor: 'pointer',
            transition:
              'background-color var(--w-dur-fast) var(--w-ease), color var(--w-dur-fast) var(--w-ease)',
          }}
        >
          {t('frame.mode_simple')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'advanced'}
          tabIndex={mode === 'advanced' ? 0 : -1}
          data-action="frame.mode.advanced"
          onClick={() => handleSwitchMode('advanced')}
          onKeyDown={(e) => handleModeKeyDown(e, 'advanced')}
          className={`w-segmented__item ${mode === 'advanced' ? 'w-segmented__item--selected' : ''}`.trim()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            borderRadius: 'var(--w-radius-sm)',
            paddingBlock: 'var(--w-space-1)',
            paddingInline: 'var(--w-space-3)',
            minBlockSize: 'var(--w-control-height)',
            fontSize: 'var(--w-font-size-sm)',
            lineHeight: 'var(--w-line-height-sm)',
            fontWeight:
              mode === 'advanced'
                ? 'var(--w-font-weight-medium)'
                : 'var(--w-font-weight-regular)',
            backgroundColor: mode === 'advanced' ? 'var(--w-surface)' : 'transparent',
            color: mode === 'advanced' ? 'var(--w-text)' : 'var(--w-text-muted)',
            boxShadow: mode === 'advanced' ? 'var(--w-shadow-1)' : 'none',
            cursor: 'pointer',
            transition:
              'background-color var(--w-dur-fast) var(--w-ease), color var(--w-dur-fast) var(--w-ease)',
          }}
        >
          {t('frame.mode_advanced')}
        </button>
      </div>
    ),
    [mode, t, handleSwitchMode, handleModeKeyDown]
  );

  const projectSwitcherElement = (
    <FrameProjectSwitcher
      currentProjectId={params.projectId}
      projects={projectsResult.data ?? []}
      runsByProject={runsByProject}
      onSelectProject={handleSelectProject}
      onNewProject={handleNewProject}
    />
  );

  const inboxElement = (
    <div className="v3-frame-inbox-wrap">
      <IconButton
        icon={<IconInbox />}
        label={inboxAriaLabel}
        onClick={handleOpenInbox}
        data-action="frame.inbox.open"
      />
      {inboxCount > 0 && (
        <span className="v3-frame-inbox-badge" aria-hidden="true">
          <Badge count={inboxCount} variant="attention" />
        </span>
      )}
    </div>
  );

  const settingsElement = (
    <IconButton
      icon={<IconSettings />}
      label={t('frame.settings_label')}
      onClick={handleOpenSettings}
      data-action="frame.settings.open"
    />
  );

  const retryButtonElement = (
    <Button
      variant="secondary"
      size="sm"
      loading={retryAction.pending}
      onClick={() => {
        void retryAction.run();
      }}
      data-action="frame.daemon.retry"
    >
      {t('common.retry')}
    </Button>
  );

  return (
    <ToastProvider>
      <ToastBridge />
      <div data-density={density} className="v3-frame-root">
        <a
          href="#main"
          data-action="frame.skip-to-main"
          onClick={handleSkipToMain}
          className="v3-frame-skip"
        >
          {t('frame.skip_to_main')}
        </a>

        <header className="w-app-frame__header">
          <TopBar
            brand={brandElement}
            projectSwitcher={projectSwitcherElement}
            modeSwitch={modeSwitchElement}
            inbox={inboxElement}
            settings={settingsElement}
          />
        </header>

        {daemonOffline && (
          <div
            role="region"
            aria-label={t('frame.daemon_status_label')}
            className="v3-frame-banner"
          >
            <Banner variant="danger" action={retryButtonElement}>
              {t('frame.daemon_offline')}
            </Banner>
          </div>
        )}

        <main
          id="main"
          tabIndex={-1}
          data-ready={isReady ? 'true' : 'false'}
          className="v3-frame-main"
        >
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}

export default Frame;
