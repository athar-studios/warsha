// packages/ui/src/v3/composites/SettingsSection.tsx — Design System v3 SettingsSection (DS v3 §3.2)
// Title, description, scope sentence, content. One per settings page section.

import React from 'react';

export interface SettingsSectionProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  scope?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  description,
  scope,
  action,
  children,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  return (
    <section
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-settings-section ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-3)',
        marginBottom: 'var(--w-space-6)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--w-space-3)',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--w-space-2)',
              flexWrap: 'wrap',
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 'var(--w-font-size-md)',
                lineHeight: 'var(--w-line-height-md)',
                fontWeight: 'var(--w-font-weight-semibold)',
                color: 'var(--w-text)',
              }}
            >
              {title}
            </h3>
            {scope && (
              <span
                style={{
                  fontSize: 'var(--w-font-size-xs)',
                  color: 'var(--w-text-faint)',
                  backgroundColor: 'var(--w-sunken)',
                  paddingBlock: 'var(--w-space-1)',
                  paddingInline: 'var(--w-space-2)',
                  borderRadius: 'var(--w-radius-full)',
                }}
              >
                {scope}
              </span>
            )}
          </div>

          {description && (
            <div
              style={{
                fontSize: 'var(--w-font-size-sm)',
                lineHeight: 'var(--w-line-height-sm)',
                color: 'var(--w-text-muted)',
                marginTop: 'var(--w-space-1)',
              }}
            >
              {description}
            </div>
          )}
        </div>

        {action && <div>{action}</div>}
      </div>

      <div
        style={{
          backgroundColor: 'var(--w-surface)',
          border: 'var(--w-border-width) solid var(--w-line)',
          borderRadius: 'var(--w-radius-md)',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </section>
  );
};

SettingsSection.displayName = 'SettingsSection';
