// @warsha/ui — Tabs: the settings strip and the run view's panes.
//
// §4 gives the six settings screens one horizontally scrollable `role="tablist"`, and §9 says a tablist
// uses a roving tabindex: exactly one tab is in the Tab order — the selected one — and the arrows move
// between the rest. That is what this component is for; a strip of six tabs the owner must Tab through
// six times to reach is a strip that fails the keyboard path.
//
// Focus and selection are separate here, which is WAI-ARIA's *manual* activation: the arrows move focus
// among the tabs, and Enter or Space (a button's own keys) selects the one that has it. Automatic
// activation would be kinder to a mouse-less owner on a cheap panel and crueller on a panel that fetches a
// run's artifacts, and the settings strip and the run view both fall in the second group — so the bench
// keeps the explicit step. `Tabs.Tab` takes the `controls` id of its panel so the pair is stated in the
// markup; the panel itself belongs to the screen, and `tabPanelProps` hands it the attributes it needs.

import React from 'react';

import { aliasVar, colorVar, fontSize, fontWeight, size, space } from '../tokens';

import {
  arrowStep,
  CONTROL_CLASS,
  cx,
  directionOf,
  moveGroupFocus,
  QUIET_EDGE,
  SIGNAL_EDGE,
} from './internal';

export interface TabsProps {
  children: React.ReactNode;
  /** The tablist's accessible name: "شاشات الإعدادات" / "settings screens". */
  label: string;
  className?: string;
  style?: React.CSSProperties;
}

export interface TabProps {
  children: React.ReactNode;
  /** This tab is the bench's current view. */
  selected?: boolean;
  onSelect: () => void;
  /** The id of the panel this tab shows — `aria-controls`, and the tab's own DOM id derives from it. */
  panelId: string;
  disabled?: boolean;
  /** A count badge that belongs to the tab: pending gates, failing checks. */
  badge?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

function TabRoot({ children, selected = false, onSelect, panelId, disabled, badge, className = '', style }: TabProps) {
  // A tab is the label of a panel; both ids derive from the panel's, so the pair never drifts.
  const tabId = `${panelId}-tab`;

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const rtl = directionOf(event.currentTarget) === 'rtl';
    const step = arrowStep(event, rtl);
    if (!step) return;
    event.preventDefault();
    // Manual activation: the arrow moves focus, Enter/Space (this button's own keys) selects.
    moveGroupFocus(event.currentTarget.parentElement, step, event.currentTarget);
  };

  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      aria-selected={selected}
      aria-controls={panelId}
      // Roving tabindex: one tab per group is in the Tab order (§9).
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cx('warsha-tab', CONTROL_CLASS, className)}
      data-selected={selected}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: space(2),
        flex: 'none',
        border: 'none',
        // The selected tab's underline is the signal edge on its block-end side; the unselected tab keeps
        // the same width in `transparent`, so selecting never nudges the label.
        borderBlockEnd: selected ? SIGNAL_EDGE : QUIET_EDGE,
        backgroundColor: 'transparent',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: fontSize('sm'),
        paddingInline: space(3),
        minBlockSize: size('touch'),
        color: colorVar('text'),
        fontWeight: selected ? fontWeight('bold') : fontWeight('medium'),
        ...style,
      }}
    >
      <span style={{ minInlineSize: 0 }}>{children}</span>
      {badge}
    </button>
  );
}

function TabsRoot({ children, label, className = '', style }: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx('warsha-tabs', className)}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: space(1),
        // The tab strip is the one rail allowed to slide sideways: horizontal scroll inside the component,
        // never the page (§10's overflow gate, §4's six-screen settings strip).
        overflowX: 'auto',
        scrollbarWidth: 'thin',
        paddingInline: space(3),
        borderBlockEnd: `${size('rule')} solid ${aliasVar('benchRule')}`,
        minInlineSize: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The tablist and its tabs: `Tabs.Tab` is only reachable inside a `Tabs`. */
export const Tabs = Object.assign(TabsRoot, { Tab: TabRoot });

/** What the panel a tab shows should carry. Spread it on the panel element. */
export function tabPanelProps(panelId: string): {
  id: string;
  role: 'tabpanel';
  'aria-labelledby': string;
  tabIndex: 0;
} {
  return { id: panelId, role: 'tabpanel', 'aria-labelledby': `${panelId}-tab`, tabIndex: 0 };
}
