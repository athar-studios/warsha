// packages/ui/src/v3/composites/TopBar.tsx — Design System v3 TopBar (DS v3 §3.2)
// Logo/brand, project switcher, mode switch, inbox, settings. Inbox shows count badge in attention.

import React from 'react';

import { IconInbox, IconSettings } from '../icons';
import { Badge } from '../primitives/Badge';
import { IconButton } from '../primitives/IconButton';

export interface TopBarProps {
  brand?: React.ReactNode;
  projectSwitcher?: React.ReactNode;
  modeSwitch?: React.ReactNode;
  inbox?: React.ReactNode;
  inboxCount?: number;
  inboxLabel?: string;
  onInboxClick?: () => void;
  settings?: React.ReactNode;
  settingsLabel?: string;
  onSettingsClick?: () => void;
  actions?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const TopBar: React.FC<TopBarProps> = ({
  brand,
  projectSwitcher,
  modeSwitch,
  inbox,
  inboxCount,
  inboxLabel,
  onInboxClick,
  settings,
  settingsLabel,
  onSettingsClick,
  actions,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  return (
    <div
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-topbar ${className}`.trim()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--w-space-3)',
        minHeight: 'var(--w-space-10)',
        paddingInline: 'var(--w-space-5)',
        backgroundColor: 'var(--w-surface)',
        borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {brand && <div className="w-topbar__brand">{brand}</div>}
      {projectSwitcher && <div className="w-topbar__project">{projectSwitcher}</div>}

      <div style={{ flex: 1 }} />

      <div
        className="w-topbar__end"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--w-space-2)',
        }}
      >
        {modeSwitch && <div className="w-topbar__mode">{modeSwitch}</div>}

        {inbox ? (
          inbox
        ) : onInboxClick && inboxLabel ? (
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <IconButton
              icon={<IconInbox />}
              label={inboxLabel}
              onClick={onInboxClick}
              data-action="frame.inbox"
            />
            {typeof inboxCount === 'number' && inboxCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  insetBlockStart: 0,
                  insetInlineEnd: 0,
                  transform: 'translate(25%, -25%)',
                  pointerEvents: 'none',
                }}
              >
                <Badge count={inboxCount} variant="attention" />
              </span>
            )}
          </div>
        ) : null}

        {settings ? (
          settings
        ) : onSettingsClick && settingsLabel ? (
          <IconButton
            icon={<IconSettings />}
            label={settingsLabel}
            onClick={onSettingsClick}
            data-action="frame.settings"
          />
        ) : null}

        {actions && <div className="w-topbar__actions">{actions}</div>}
      </div>
    </div>
  );
};

TopBar.displayName = 'TopBar';
