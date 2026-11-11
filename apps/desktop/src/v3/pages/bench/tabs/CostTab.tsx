import { ALL_ROLES, type BudgetStatus, type WarshaEvent } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  Card,
  ProgressBar,
  Skeleton,
  TextField,
// eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React, { useEffect, useState } from 'react';

import {
  aggregateRoleMetrics,
  aggregateStageCosts,
  formatCentsAsUsd,
  formatUsd,
} from '../helpers';
import { ALL_DAEMON_STAGES } from '../types';

export interface CostTabProps {
  budget: BudgetStatus | null;
  status: 'loading' | 'empty' | 'error' | 'ready';
  events: WarshaEvent[];
  onSaveBudget: (cents: number) => Promise<void> | void;
  savePending?: boolean;
  onReload: () => void;
}

export const CostTab: React.FC<CostTabProps> = ({
  budget,
  status,
  events,
  onSaveBudget,
  savePending = false,
  onReload,
}) => {
  const t = useT();
  const [budgetInput, setBudgetInput] = useState(
    budget && budget.totalBudgetUsd > 0 ? String(budget.totalBudgetUsd) : ''
  );

  useEffect(() => {
    if (budget && budget.totalBudgetUsd > 0) {
      setBudgetInput(String(budget.totalBudgetUsd));
    }
  }, [budget]);

  const roleMetrics = aggregateRoleMetrics(events);
  const stageCosts = aggregateStageCosts(events);

  const handleSave = () => {
    const parsed = Number(budgetInput);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    void onSaveBudget(Math.round(parsed * 100));
  };

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
        <Skeleton height="var(--w-space-8)" />
        <Skeleton height="var(--w-space-10)" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <Banner
        variant="danger"
        action={
          <Button variant="secondary" size="sm" onClick={onReload} data-action="bench.stream.reconnect">
            {t('bench.retry')}
          </Button>
        }
      >
        {t('bench.error')}
      </Banner>
    );
  }

  const totalUsd = budget?.totalBudgetUsd ?? 0;
  const spentUsd = budget?.spentUsd ?? 0;
  const remainingUsd = budget?.remainingUsd ?? 0;
  const pct = totalUsd > 0 ? Math.min(100, Math.round((spentUsd / totalUsd) * 100)) : 0;

  return (
    <div
      role="tabpanel"
      id="bench-panel-cost"
      aria-labelledby="bench-tab-cost"
      data-testid="bench-tabpanel-cost"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-4)',
      }}
    >
      <Card
        title={t('bench.cost.title')}
        subtitle={
          totalUsd > 0
            ? t('bench.cost.spent_of', {
                spent: formatUsd(spentUsd),
                total: formatUsd(totalUsd),
              })
            : t('bench.cost.no_budget')
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          <ProgressBar
            value={totalUsd > 0 ? pct : 0}
            max={100}
            variant={pct >= 90 ? 'attention' : 'primary'}
            label={t('bench.cost.title')}
          />

          {totalUsd > 0 && (
            <div style={{ fontSize: 'var(--w-font-size-sm)', color: 'var(--w-text-muted)' }}>
              {t('bench.cost.remaining', { remaining: formatUsd(remainingUsd) })}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 'var(--w-space-3)',
              flexWrap: 'wrap',
              paddingBlockStart: 'var(--w-space-2)',
            }}
          >
            <TextField
              label={t('bench.cost.budget_label')}
              type="number"
              min="0"
              step="any"
              prefix="$"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              data-testid="bench-cost-budget-input"
            />
            <Button
              variant="secondary"
              size="sm"
              loading={savePending}
              onClick={handleSave}
              data-action="bench.budget.save"
              data-testid="bench-cost-budget-save-btn"
            >
              {t('bench.cost.save_budget')}
            </Button>
          </div>
        </div>
      </Card>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(var(--w-rail-width), 1fr))',
          gap: 'var(--w-space-4)',
        }}
      >
        <Card title={t('bench.cost.role_breakdown')}>
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
            {ALL_ROLES.map((role) => {
              const cents = roleMetrics[role]?.costCents ?? 0;
              return (
                <li
                  key={role}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 'var(--w-font-size-sm)',
                    paddingBlock: 'var(--w-space-1)',
                    borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
                  }}
                >
                  <span>{t(`bench.role.${role}`)}</span>
                  <bdi dir="ltr" style={{ fontFamily: 'var(--w-font-mono)' }}>
                    {formatCentsAsUsd(cents)}
                  </bdi>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title={t('bench.cost.stage_breakdown')}>
          {Object.keys(stageCosts).length === 0 ? (
            <p style={{ margin: 0, fontSize: 'var(--w-font-size-sm)', color: 'var(--w-text-muted)' }}>
              {t('bench.cost.no_costs')}
            </p>
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
              {ALL_DAEMON_STAGES.filter((s) => (stageCosts[s] ?? 0) > 0).map((stage) => (
                <li
                  key={stage}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 'var(--w-font-size-sm)',
                    paddingBlock: 'var(--w-space-1)',
                    borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
                  }}
                >
                  <span>{t(`bench.stage.${stage}`)}</span>
                  <bdi dir="ltr" style={{ fontFamily: 'var(--w-font-mono)' }}>
                    {formatCentsAsUsd(stageCosts[stage] ?? 0)}
                  </bdi>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
};

CostTab.displayName = 'CostTab';
