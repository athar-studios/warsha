// packages/ui/src/v3/composites/ListRow.tsx — Design System v3 ListRow (DS v3 §3.2)
// Content container list row. Clickable row = one interactive element, no nested buttons.

import React from 'react';

export interface ListRowProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  selected?: boolean;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const ListRow: React.FC<ListRowProps> = ({
  icon,
  title,
  subtitle,
  meta,
  actions,
  onClick,
  href,
  selected = false,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const isClickable = Boolean(onClick || href);
  const hasActions = Boolean(actions);

  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--w-space-3)',
    paddingBlock: 'var(--w-space-3)',
    paddingInline: 'var(--w-space-4)',
    minHeight: 'var(--w-control-height)',
    borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
    backgroundColor: selected ? 'var(--w-sunken)' : 'transparent',
    color: 'var(--w-text)',
    fontFamily: 'var(--w-font-sans)',
    fontSize: 'var(--w-font-size-sm)',
    boxSizing: 'border-box',
    textDecoration: 'none',
    width: '100%',
    textAlign: 'start',
    ...style,
  };

  const mainContent = (
    <>
      {icon && (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            color: 'var(--w-text-muted)',
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: selected
              ? 'var(--w-font-weight-semibold)'
              : 'var(--w-font-weight-medium)',
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: 'var(--w-font-size-xs)',
              color: 'var(--w-text-muted)',
              marginTop: 'var(--w-space-1)',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>

      {meta && (
        <div
          style={{
            color: 'var(--w-text-muted)',
            fontSize: 'var(--w-font-size-xs)',
            flexShrink: 0,
          }}
        >
          {meta}
        </div>
      )}
    </>
  );

  // If there are actions, do not wrap entire row in button/a to avoid nested buttons
  if (hasActions) {
    return (
      <div
        data-selected={selected ? 'true' : undefined}
        data-action={dataAction}
        data-testid={dataTestId}
        className={`w-list-row ${className}`.trim()}
        style={baseStyle}
      >
        {isClickable ? (
          href ? (
            <a
              href={href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--w-space-3)',
                flex: 1,
                minWidth: 0,
                color: 'inherit',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              {mainContent}
            </a>
          ) : (
            <button
              type="button"
              onClick={onClick}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--w-space-3)',
                flex: 1,
                minWidth: 0,
                color: 'inherit',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'start',
                font: 'inherit',
              }}
            >
              {mainContent}
            </button>
          )
        ) : (
          mainContent
        )}

        <div style={{ flexShrink: 0 }}>{actions}</div>
      </div>
    );
  }

  if (href) {
    return (
      <a
        href={href}
        data-selected={selected ? 'true' : undefined}
        data-action={dataAction}
        data-testid={dataTestId}
        className={`w-list-row ${className}`.trim()}
        style={{
          ...baseStyle,
          cursor: 'pointer',
        }}
      >
        {mainContent}
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-selected={selected ? 'true' : undefined}
        data-action={dataAction}
        data-testid={dataTestId}
        className={`w-list-row ${className}`.trim()}
        style={{
          ...baseStyle,
          cursor: 'pointer',
          background: selected ? 'var(--w-sunken)' : 'transparent',
          border: 'none',
          borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
        }}
      >
        {mainContent}
      </button>
    );
  }

  return (
    <div
      data-selected={selected ? 'true' : undefined}
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-list-row ${className}`.trim()}
      style={baseStyle}
    >
      {mainContent}
    </div>
  );
};

ListRow.displayName = 'ListRow';
