// eslint-disable-next-line import/no-unresolved
import { useDirection, useT } from '@warsha/i18n/v3';
import React, { useRef } from 'react';

import { BENCH_TABS, type BenchTabId } from '../types';

export interface BenchTabsProps {
  activeTab: BenchTabId;
  onChange: (tabId: BenchTabId) => void;
}

export const BenchTabs: React.FC<BenchTabsProps> = ({ activeTab, onChange }) => {
  const t = useT();
  const dir = useDirection();
  const tablistRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let targetIndex = index;
    const isRtl = dir === 'rtl';

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      targetIndex = isRtl
        ? (index - 1 + BENCH_TABS.length) % BENCH_TABS.length
        : (index + 1) % BENCH_TABS.length;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      targetIndex = isRtl
        ? (index + 1) % BENCH_TABS.length
        : (index - 1 + BENCH_TABS.length) % BENCH_TABS.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      targetIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      targetIndex = BENCH_TABS.length - 1;
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(BENCH_TABS[index]);
      return;
    }

    if (targetIndex !== index) {
      const nextTab = BENCH_TABS[targetIndex];
      onChange(nextTab);
      const buttons = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      buttons?.[targetIndex]?.focus();
    }
  };

  return (
    <div
      ref={tablistRef}
      role="tablist"
      aria-label={t('bench.tab.overview')}
      data-testid="bench-tabs"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--w-space-2)',
        borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        marginBlock: 'var(--w-space-2)',
      }}
    >
      {BENCH_TABS.map((tabId, idx) => {
        const isSelected = tabId === activeTab;
        return (
          <button
            key={tabId}
            type="button"
            role="tab"
            id={`bench-tab-${tabId}`}
            aria-selected={isSelected}
            aria-controls={isSelected ? `bench-panel-${tabId}` : undefined}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(tabId)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            data-action="bench.tab.select"
            data-tab-id={tabId}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              border: 'none',
              background: 'transparent',
              paddingBlock: 'var(--w-space-2)',
              paddingInline: 'var(--w-space-3)',
              minHeight: 'var(--w-control-height)',
              fontSize: 'var(--w-font-size-sm)',
              lineHeight: 'var(--w-line-height-sm)',
              fontWeight: isSelected
                ? 'var(--w-font-weight-semibold)'
                : 'var(--w-font-weight-regular)',
              color: isSelected ? 'var(--w-text)' : 'var(--w-text-muted)',
              borderBlockEnd: isSelected
                ? 'var(--w-border-width-strong) solid var(--w-primary-text)'
                : 'var(--w-border-width-strong) solid transparent',
              cursor: 'pointer',
              fontFamily: 'var(--w-font-sans)',
              boxSizing: 'border-box',
              transition: 'color var(--w-dur-fast) var(--w-ease), border-color var(--w-dur-fast) var(--w-ease)',
            }}
          >
            {t(`bench.tab.${tabId}`)}
          </button>
        );
      })}
    </div>
  );
};

BenchTabs.displayName = 'BenchTabs';
