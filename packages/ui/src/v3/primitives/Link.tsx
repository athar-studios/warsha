// packages/ui/src/v3/primitives/Link.tsx — Design System v3 Link (DS v3 §3.1)
// Variants: inline / standalone. external adds IconExternal + rel/target.

import React from 'react';

import { IconExternal } from '../icons';

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: 'inline' | 'standalone';
  external?: boolean;
  'data-action'?: string;
  'data-testid'?: string;
}

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  (
    {
      variant = 'inline',
      external = false,
      href,
      children,
      className = '',
      style,
      'data-action': dataAction,
      'data-testid': dataTestId,
      ...rest
    },
    ref
  ) => {
    const isExternal = external || (href && (href.startsWith('http://') || href.startsWith('https://')));

    return (
      <a
        ref={ref}
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        data-variant={variant}
        data-action={dataAction}
        data-testid={dataTestId}
        className={`w-link w-link--${variant} ${className}`.trim()}
        style={{
          color: 'var(--w-primary-text)',
          fontFamily: 'var(--w-font-sans)',
          textDecoration: variant === 'inline' ? 'underline' : 'none',
          textUnderlineOffset: 'var(--w-space-1)',
          display: variant === 'standalone' ? 'inline-flex' : 'inline',
          alignItems: 'center',
          gap: 'var(--w-space-1)',
          cursor: 'pointer',
          ...style,
        }}
        {...rest}
      >
        {children}
        {isExternal && (
          <span className="w-link__external-icon" aria-hidden="true" style={{ display: 'inline-flex' }}>
            <IconExternal size={14} />
          </span>
        )}
      </a>
    );
  }
);

Link.displayName = 'Link';
