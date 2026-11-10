// packages/ui/src/v3/composites/Card.tsx — Design System v3 Card (DS v3 §3.2)
// Content container. Clickable card = one <a>/button, no nested buttons.

import React from 'react';

export type CardVariant = 'default' | 'sunken';

export interface CardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerEnd?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: CardVariant;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

const VARIANT_STYLES: Record<CardVariant, React.CSSProperties> = {
  default: {
    backgroundColor: 'var(--w-surface)',
    borderColor: 'var(--w-line)',
  },
  sunken: {
    backgroundColor: 'var(--w-sunken)',
    borderColor: 'var(--w-line)',
  },
};

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  headerEnd,
  footer,
  children,
  onClick,
  href,
  variant = 'default',
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const isClickable = Boolean(onClick || href);

  const baseStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 'var(--w-radius-md)',
    border: 'var(--w-border-width) solid',
    padding: 'var(--w-space-4)',
    color: 'var(--w-text)',
    fontFamily: 'var(--w-font-sans)',
    textDecoration: 'none',
    boxSizing: 'border-box',
    cursor: isClickable ? 'pointer' : 'default',
    transition: isClickable
      ? 'border-color var(--w-dur-fast) var(--w-ease), box-shadow var(--w-dur-fast) var(--w-ease)'
      : undefined,
    ...VARIANT_STYLES[variant],
    ...style,
  };

  const header = (title || subtitle || headerEnd) && (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--w-space-3)',
        marginBottom: children || footer ? 'var(--w-space-3)' : 0,
      }}
    >
      <div>
        {title && (
          <div
            style={{
              fontSize: 'var(--w-font-size-md)',
              lineHeight: 'var(--w-line-height-md)',
              fontWeight: 'var(--w-font-weight-semibold)',
            }}
          >
            {title}
          </div>
        )}
        {subtitle && (
          <div
            style={{
              fontSize: 'var(--w-font-size-xs)',
              lineHeight: 'var(--w-line-height-xs)',
              color: 'var(--w-text-muted)',
              marginTop: 'var(--w-space-1)',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {headerEnd && <div>{headerEnd}</div>}
    </div>
  );

  const body = children && <div style={{ flex: 1 }}>{children}</div>;

  const footerEl = footer && (
    <div
      style={{
        marginTop: 'var(--w-space-3)',
        paddingBlockStart: 'var(--w-space-3)',
        borderBlockStart: 'var(--w-border-width) solid var(--w-line)',
      }}
    >
      {footer}
    </div>
  );

  if (href) {
    return (
      <a
        href={href}
        data-variant={variant}
        data-action={dataAction}
        data-testid={dataTestId}
        className={`w-card w-card--${variant} ${className}`.trim()}
        style={baseStyle}
      >
        {header}
        {body}
        {footerEl}
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-variant={variant}
        data-action={dataAction}
        data-testid={dataTestId}
        className={`w-card w-card--${variant} ${className}`.trim()}
        style={{
          ...baseStyle,
          textAlign: 'start',
          background: undefined,
          ...VARIANT_STYLES[variant],
        }}
      >
        {header}
        {body}
        {footerEl}
      </button>
    );
  }

  return (
    <div
      data-variant={variant}
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-card w-card--${variant} ${className}`.trim()}
      style={baseStyle}
    >
      {header}
      {body}
      {footerEl}
    </div>
  );
};

Card.displayName = 'Card';
