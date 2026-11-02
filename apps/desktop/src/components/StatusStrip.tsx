// Ship status strip — "Code checks → Builds → Tests → Store-ready" (PLAN.md M5a), redrawn for the bench.
//
// The strip only renders the four delivery stages; it never runs a check itself. The statuses come from
// the existing CI/GitHub check status, so this component stays a pure function of its `stages` prop and
// re-renders when the feed updates.
//
// The bench shape (docs/design/REDESIGN.md §1, §9): a ruled row of lamps on a plate, in ship order, with
// a direction-following separator between them. Each stage says itself three ways — the dot, a glyph and
// the state word — because a check that is only green is a check nobody with a colour-vision deficiency
// can read. The `working` lamp breathes, and only because `tokens.css` gates that animation on
// `prefers-reduced-motion: no-preference` (§8); there is no spinner to own here.
//
// Every word is `@warsha/i18n` (`status_strip.*`): the local `{ ar, en }` tables and the
// `translated === key ? fallback : translated` shim they needed are gone.
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Lamp, type LampState } from '@warsha/ui';
import React from 'react';

export type StageStatus = 'pending' | 'running' | 'pass' | 'fail';

export interface DeliveryStage {
  /** Stage name. The four ship stages are localized; any other name renders as-is. */
  name: string;
  status: StageStatus;
}

/** The four delivery stages, in ship order. */
export const deliveryStageNames = ['code_checks', 'builds', 'tests', 'store_ready'] as const;

export type DeliveryStageName = (typeof deliveryStageNames)[number];

/**
 * The lamp a check status lights.
 *
 * `waiting` is deliberately absent: §1 reserves the lit lamp for the owner's queue, and a build that is
 * running is the machine's business until it fails or the whole strip is green.
 */
export function stageLamp(status: StageStatus): LampState {
  switch (status) {
    case 'running':
      return 'working';
    case 'pass':
      return 'ok';
    case 'fail':
      return 'fail';
    case 'pending':
      return 'idle';
  }
}

/** The catalog key a stage is named by, or `null` for a name the bench does not know. */
function stageKey(name: string): string | null {
  const normalized = normalizeStageName(name);
  return (deliveryStageNames as readonly string[]).includes(normalized)
    ? `status_strip.stage.${normalized}`
    : null;
}

/** `Code checks` → `code_checks`; unknown names keep their words, lowercased. */
export function normalizeStageName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** The four stages before any check has reported: all pending. */
export function initialDeliveryStages(): DeliveryStage[] {
  return deliveryStageNames.map((name) => ({ name, status: 'pending' as StageStatus }));
}

/** True only when there is at least one stage and every one of them passed. */
export function allStagesGreen(stages: readonly DeliveryStage[]): boolean {
  return stages.length > 0 && stages.every((stage) => stage.status === 'pass');
}

export interface StatusStripProps {
  /** Delivery stages in ship order; re-render with new statuses to update live. */
  stages: DeliveryStage[];
}

export function StatusStrip({ stages }: StatusStripProps) {
  const dir = useDirection();
  const locale = useLocale();

  // In RTL the flow runs right-to-left, so the separator has to point the other way.
  const arrow = dir === 'rtl' ? '←' : '→';
  const label = t('status_strip.label', {}, locale);

  return (
    <div dir={dir} role="status" aria-live="polite">
      <ol
        dir={dir}
        aria-label={label}
        data-testid="status-strip"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--warsha-space-2)',
          listStyle: 'none',
          margin: 0,
          padding: 0,
          minInlineSize: 0,
        }}
      >
        {stages.map((stage, index) => {
          const normalized = normalizeStageName(stage.name);
          const known = stageKey(stage.name) !== null;
          const stageName = known
            ? t(`status_strip.stage.${normalized}`, {}, locale)
            : stage.name;
          const statusLabel = t(`status_strip.status.${stage.status}`, {}, locale);
          const hint = t(`status_strip.hint.${stage.status}`, {}, locale);

          return (
            <li
              key={`${normalized}-${index}`}
              data-stage={normalized}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)', minInlineSize: 0 }}
            >
              <span
                data-testid={`status-strip-stage-${normalized}`}
                data-status={stage.status}
                title={`${stageName} — ${hint}`}
                aria-label={`${stageName} — ${statusLabel}`}
                style={{ display: 'inline-flex', alignItems: 'center', minInlineSize: 0 }}
              >
                <Lamp state={stageLamp(stage.status)} size="xs">
                  {stageName}
                </Lamp>
              </span>
              {index < stages.length - 1 && (
                <span
                  aria-hidden="true"
                  data-testid="status-strip-arrow"
                  style={{
                    color: 'var(--warsha-color-text)',
                    fontFamily: 'var(--warsha-font-mono)',
                  }}
                >
                  {arrow}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
