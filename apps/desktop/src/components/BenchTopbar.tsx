// @warsha/desktop — the top bar: the bench's one identity row (REDESIGN §4).
//
// §4 gives this row five things and nothing else: the brand mark and name, the contextual project/run id
// in mono, the mode switch, the gate bell with its lit count, and settings. The old bar carried the ship
// strip, the permission chip, the Plan/Agent badge, the mode toggle, the theme switch and settings in one
// wrapping row — six groups of chrome competing for one line, which is why the row measured 1124px in a
// 390px window. Those controls did not disappear: the work-protection and ship readings belong to the
// surface that owns them (the Advanced bench), and the theme belongs to Settings, where the owner chooses
// it (§5).
//
// The bar is sticky, 56px, and wraps below 768px where the contextual id is dropped (`index.css`), so the
// bench never scrolls sideways to fit a brand mark (§10's overflow gate).
import { type ProjectSummary, type RunSummary, type GateSummary } from '@warsha/client';
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Button, ModeSwitch, type WorkbenchMode } from '@warsha/ui';
import React from 'react';

import { BrandMark } from './BrandMark';
import { GateBell } from './GateBell';

export interface BenchTopbarProps {
  /** The project the bench is showing, or `null` when none is selected. */
  project: ProjectSummary | null;
  /** The run the bench is showing, or `null` when none is selected. */
  run: RunSummary | null;
  /** The owner's mode (§3): Simple is primary, Advanced discloses deeper. */
  mode: WorkbenchMode;
  /** Ask the shell to change mode; the shell keeps project, tab and filter (§3). */
  onModeChange: (mode: WorkbenchMode) => void;
  /** The selected run's gates, for the bell's queue. */
  gates: GateSummary[] | null;
  /** A gate read is in flight. */
  gatesLoading: boolean;
  /** The last gate read failed. */
  gatesFailed: boolean;
  /** Open the gates inbox. */
  onOpenGates: () => void;
  /** Read the gates again. */
  onRetryGates: () => void;
  /** Open the settings tab strip. */
  onOpenSettings: () => void;
}

export function BenchTopbar({
  project,
  run,
  mode,
  onModeChange,
  gates,
  gatesLoading,
  gatesFailed,
  onOpenGates,
  onRetryGates,
  onOpenSettings,
}: BenchTopbarProps) {
  const dir = useDirection();
  const locale = useLocale();

  return (
    <header dir={dir} className="bench-topbar" data-testid="bench-topbar">
      <span dir={dir} className="bench-brand">
        <BrandMark className="bench-brand-mark" />
        {/* The name is the product's own word (`app.name` reads ورشة in Arabic, Warsha in English). */}
        <span>{t('app.name', {}, locale)}</span>
      </span>

      <span dir={dir} className="bench-identity" data-testid="bench-identity">
        {project !== null && (
          <>
            <span>{t('bench.project_label', {}, locale)}</span>
            <span dir="ltr" translate="no" data-testid="bench-project-id">
              {project.id}
            </span>
          </>
        )}
        {run !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span>{t('bench.run_label', {}, locale)}</span>
            <span dir="ltr" translate="no" data-testid="bench-run-id">
              {run.id}
            </span>
          </>
        )}
      </span>

      <span dir={dir} className="bench-topbar-actions">
        <ModeSwitch
          mode={mode}
          onModeChange={onModeChange}
          simpleLabel={t('app.simpleMode', {}, locale)}
          advancedLabel={t('app.advancedMode', {}, locale)}
          label={t('app.mode_label', {}, locale)}
        />

        <GateBell
          gates={gates}
          loading={gatesLoading}
          failed={gatesFailed}
          hasRun={run !== null}
          onOpenGates={onOpenGates}
          onRetry={onRetryGates}
        />

        <Button variant="ghost" size="sm" dir={dir} data-testid="settings-open" onClick={onOpenSettings}>
          {t('app.settings', {}, locale)}
        </Button>
      </span>
    </header>
  );
}
