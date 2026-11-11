// packages/ui/src/v3/composites/Menu.tsx — Design System v3 Menu (DS v3 §3.2)
// Overflow actions. role="menu", role="menuitem", arrows navigation, typeahead, Escape to close.

import React from 'react';

export interface MenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  'data-action'?: string;
  'data-testid'?: string;
}

export interface MenuProps {
  trigger: React.ReactNode;
  items: MenuItem[];
  ariaLabel?: string;
  align?: 'start' | 'end';
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const Menu: React.FC<MenuProps> = ({
  trigger,
  items,
  ariaLabel,
  align = 'end',
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const [open, setOpen] = React.useState(false);
  const [focusedIndex, setFocusedIndex] = React.useState(-1);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const itemsRef = React.useRef<(HTMLButtonElement | null)[]>([]);
  const typeaheadTimeout = React.useRef<NodeJS.Timeout | null>(null);
  const typeaheadBuffer = React.useRef<string>('');

  const enabledItems = items.map((item, idx) => ({ item, idx })).filter(({ item }) => !item.disabled);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  React.useEffect(() => {
    if (open && focusedIndex >= 0 && itemsRef.current[focusedIndex]) {
      itemsRef.current[focusedIndex]?.focus();
    }
  }, [open, focusedIndex]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setOpen(true);
        if (enabledItems.length > 0) {
          setFocusedIndex(enabledItems[0].idx);
        }
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      const triggerButton = triggerRef.current?.querySelector<HTMLElement>('button');
      triggerButton?.focus();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const currentPos = enabledItems.findIndex(({ idx }) => idx === focusedIndex);
      const nextPos = (currentPos + 1) % enabledItems.length;
      setFocusedIndex(enabledItems[nextPos].idx);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const currentPos = enabledItems.findIndex(({ idx }) => idx === focusedIndex);
      const prevPos = (currentPos - 1 + enabledItems.length) % enabledItems.length;
      setFocusedIndex(enabledItems[prevPos].idx);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      if (enabledItems.length > 0) {
        setFocusedIndex(enabledItems[0].idx);
      }
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      if (enabledItems.length > 0) {
        setFocusedIndex(enabledItems[enabledItems.length - 1].idx);
      }
      return;
    }

    // Typeahead support
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (typeaheadTimeout.current) {
        clearTimeout(typeaheadTimeout.current);
      }
      typeaheadBuffer.current += event.key.toLowerCase();
      typeaheadTimeout.current = setTimeout(() => {
        typeaheadBuffer.current = '';
      }, 500);

      const match = enabledItems.find(({ item }) =>
        item.label.toLowerCase().startsWith(typeaheadBuffer.current)
      );
      if (match) {
        setFocusedIndex(match.idx);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className={`w-menu ${className}`.trim()}
      style={{
        position: 'relative',
        display: 'inline-block',
        ...style,
      }}
      data-action={dataAction}
      data-testid={dataTestId}
    >
      <div
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (next && enabledItems.length > 0) {
              setFocusedIndex(enabledItems[0].idx);
            }
            return next;
          });
        }}
      >
        {trigger}
      </div>

      {open && (
        <div
          role="menu"
          aria-label={ariaLabel}
          className="w-menu__dropdown"
          style={{
            position: 'absolute',
            insetBlockStart: '100%',
            insetInlineStart: align === 'start' ? 0 : undefined,
            insetInlineEnd: align === 'end' ? 0 : undefined,
            marginTop: 'var(--w-space-1)',
            minWidth: 'var(--w-rail-width)',
            backgroundColor: 'var(--w-surface)',
            border: 'var(--w-border-width) solid var(--w-line)',
            borderRadius: 'var(--w-radius-md)',
            boxShadow: 'var(--w-shadow-2)',
            zIndex: 'var(--w-layer-dropdown)',
            padding: 'var(--w-space-1)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-1)',
            boxSizing: 'border-box',
          }}
        >
          {items.map((item, index) => {
            const isDestructive = item.destructive;

            return (
              <button
                key={item.id}
                ref={(el) => {
                  itemsRef.current[index] = el;
                }}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                tabIndex={focusedIndex === index ? 0 : -1}
                data-action={item['data-action']}
                data-testid={item['data-testid']}
                onClick={() => {
                  if (!item.disabled) {
                    item.onClick?.();
                    setOpen(false);
                    const triggerButton = triggerRef.current?.querySelector<HTMLElement>('button');
                    triggerButton?.focus();
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--w-space-2)',
                  paddingBlock: 'var(--w-space-2)',
                  paddingInline: 'var(--w-space-3)',
                  minHeight: 'var(--w-control-height)',
                  borderRadius: 'var(--w-radius-sm)',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: isDestructive ? 'var(--w-danger)' : 'var(--w-text)',
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  opacity: item.disabled ? 0.5 : 1,
                  fontFamily: 'var(--w-font-sans)',
                  fontSize: 'var(--w-font-size-sm)',
                  textAlign: 'start',
                  width: '100%',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'background-color var(--w-dur-fast) var(--w-ease)',
                }}
              >
                {item.icon && (
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      color: isDestructive ? 'var(--w-danger)' : 'var(--w-text-muted)',
                    }}
                  >
                    {item.icon}
                  </span>
                )}
                <span style={{ flex: 1 }}>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

Menu.displayName = 'Menu';
