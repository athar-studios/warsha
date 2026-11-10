// packages/ui/src/v3/composites/SideNav.tsx — Design System v3 SideNav (DS v3 §3.2)
// Sections with icons, active state. Active item carries aria-current="page".

import React from 'react';

export interface SideNavItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  href?: string;
  active?: boolean;
  badge?: React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  'data-action'?: string;
  'data-testid'?: string;
}

export interface SideNavGroup {
  id: string;
  title?: string;
  items: SideNavItem[];
}

export interface SideNavProps {
  items?: SideNavItem[];
  groups?: SideNavGroup[];
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const SideNav: React.FC<SideNavProps> = ({
  items,
  groups,
  ariaLabel,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const renderedGroups: SideNavGroup[] = groups ?? (items ? [{ id: 'default', items }] : []);

  return (
    <nav
      aria-label={ariaLabel}
      className={`w-side-nav ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-4)',
        paddingBlock: 'var(--w-space-4)',
        paddingInline: 'var(--w-space-3)',
        ...style,
      }}
      data-action={dataAction}
      data-testid={dataTestId}
    >
      {renderedGroups.map((group) => (
        <div
          key={group.id}
          className="w-side-nav__group"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-1)',
          }}
        >
          {group.title && (
            <div
              className="w-side-nav__group-title"
              style={{
                fontSize: 'var(--w-font-size-xs)',
                fontWeight: 'var(--w-font-weight-semibold)',
                color: 'var(--w-text-muted)',
                paddingBlock: 'var(--w-space-1)',
                paddingInline: 'var(--w-space-3)',
                textTransform: 'uppercase',
              }}
            >
              {group.title}
            </div>
          )}

          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--w-space-1)',
            }}
          >
            {group.items.map((item) => {
              const content = (
                <>
                  {item.icon && (
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 'var(--w-space-5)',
                        height: 'var(--w-space-5)',
                      }}
                    >
                      {item.icon}
                    </span>
                  )}
                  <span style={{ flex: 1, textAlign: 'start' }}>{item.label}</span>
                  {item.badge && <span>{item.badge}</span>}
                </>
              );

              const itemStyle: React.CSSProperties = {
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--w-space-3)',
                paddingBlock: 'var(--w-space-2)',
                paddingInline: 'var(--w-space-3)',
                minHeight: 'var(--w-control-height)',
                borderRadius: 'var(--w-radius-sm)',
                backgroundColor: item.active
                  ? 'var(--w-primary-soft)'
                  : 'transparent',
                color: item.active
                  ? 'var(--w-primary-text)'
                  : 'var(--w-text)',
                fontWeight: item.active
                  ? 'var(--w-font-weight-semibold)'
                  : 'var(--w-font-weight-medium)',
                fontFamily: 'var(--w-font-sans)',
                fontSize: 'var(--w-font-size-sm)',
                textDecoration: 'none',
                cursor: 'pointer',
                border: 'none',
                width: '100%',
                boxSizing: 'border-box',
                transition: 'background-color var(--w-dur-fast) var(--w-ease)',
              };

              return (
                <li key={item.id}>
                  {item.href ? (
                    <a
                      href={item.href}
                      aria-current={item.active ? 'page' : undefined}
                      onClick={item.onClick}
                      data-action={item['data-action']}
                      data-testid={item['data-testid']}
                      style={itemStyle}
                    >
                      {content}
                    </a>
                  ) : (
                    <button
                      type="button"
                      aria-current={item.active ? 'page' : undefined}
                      onClick={item.onClick}
                      data-action={item['data-action']}
                      data-testid={item['data-testid']}
                      style={itemStyle}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
};

SideNav.displayName = 'SideNav';
