// apps/desktop/src/v3/pages/bench/components/RunModeChip.tsx — D4 run-mode chip.
// A small read-out of how a run was started (agent / plan / spec-file / ask).
// Colour never carries the meaning alone — every chip renders its word; the
// word comes from the v3 bench catalog (ar + en), never hardcoded strings.

import type { RunSummary } from '@warsha/client';
import { useT } from '@warsha/i18n/v3';
import React from 'react';

export type RunModeWord = 'agent' | 'plan' | 'spec-file' | 'ask';

export interface RunModeChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The daemon's snake_case `run_mode` word; absent means `agent` (D4). */
  runMode?: string;
  'data-testid'?: string;
}

/** Fold a wire `run_mode` word to a known chip mode; unknown → `agent`. */
export function toRunModeChip(raw: string | undefined): RunModeWord {
  return raw === 'plan' || raw === 'spec-file' || raw === 'ask' ? raw : 'agent';
}

const CHIP_STYLE: Record<RunModeWord, React.CSSProperties> = {
  agent: {
    backgroundColor: 'var(--w-sunken)',
    color: 'var(--w-text-muted)',
  },
  plan: {
    backgroundColor: 'var(--w-info-soft)',
    color: 'var(--w-info)',
  },
  'spec-file': {
    backgroundColor: 'var(--w-primary-soft)',
    color: 'var(--w-primary-text)',
  },
  ask: {
    backgroundColor: 'var(--w-attention-soft)',
    color: 'var(--w-attention)',
  },
};

/**
 * The run's mode chip. Rendered beside the status pill in the bench header,
 * on every rail row, and (via the receipt read) on the receipt surface, so
 * a restarted run still says how it was started.
 */
export const RunModeChip: React.FC<RunModeChipProps> = ({
  runMode,
  'data-testid': dataTestId,
  ...rest
}) => {
  const t = useT();
  const mode = toRunModeChip(runMode);
  return (
    <span
      data-runmode={mode}
      data-testid={dataTestId ?? 'runmode-chip'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        paddingBlock: 'var(--w-space-1)',
        paddingInline: 'var(--w-space-2)',
        borderRadius: 'var(--w-radius-full)',
        fontSize: 'var(--w-font-size-xs)',
        lineHeight: 'var(--w-line-height-xs)',
        fontWeight: 'var(--w-font-weight-medium)',
        whiteSpace: 'nowrap',
        ...CHIP_STYLE[mode],
      }}
      {...rest}
    >
      {t(`bench.runmode.${mode}`)}
    </span>
  );
};

/** Type-guard helper for the picker: the modes a new run may take. */
export function runModeChoices(): RunModeWord[] {
  return ['agent', 'plan', 'spec-file'];
}

export function runModeFromSummary(run: RunSummary | null | undefined): RunModeWord | undefined {
  return run ? toRunModeChip(run.runMode) : undefined;
}
