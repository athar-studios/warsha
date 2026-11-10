// apps/desktop/src/v3/pages/settings/sections/BudgetsSection.tsx
import type { BudgetStatus, ProjectId, ProjectSummary } from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  EmptyState,
  IconWallet,
  SettingsSection,
  Skeleton,
  TextField,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useCallback, useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';
import { useProjects } from '../../../data';

export function BudgetsSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();
  const { status, data: projects, error, reload } = useProjects();

  const [loadingBudgets, setLoadingBudgets] = useState(false);
  const [budgetMap, setBudgetMap] = useState<Record<string, BudgetStatus>>({});
  const [inputMap, setInputMap] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setReady(status !== 'loading' && !loadingBudgets);
  }, [status, loadingBudgets, setReady]);

  const loadBudgets = useCallback(async (projectList: ProjectSummary[]) => {
    if (!client || projectList.length === 0) return;
    setLoadingBudgets(true);
    try {
      const results = await Promise.all(
        projectList.map(async (p) => {
          try {
            const b = await client.getProjectBudget(p.id as ProjectId);
            return { id: p.id, budget: b };
          } catch {
            return {
              id: p.id,
              budget: { totalBudgetUsd: 0, spentUsd: 0, remainingUsd: 0 },
            };
          }
        })
      );
      const nextMap: Record<string, BudgetStatus> = {};
      const nextInputs: Record<string, string> = {};
      for (const res of results) {
        nextMap[res.id] = res.budget;
        nextInputs[res.id] = String(res.budget.totalBudgetUsd || 10);
      }
      setBudgetMap(nextMap);
      setInputMap(nextInputs);
    } finally {
      setLoadingBudgets(false);
    }
  }, [client]);

  useEffect(() => {
    if (projects && projects.length > 0) {
      void loadBudgets(projects);
    }
  }, [projects, loadBudgets]);

  const saveBudgetAction = useAction('settings.budget.save', async (projectId: string, projectName: string) => {
    if (!client) return;
    const rawVal = inputMap[projectId] ?? '10';
    const parsed = Number(rawVal.trim());
    const cents = Math.round((Number.isFinite(parsed) && parsed > 0 ? parsed : 10) * 100);
    await client.setProjectBudget(projectId as ProjectId, cents);
    setStatusMessage(t('settings.budgets.saved', { name: projectName }));
    if (projects) {
      await loadBudgets(projects);
    }
  });

  if (status === 'loading') {
    return (
      <SettingsSection
        title={t('settings.section.budgets')}
        description={t('settings.section.budgets.desc')}
        scope={t('settings.scope.project')}
      >
        <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      </SettingsSection>
    );
  }

  return (
    <div data-testid="settings-section-budgets">
      <SettingsSection
        title={t('settings.section.budgets')}
        description={t('settings.section.budgets.desc')}
        scope={t('settings.scope.project')}
      >
        {status === 'error' && (
          <div style={{ padding: 'var(--w-space-4)' }}>
            <Banner variant="danger">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--w-space-3)', flexWrap: 'wrap' }}>
                <span>{error?.message ?? t('common.error')}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="settings.error.retry"
                  onClick={reload}
                >
                  {t('common.retry')}
                </Button>
              </div>
            </Banner>
          </div>
        )}

        {statusMessage && (
          <div style={{ padding: 'var(--w-space-4)', paddingBlockEnd: 0 }}>
            <Banner variant="success">{statusMessage}</Banner>
          </div>
        )}

        {status === 'empty' || !projects || projects.length === 0 ? (
          status !== 'error' && (
            <EmptyState
              icon={<IconWallet size={20} />}
              title={t('settings.budgets.empty.title')}
              description={t('settings.budgets.empty.desc')}
            />
          )
        ) : (
          <div>
            {projects.map((p) => {
              const b = budgetMap[p.id];
              const pName = p.name || t('settings.budgets.unnamed');
              const currentInput = inputMap[p.id] ?? '10';
              return (
                <div key={p.id} className="v3-settings-row" data-testid={`project-budget-row-${p.id}`}>
                  <span className="v3-settings-row-icon" aria-hidden="true">
                    <IconWallet size={18} />
                  </span>
                  <div className="v3-settings-row-main">
                    <div className="v3-settings-row-title">
                      {pName}
                    </div>
                    <div className="v3-settings-row-subtitle">
                      <span>
                        <span>{t('settings.budgets.spent', { spent: b?.spentUsd ?? 0 })}</span>
                        {' · '}
                        <span>{t('settings.budgets.remaining', { remaining: b?.remainingUsd ?? 0 })}</span>
                      </span>
                    </div>
                  </div>
                  <div className="v3-settings-row-actions">
                    <div style={{ minWidth: 'var(--w-space-10)', maxWidth: '100%' }}>
                      <TextField
                        type="number"
                        min="1"
                        step="1"
                        prefix="$"
                        dir="ltr"
                        label={t('settings.budgets.limit_label')}
                        value={currentInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          setInputMap((prev) => ({ ...prev, [p.id]: val }));
                        }}
                        data-testid={`project-budget-input-${p.id}`}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={saveBudgetAction.pending}
                      data-action="settings.budget.save"
                      onClick={() => {
                        void saveBudgetAction.run(p.id, pName);
                      }}
                    >
                      {t('settings.budgets.save')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
