// packages/ui/src/v3/primitives/Tabs.tsx — Design System v3 Tabs (DS v3 §3.1)
// Variants: line (Workbench), pill (filters). Roving tabindex, arrows, Home/End, aria-controls.

import React, { useRef } from 'react';

export interface TabItem {
  id: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange?: (tabId: string) => void;
  variant?: 'line' | 'pill';
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTab,
  onChange = () => {},
  variant = 'line',
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const tablistRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let targetIndex = index;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      targetIndex = (index + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      targetIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      targetIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      targetIndex = tabs.length - 1;
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!tabs[index].disabled) {
        onChange(tabs[index].id);
      }
      return;
    }

    if (targetIndex !== index) {
      const nextTab = tabs[targetIndex];
      if (!nextTab.disabled) {
        onChange(nextTab.id);
        const buttons = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        buttons?.[targetIndex]?.focus();
      }
    }
  };

  return (
    <div
      ref={tablistRef}
      role="tablist"
      data-variant={variant}
      className={`w-tabs w-tabs--${variant} ${className}`.trim()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: variant === 'pill' ? 'var(--w-space-2)' : 'var(--w-space-4)',
        borderBlockEnd: variant === 'line' ? 'var(--w-border-width) solid var(--w-line)' : 'none',
        fontFamily: 'var(--w-font-sans)',
        boxSizing: 'border-box',
        ...style,
      }}
      data-action={dataAction}
      data-testid={dataTestId}
    >
      {tabs.map((tab, idx) => {
        const isSelected = tab.id === activeTab;
        const isDisabled = tab.disabled;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isSelected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={isSelected ? 0 : -1}
            disabled={isDisabled}
            onClick={() => !isDisabled && onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`w-tab ${isSelected ? 'w-tab--selected' : ''}`.trim()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--w-space-2)',
              border: 'none',
              background: 'transparent',
              paddingBlock: 'var(--w-space-2)',
              paddingInline: variant === 'pill' ? 'var(--w-space-3)' : 'var(--w-space-1)',
              borderRadius: variant === 'pill' ? 'var(--w-radius-full)' : 0,
              fontSize: 'var(--w-font-size-md)',
              lineHeight: 'var(--w-line-height-md)',
              fontWeight: isSelected ? 'var(--w-font-weight-medium)' : 'var(--w-font-weight-regular)',
              color: isSelected
                ? 'var(--w-primary-text)'
                : 'var(--w-text-muted)',
              backgroundColor: variant === 'pill' && isSelected
                ? 'var(--w-primary-soft)'
                : 'transparent',
              borderBlockEnd: variant === 'line' && isSelected
                ? 'var(--w-border-width-strong) solid var(--w-primary-text)'
                : variant === 'line'
                ? 'var(--w-border-width-strong) solid transparent'
                : 'none',
              marginBlockEnd: variant === 'line' ? 'calc(-1 * var(--w-border-width))' : 0,
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              opacity: isDisabled ? 0.5 : 1,
              transition: 'color var(--w-dur-fast) var(--w-ease), border-color var(--w-dur-fast) var(--w-ease)',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

Tabs.displayName = 'Tabs';
