// packages/ui/src/v3/composites/Stepper.tsx — Design System v3 Stepper (DS v3 §3.2)
// Stages: { key, label, state: 'done'|'current'|'waiting'|'failed'|'todo' }[], size: 'simple'|'detailed'.
// Colours: current = primary-text, waiting = attention, done = success, failed = danger, todo = sunken.

import React from 'react';

import { IconAlert, IconCheck, IconClock, IconX } from '../icons';

export type StepperStageState = 'done' | 'current' | 'waiting' | 'failed' | 'todo';

export interface StepperStage {
  key: string;
  label: string;
  state: StepperStageState;
}

export interface StepperProps {
  stages: StepperStage[];
  size?: 'simple' | 'detailed';
  onStageClick?: (stageKey: string) => void;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

const STATE_CONFIG: Record<
  StepperStageState,
  {
    barColor: string;
    textColor: string;
    icon: React.ReactNode;
    badgeBg: string;
  }
> = {
  done: {
    barColor: 'var(--w-success)',
    textColor: 'var(--w-text)',
    icon: <IconCheck size={14} />,
    badgeBg: 'var(--w-success-soft)',
  },
  current: {
    barColor: 'var(--w-primary-text)',
    textColor: 'var(--w-primary-text)',
    icon: <IconClock size={14} />,
    badgeBg: 'var(--w-primary-soft)',
  },
  waiting: {
    barColor: 'var(--w-attention)',
    textColor: 'var(--w-attention)',
    icon: <IconAlert size={14} />,
    badgeBg: 'var(--w-attention-soft)',
  },
  failed: {
    barColor: 'var(--w-danger)',
    textColor: 'var(--w-danger)',
    icon: <IconX size={14} />,
    badgeBg: 'var(--w-danger-soft)',
  },
  todo: {
    barColor: 'var(--w-sunken)',
    textColor: 'var(--w-text-muted)',
    icon: null,
    badgeBg: 'var(--w-sunken)',
  },
};

export const Stepper: React.FC<StepperProps> = ({
  stages,
  size = 'simple',
  onStageClick,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const isSimple = size === 'simple';

  return (
    <ol
      role="list"
      data-size={size}
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-stepper w-stepper--${size} ${className}`.trim()}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${stages.length}, 1fr)`,
        gap: isSimple ? 'var(--w-space-2)' : 'var(--w-space-1)',
        listStyle: 'none',
        margin: 0,
        padding: 0,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {stages.map((stage) => {
        const config = STATE_CONFIG[stage.state];
        const isClickable = Boolean(onStageClick);

        return (
          <li
            key={stage.key}
            data-stage-key={stage.key}
            data-state={stage.state}
            onClick={isClickable ? () => onStageClick(stage.key) : undefined}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--w-space-2)',
              cursor: isClickable ? 'pointer' : 'default',
              userSelect: 'none',
            }}
          >
            <span
              className="w-stepper__bar"
              aria-hidden="true"
              style={{
                height: 'var(--w-space-1)',
                borderRadius: 'var(--w-radius-full)',
                backgroundColor: config.barColor,
                transition: 'background-color var(--w-dur) var(--w-ease)',
              }}
            />

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--w-space-1)',
                fontSize: isSimple ? 'var(--w-font-size-sm)' : 'var(--w-font-size-xs)',
                lineHeight: isSimple ? 'var(--w-line-height-sm)' : 'var(--w-line-height-xs)',
                fontWeight:
                  stage.state === 'current'
                    ? 'var(--w-font-weight-semibold)'
                    : 'var(--w-font-weight-medium)',
                color: config.textColor,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {config.icon && (
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  {config.icon}
                </span>
              )}
              <span>{stage.label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
};

Stepper.displayName = 'Stepper';
