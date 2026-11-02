// @warsha/ui — ModeSwitch: Simple ●──○ Advanced, the disclosure ladder's gate.
//
// §4 puts this in the topbar, and §3 is why it is a component rather than two buttons a screen styles by
// hand: switching mode must not change the pipeline, the gates or the data model, and it must not lose the
// screen, the tab, the filter or the scroll position. What the switch itself owns is narrow — which of the
// two rungs is pressed, and the callback that says so — and what it refuses to own is the words, which come
// from the screen's catalog.
//
// The semantics are a `role="group"` of two toggle buttons (`aria-pressed`), not a tablist: this does not
// switch panels inside one view, it switches the depth of the whole bench. The pressed rung lifts to
// `surface` with a shadow and takes `semibold`, so the state reads in depth and weight and not only in tint
// (§9), and the arrows move focus across the pair with the direction resolved from the DOM.

import React, { useCallback } from 'react';

import { aliasVar, colorVar, fontSize, radius, shadow, size, space } from '../tokens';

import {
  arrowStep,
  CONTROL_CLASS,
  cx,
  directionOf,
  EDGE_BORDER,
  moveGroupFocus,
  QUIET_LABEL,
  SELECTED_LABEL,
} from './internal';

/** The two modes the product ships. Switching them preserves everything else (§3). */
export type WorkbenchMode = 'simple' | 'advanced';

/** A rung of the ladder: pressed, or quietly waiting to be. */
function Rung({
  pressed,
  onPress,
  children,
  disabled = false,
}: {
  pressed: boolean;
  onPress: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onPress}
      className={cx(CONTROL_CLASS, 'warsha-mode-rung')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: space(1),
        border: 'none',
        borderRadius: radius('full'),
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: fontSize('sm'),
        paddingInline: space(4),
        paddingBlock: space(2),
        minBlockSize: size('touch'),
        backgroundColor: pressed ? colorVar('surface') : 'transparent',
        boxShadow: pressed ? shadow('sm') : 'none',
        ...(pressed ? SELECTED_LABEL : QUIET_LABEL),
      }}
    >
      {children}
    </button>
  );
}

export interface ModeSwitchProps {
  mode: WorkbenchMode;
  onModeChange: (mode: WorkbenchMode) => void;
  /** The Simple rung's label — `t('app.simpleMode')`. */
  simpleLabel: React.ReactNode;
  /** The Advanced rung's label — `t('app.advancedMode')`. */
  advancedLabel: React.ReactNode;
  /** The group's accessible name: "نمط الواجهة" / "interface mode". */
  label: string;
  /** A run in flight may forbid the switch; both rungs say so together. */
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function ModeSwitch({
  mode,
  onModeChange,
  simpleLabel,
  advancedLabel,
  label,
  disabled = false,
  className = '',
  style,
}: ModeSwitchProps) {
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = arrowStep(event, directionOf(event.currentTarget) === 'rtl');
    if (!step) return;
    event.preventDefault();
    moveGroupFocus(event.currentTarget, step, event.currentTarget.ownerDocument.activeElement);
  }, []);

  return (
    <div
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx('warsha-mode-switch', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: space(2),
        padding: space(0.5),
        backgroundColor: aliasVar('benchPlate'),
        border: EDGE_BORDER,
        // A pill: the direction draws the switch as one object with two rungs, not two boxes (§4).
        borderRadius: radius('full'),
        ...style,
      }}
    >
      <Rung pressed={mode === 'simple'} disabled={disabled} onPress={() => onModeChange('simple')}>
        {simpleLabel}
      </Rung>
      <Rung pressed={mode === 'advanced'} disabled={disabled} onPress={() => onModeChange('advanced')}>
        {advancedLabel}
      </Rung>
    </div>
  );
}
