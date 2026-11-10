import type { ProjectSummary, RunSummary } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
// eslint-disable-next-line import/no-unresolved
import { Banner, Button, IconPlus, Skeleton, StatusPill } from '@warsha/ui/v3';
import React from 'react';

import { getStatusLabelKey, mapRunStatusToPill } from '../helpers';

export interface BenchRailProps {
  projects: ProjectSummary[];
  projectsStatus: 'loading' | 'empty' | 'error' | 'ready';
  runsByProject: Record<string, RunSummary[]>;
  activeProjectId: string;
  activeRunId: string;
  onNewProject: () => void;
  onSelectRun: (projectId: string, runId: string) => void;
  onRetryProjects: () => void;
}

export const BenchRail: React.FC<BenchRailProps> = ({
  projects,
  projectsStatus,
  runsByProject,
  activeProjectId,
  activeRunId,
  onNewProject,
  onSelectRun,
  onRetryProjects,
}) => {
  const t = useT();

  return (
    <nav
      aria-label={t('bench.rail.title')}
      data-testid="bench-rail"
      style={{
        flex: '1 1 var(--w-rail-width)',
        maxWidth: '100%',
        backgroundColor: 'var(--w-surface)',
        borderInlineEnd: 'var(--w-border-width) solid var(--w-line)',
        borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
        padding: 'var(--w-space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-3)',
        boxSizing: 'border-box',
      }}
    >
      <Button
        variant="secondary"
        size="sm"
        icon={<IconPlus size={16} />}
        onClick={onNewProject}
        data-action="bench.project.new"
        data-testid="bench-new-project-btn"
        style={{ width: '100%' }}
      >
        {t('bench.rail.new_project')}
      </Button>

      {projectsStatus === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-2)' }}>
          <Skeleton height="var(--w-space-6)" />
          <Skeleton height="var(--w-space-8)" />
          <Skeleton height="var(--w-space-8)" />
        </div>
      )}

      {projectsStatus === 'error' && (
        <Banner
          variant="danger"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={onRetryProjects}
              data-action="bench.stream.reconnect"
            >
              {t('bench.retry')}
            </Button>
          }
        >
          {t('bench.error')}
        </Banner>
      )}

      {projectsStatus === 'empty' && (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--w-font-size-sm)',
            color: 'var(--w-text-muted)',
          }}
        >
          {t('bench.rail.no_projects')}
        </p>
      )}

      {(projectsStatus === 'ready' || projects.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          {projects.map((project) => {
            const runs = runsByProject[project.id] ?? [];
            const displayProjectName = project.name.trim() || t('bench.project.unnamed');
            return (
              <div
                key={project.id}
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-1)' }}
              >
                <div
                  style={{
                    fontSize: 'var(--w-font-size-xs)',
                    fontWeight: 'var(--w-font-weight-semibold)',
                    color: 'var(--w-text-muted)',
                    paddingBlockStart: 'var(--w-space-2)',
                    paddingInline: 'var(--w-space-2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={displayProjectName}
                >
                  {displayProjectName}
                </div>

                {runs.length === 0 ? (
                  <div
                    style={{
                      fontSize: 'var(--w-font-size-xs)',
                      color: 'var(--w-text-faint)',
                      paddingInline: 'var(--w-space-2)',
                    }}
                  >
                    {t('bench.rail.empty_runs')}
                  </div>
                ) : (
                  runs.map((run, idx) => {
                    const isSelected = run.id === activeRunId && project.id === activeProjectId;
                    const pillState = mapRunStatusToPill(run.status);
                    return (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => onSelectRun(project.id, run.id)}
                        data-action="bench.run.select"
                        data-run-id={run.id}
                        aria-current={isSelected ? 'true' : undefined}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 'var(--w-space-2)',
                          width: '100%',
                          paddingBlock: 'var(--w-space-2)',
                          paddingInline: 'var(--w-space-3)',
                          minHeight: 'var(--w-control-height)',
                          border: 'none',
                          borderRadius: 'var(--w-radius-sm)',
                          backgroundColor: isSelected ? 'var(--w-primary-soft)' : 'transparent',
                          color: isSelected ? 'var(--w-primary-text)' : 'var(--w-text)',
                          fontWeight: isSelected
                            ? 'var(--w-font-weight-semibold)'
                            : 'var(--w-font-weight-regular)',
                          fontSize: 'var(--w-font-size-sm)',
                          fontFamily: 'var(--w-font-sans)',
                          textAlign: 'start',
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t('bench.header.run_num', { number: runs.length - idx })}
                        </span>
                        <StatusPill status={pillState} label={t(getStatusLabelKey(run.status))} />
                      </button>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
};

BenchRail.displayName = 'BenchRail';
