// packages/ui/src/v3/composites/ProjectSwitcher.tsx — Design System v3 ProjectSwitcher (DS v3 §3.2)
// Name + status, search, "new project". Never shows a raw UUID (falls back to fallbackName).

import React from 'react';

import { IconChevron, IconPlus, IconSearch } from '../icons';
import { Button } from '../primitives/Button';
import { StatusPill, type StatusPillState } from '../primitives/StatusPill';

export interface ProjectItem {
  id: string;
  name: string;
  status?: StatusPillState;
  statusLabel?: string;
}

export interface ProjectSwitcherProps {
  currentProject?: ProjectItem;
  projects?: ProjectItem[];
  fallbackName?: string;
  searchPlaceholder?: string;
  newProjectLabel?: string;
  ariaLabel?: string;
  onSelectProject?: (projectId: string) => void;
  onNewProject?: () => void;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function sanitizeProjectName(name: string | undefined, fallback: string): string {
  if (!name || !name.trim() || UUID_REGEX.test(name.trim())) {
    return fallback;
  }
  return name.trim();
}

export const ProjectSwitcher: React.FC<ProjectSwitcherProps> = ({
  currentProject,
  projects = [],
  fallbackName = '',
  searchPlaceholder,
  newProjectLabel,
  ariaLabel,
  onSelectProject,
  onNewProject,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  const displayName = currentProject
    ? sanitizeProjectName(currentProject.name, fallbackName)
    : fallbackName;

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const filteredProjects = projects.filter((p) => {
    const pName = sanitizeProjectName(p.name, fallbackName);
    return pName.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div
      ref={containerRef}
      className={`w-project-switcher ${className}`.trim()}
      style={{
        position: 'relative',
        display: 'inline-block',
        ...style,
      }}
      data-action={dataAction}
      data-testid={dataTestId}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${displayName}` : displayName}
        onClick={() => setOpen((prev) => !prev)}
        className="w-project-switcher__trigger"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--w-space-2)',
          minHeight: 'var(--w-control-height)',
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
        <span>{displayName}</span>
        {currentProject?.status && (
          <StatusPill
            status={currentProject.status}
            label={currentProject.statusLabel}
          />
        )}
        <IconChevron
          size={16}
          style={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--w-dur-fast) var(--w-ease)',
          }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="w-project-switcher__menu"
          style={{
            position: 'absolute',
            insetBlockStart: '100%',
            insetInlineStart: 0,
            marginTop: 'var(--w-space-1)',
            minWidth: 'var(--w-nav-width)',
            backgroundColor: 'var(--w-surface)',
            border: 'var(--w-border-width) solid var(--w-line)',
            borderRadius: 'var(--w-radius-md)',
            boxShadow: 'var(--w-shadow-2)',
            zIndex: 'var(--w-layer-dropdown)',
            padding: 'var(--w-space-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-2)',
          }}
        >
          {searchPlaceholder && (
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
                placeholder={searchPlaceholder}
                style={{
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  width: '100%',
                  fontFamily: 'var(--w-font-sans)',
                  fontSize: 'var(--w-font-size-sm)',
                  color: 'var(--w-text)',
                }}
              />
            </div>
          )}

          <div
            style={{
              maxHeight: 'var(--w-rail-width)',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--w-space-1)',
            }}
          >
            {filteredProjects.map((proj) => {
              const name = sanitizeProjectName(proj.name, fallbackName);
              const isSelected = currentProject?.id === proj.id;
              return (
                <button
                  key={proj.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSelectProject?.(proj.id);
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
                    backgroundColor: isSelected
                      ? 'var(--w-primary-soft)'
                      : 'transparent',
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
                  <span>{name}</span>
                  {proj.status && (
                    <StatusPill
                      status={proj.status}
                      label={proj.statusLabel}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {onNewProject && newProjectLabel && (
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
                onClick={() => {
                  onNewProject();
                  setOpen(false);
                }}
                style={{ width: '100%', justifyContent: 'flex-start' }}
                data-action="projects.create"
              >
                {newProjectLabel}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

ProjectSwitcher.displayName = 'ProjectSwitcher';
