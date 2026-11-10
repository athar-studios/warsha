import type { ProjectSummary, RunSummary } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import {
  Button,
  IconChevron,
  IconPlus,
  IconSearch,
  StatusPill,
  sanitizeProjectName,
  type StatusPillState,
  // eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface FrameProjectSwitcherProps {
  currentProjectId?: string;
  projects: readonly ProjectSummary[];
  runsByProject: Readonly<Record<string, readonly RunSummary[]>>;
  onSelectProject: (projectId: string) => void;
  onNewProject: () => void;
}

interface ResolvedStatus {
  status: StatusPillState;
  label: string;
}

export function resolveProjectStatus(
  runs: readonly RunSummary[] | undefined,
  t: (key: string) => string
): ResolvedStatus {
  if (!runs || runs.length === 0) {
    return { status: 'idle', label: t('frame.status_idle') };
  }

  const awaiting = runs.find((run) => run.status === 'awaiting_gate');
  const candidate =
    awaiting ??
    [...runs].sort((a, b) => (b.updatedAt || b.startedAt).localeCompare(a.updatedAt || a.startedAt))[0];

  switch (candidate?.status) {
    case 'awaiting_gate':
      return { status: 'waiting', label: t('frame.status_waiting') };
    case 'running':
    case 'in_progress':
      return { status: 'running', label: t('frame.status_running') };
    case 'completed':
    case 'done':
      return { status: 'done', label: t('frame.status_done') };
    case 'failed':
    case 'error':
    case 'cancelled':
      return { status: 'failed', label: t('frame.status_failed') };
    case 'paused':
      return { status: 'paused', label: t('frame.status_paused') };
    default:
      return { status: 'idle', label: t('frame.status_idle') };
  }
}

export function FrameProjectSwitcher({
  currentProjectId,
  projects,
  runsByProject,
  onSelectProject,
  onNewProject,
}: FrameProjectSwitcherProps): React.ReactElement {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const anonymousFallback = t('frame.anonymous_project');

  const currentProject = useMemo(
    () => (currentProjectId ? projects.find((p) => p.id === currentProjectId) : undefined),
    [projects, currentProjectId]
  );

  const displayName = currentProjectId
    ? sanitizeProjectName(currentProject?.name, anonymousFallback)
    : t('frame.select_project');

  const currentStatus = currentProjectId
    ? resolveProjectStatus(runsByProject[currentProjectId], t)
    : undefined;

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) => {
      const name = sanitizeProjectName(project.name, anonymousFallback);
      return name.toLowerCase().includes(q);
    });
  }, [projects, query, anonymousFallback]);

  const triggerLabel = `${t('frame.project_switcher_label')}: ${displayName}`;

  return (
    <div
      ref={containerRef}
      className="w-project-switcher"
      style={{
        position: 'relative',
        display: 'inline-block',
        maxInlineSize: '100%',
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={triggerLabel}
        data-action="frame.project.open"
        onClick={() => setOpen((prev) => !prev)}
        className="w-project-switcher__trigger"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--w-space-2)',
          minBlockSize: 'var(--w-control-height)',
          maxInlineSize: '100%',
          paddingBlock: 'var(--w-space-1)',
          paddingInline: 'var(--w-space-3)',
          borderRadius: 'var(--w-radius-sm)',
          border: 'var(--w-border-width) solid var(--w-line)',
          backgroundColor: 'var(--w-surface)',
          color: 'var(--w-text)',
          cursor: 'pointer',
          fontFamily: 'var(--w-font-sans)',
          fontSize: 'var(--w-font-size-sm)',
          fontWeight: 'var(--w-font-weight-medium)',
        }}
      >
        <bdi
          dir="auto"
          title={displayName}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxInlineSize: 'var(--w-nav-width)',
          }}
        >
          {displayName}
        </bdi>
        {currentStatus && <StatusPill status={currentStatus.status} label={currentStatus.label} />}
        <IconChevron
          size={16}
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--w-dur-fast) var(--w-ease)',
          }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('frame.project_switcher_label')}
          className="w-project-switcher__menu"
          style={{
            position: 'absolute',
            insetBlockStart: '100%',
            insetInlineStart: 0,
            marginBlockStart: 'var(--w-space-1)',
            minInlineSize: 'var(--w-nav-width)',
            maxInlineSize: 'calc(100vw - var(--w-space-6))',
            backgroundColor: 'var(--w-surface)',
            border: 'var(--w-border-width) solid var(--w-line)',
            borderRadius: 'var(--w-radius-md)',
            boxShadow: 'var(--w-shadow-2)',
            zIndex: 'var(--w-layer-dropdown)',
            padding: 'var(--w-space-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-2)',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--w-space-2)',
              paddingBlock: 'var(--w-space-1)',
              paddingInline: 'var(--w-space-2)',
              borderRadius: 'var(--w-radius-sm)',
              border: 'var(--w-border-width) solid var(--w-line)',
              backgroundColor: 'var(--w-sunken)',
            }}
          >
            <IconSearch size={16} aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('frame.search_projects')}
              aria-label={t('frame.search_projects')}
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                inlineSize: '100%',
                fontFamily: 'var(--w-font-sans)',
                fontSize: 'var(--w-font-size-sm)',
                color: 'var(--w-text)',
              }}
            />
          </div>

          <div
            style={{
              maxBlockSize: 'var(--w-rail-width)',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--w-space-1)',
            }}
          >
            {filteredProjects.length === 0 ? (
              <div
                style={{
                  paddingBlock: 'var(--w-space-2)',
                  paddingInline: 'var(--w-space-3)',
                  fontSize: 'var(--w-font-size-sm)',
                  color: 'var(--w-text-muted)',
                }}
              >
                {t('frame.no_projects')}
              </div>
            ) : (
              filteredProjects.map((project) => {
                const name = sanitizeProjectName(project.name, anonymousFallback);
                const isSelected = currentProjectId === project.id;
                const status = resolveProjectStatus(runsByProject[project.id], t);
                return (
                  <button
                    key={project.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-action="frame.project.switch"
                    data-project-id={project.id}
                    onClick={() => {
                      onSelectProject(project.id);
                      setOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 'var(--w-space-2)',
                      paddingBlock: 'var(--w-space-2)',
                      paddingInline: 'var(--w-space-3)',
                      borderRadius: 'var(--w-radius-sm)',
                      border: 'none',
                      backgroundColor: isSelected ? 'var(--w-primary-soft)' : 'transparent',
                      color: isSelected ? 'var(--w-primary-text)' : 'var(--w-text)',
                      cursor: 'pointer',
                      textAlign: 'start',
                      fontFamily: 'var(--w-font-sans)',
                      fontSize: 'var(--w-font-size-sm)',
                      fontWeight: isSelected
                        ? 'var(--w-font-weight-semibold)'
                        : 'var(--w-font-weight-regular)',
                    }}
                  >
                    <bdi
                      dir="auto"
                      title={name}
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {name}
                    </bdi>
                    <StatusPill status={status.status} label={status.label} />
                  </button>
                );
              })
            )}
          </div>

          <div
            style={{
              borderBlockStart: 'var(--w-border-width) solid var(--w-line)',
              paddingBlockStart: 'var(--w-space-2)',
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              icon={<IconPlus size={16} />}
              data-action="frame.project.new"
              onClick={() => {
                onNewProject();
                setOpen(false);
              }}
              style={{ inlineSize: '100%', justifyContent: 'flex-start' }}
            >
              {t('frame.new_project')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default FrameProjectSwitcher;
