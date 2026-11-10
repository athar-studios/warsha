import type { GateSummary, RunArtifact, RunSummary, WarshaEvent } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useLocale, useT } from '@warsha/i18n/v3';
// eslint-disable-next-line import/no-unresolved
import { ActivityFeed, Card, EmptyState, IconSparkle } from '@warsha/ui/v3';
import React from 'react';

import { getGateQuestionKey } from '../../../copy/stages';
import { BenchDecisionCard } from '../components/BenchDecisionCard';
import { extractEventText, formatEventTime } from '../helpers';

export interface OverviewTabProps {
  run: RunSummary;
  gates: GateSummary[];
  events: WarshaEvent[];
  artifacts: RunArtifact[];
  onApproveGate: (gateStage: string) => Promise<void> | void;
  approvePending?: boolean;
  onRequestChanges?: (notes: string) => Promise<void> | void;
  changesPending?: boolean;
  onRejectGate?: (reason: string) => Promise<void> | void;
  rejectPending?: boolean;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  run,
  gates,
  events,
  artifacts,
  onApproveGate,
  approvePending = false,
  onRequestChanges,
  changesPending = false,
  onRejectGate,
  rejectPending = false,
}) => {
  const t = useT();
  const { locale } = useLocale();

  // Amendment (b): count only the decision that is waiting at the current stage
  const pendingGate = gates.find(
    (g) => g.stage === run.stage && 'state' in g.state && g.state.state === 'pending'
  );

  const gateLetter = run.stage.startsWith('gate_') ? run.stage.slice(5) : '';
  const questionKey = gateLetter ? getGateQuestionKey(gateLetter) : 'gate.question.a';

  const feedEvents = events.slice(-10).reverse().map((ev) => ({
    id: ev.id,
    time: formatEventTime(ev.createdAt, locale),
    message: extractEventText(ev),
    stageKey: ev.stage,
    stageLabel: t(`bench.stage.${ev.stage}`),
    icon: <IconSparkle size={14} />,
  }));

  return (
    <div
      role="tabpanel"
      id="bench-panel-overview"
      aria-labelledby="bench-tab-overview"
      data-testid="bench-tabpanel-overview"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-4)',
      }}
    >
      {pendingGate && (
        <BenchDecisionCard
          question={t(questionKey)}
          rationale={t('bench.gate.rationale')}
          consequences={[
            t('bench.gate.consequence_continue'),
            t('bench.gate.consequence_review'),
          ]}
          onApprove={() => void onApproveGate(pendingGate.stage)}
          approvePending={approvePending}
          onRequestChanges={onRequestChanges ? (notes) => void onRequestChanges(notes) : undefined}
          changesPending={changesPending}
          onReject={onRejectGate ? (reason) => void onRejectGate(reason) : undefined}
          rejectPending={rejectPending}
        />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(var(--w-rail-width), 1fr))',
          gap: 'var(--w-space-4)',
        }}
      >
        <Card
          title={t('bench.overview.events_title')}
          style={{ flex: 1, minWidth: 0 }}
        >
          {feedEvents.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--w-text-muted)', fontSize: 'var(--w-font-size-sm)' }}>
              {t('bench.overview.no_events')}
            </p>
          ) : (
            <ActivityFeed
              events={feedEvents}
              variant="advanced"
              emptyLabel={t('bench.overview.no_events')}
            />
          )}
        </Card>

        <Card
          title={t('bench.overview.artifacts_title')}
          subtitle={
            artifacts.length > 0
              ? t('bench.overview.artifacts_count', { count: artifacts.length })
              : t('bench.overview.no_artifacts')
          }
          style={{ flex: 1, minWidth: 0 }}
        >
          {artifacts.length === 0 ? (
            <EmptyState
              title={t('bench.overview.no_artifacts')}
              style={{ paddingBlock: 'var(--w-space-4)' }}
            />
          ) : (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--w-space-2)',
              }}
            >
              {artifacts.slice(0, 5).map((art) => (
                <li
                  key={art.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBlock: 'var(--w-space-2)',
                    paddingInline: 'var(--w-space-3)',
                    backgroundColor: 'var(--w-sunken)',
                    borderRadius: 'var(--w-radius-sm)',
                    fontSize: 'var(--w-font-size-sm)',
                  }}
                >
                  <span style={{ fontWeight: 'var(--w-font-weight-medium)' }}>{art.name}</span>
                  <span
                    style={{
                      fontSize: 'var(--w-font-size-xs)',
                      color: 'var(--w-text-muted)',
                    }}
                  >
                    {t(`bench.stage.${art.stage}`)} · {t('bench.artifacts.version', { version: art.version })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
};

OverviewTab.displayName = 'OverviewTab';
