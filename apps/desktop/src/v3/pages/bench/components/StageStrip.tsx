// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import React from 'react';

import type { DaemonStage } from '../../../copy/stages';
import { ALL_DAEMON_STAGES } from '../types';

export interface StageStripProps {
  currentStage: DaemonStage | string;
  isWaitingGate?: boolean;
  isFailed?: boolean;
}

export const StageStrip: React.FC<StageStripProps> = ({
  currentStage,
  isWaitingGate = false,
  isFailed = false,
}) => {
  const t = useT();

  const currentIndex = ALL_DAEMON_STAGES.indexOf(currentStage as DaemonStage);

  return (
    <ol
      aria-label={t('bench.tab.overview')}
      data-testid="bench-stage-strip"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--w-space-1)',
        listStyle: 'none',
        margin: 0,
        padding: 0,
        paddingBlock: 'var(--w-space-2)',
        boxSizing: 'border-box',
      }}
    >
      {ALL_DAEMON_STAGES.map((stage, idx) => {
        let bg = 'var(--w-sunken)';
        let color = 'var(--w-text-muted)';
        let fontWeight = 'var(--w-font-weight-regular)';

        if (idx < currentIndex) {
          bg = 'var(--w-success-soft)';
          color = 'var(--w-success)';
        } else if (idx === currentIndex) {
          if (isFailed) {
            bg = 'var(--w-danger-soft)';
            color = 'var(--w-danger)';
          } else if (isWaitingGate) {
            bg = 'var(--w-attention-soft)';
            color = 'var(--w-attention)';
          } else {
            bg = 'var(--w-primary-soft)';
            color = 'var(--w-primary-text)';
          }
          fontWeight = 'var(--w-font-weight-semibold)';
        }

        return (
          <li
            key={stage}
            data-stage={stage}
            data-current={idx === currentIndex ? 'true' : undefined}
            style={{
              paddingBlock: 'var(--w-space-1)',
              paddingInline: 'var(--w-space-2)',
              borderRadius: 'var(--w-radius-sm)',
              backgroundColor: bg,
              color,
              fontWeight,
              fontSize: 'var(--w-font-size-xs)',
              lineHeight: 'var(--w-line-height-xs)',
              whiteSpace: 'nowrap',
            }}
          >
            {t(`bench.stage.${stage}`)}
          </li>
        );
      })}
    </ol>
  );
};

StageStrip.displayName = 'StageStrip';
