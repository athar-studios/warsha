import type { RunArtifact } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
// eslint-disable-next-line import/no-unresolved
import { Card, EmptyState, IconFile } from '@warsha/ui/v3';
import React from 'react';

export interface PlanTabProps {
  artifacts: RunArtifact[];
}

export const PlanTab: React.FC<PlanTabProps> = ({ artifacts }) => {
  const t = useT();

  const planArtifacts = artifacts.filter(
    (a) =>
      a.stage === 'prd_spec' ||
      a.stage === 'plan_tasks' ||
      a.stage === 'design' ||
      a.stage === 'research' ||
      a.name.includes('plan') ||
      a.name.includes('spec')
  );

  return (
    <div
      role="tabpanel"
      id="bench-panel-plan"
      aria-labelledby="bench-tab-plan"
      data-testid="bench-tabpanel-plan"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-4)',
      }}
    >
      {planArtifacts.length === 0 ? (
        <EmptyState
          icon={<IconFile size={20} />}
          title={t('bench.plan.empty')}
          data-testid="bench-plan-empty"
        />
      ) : (
        planArtifacts.map((art) => (
          <Card
            key={art.name}
            title={art.name}
            subtitle={`${t(`bench.stage.${art.stage}`)} · ${t('bench.artifacts.version', { version: art.version })}`}
          >
            <div
              dir="auto"
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 'var(--w-font-size-md)',
                lineHeight: 'var(--w-line-height-md)',
                color: 'var(--w-text)',
                fontFamily: 'var(--w-font-sans)',
              }}
            >
              {art.content}
            </div>
          </Card>
        ))
      )}
    </div>
  );
};

PlanTab.displayName = 'PlanTab';
