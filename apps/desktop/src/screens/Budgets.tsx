// Budgets — Per-project budget with spend tracking
import { WarshaClient, type BudgetStatus, type ProjectId, type ProjectSummary } from '@warsha/client';
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Box, Text, Button, Card } from '@warsha/ui';
import React, { useState, useEffect } from 'react';

interface BudgetsProps {
  client: WarshaClient;
  onBack: () => void;
}

export function Budgets({ onBack }: BudgetsProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [budgets, setBudgets] = useState<Record<string, BudgetStatus & { projectName: string }>>({});
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newBudget, setNewBudget] = useState({ projectId: '', cents: 10000 });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // const projectsData = await client.listProjects();
      // for (const project of projectsData) {
      //   const budget = await client.getBudget(project.id);
      //   budgets[project.id] = { ...budget, projectName: project.name };
      // }
      // Mock data
      const mockProjects: ProjectSummary[] = [
        { id: 'proj-1' as ProjectId, name: 'Todo App', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'proj-2' as ProjectId, name: 'Blog Platform', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ];
      setProjects(mockProjects);
      
      const mockBudgets: Record<string, BudgetStatus & { projectName: string }> = {
        'proj-1': { totalBudgetUsd: 100, spentUsd: 23.45, remainingUsd: 76.55, projectName: 'Todo App' },
        'proj-2': { totalBudgetUsd: 50, spentUsd: 12.00, remainingUsd: 38.00, projectName: 'Blog Platform' },
      };
      setBudgets(mockBudgets);
    } catch (error) {
      console.error('Failed to load budgets:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSetBudget = async () => {
    if (!newBudget.projectId || newBudget.cents <= 0) return;
    try {
      // await client.setBudget(newBudget.projectId, newBudget.cents);
      const project = projects.find(p => p.id === newBudget.projectId);
      setBudgets(prev => ({
        ...prev,
        [newBudget.projectId]: {
          totalBudgetUsd: newBudget.cents / 100,
          spentUsd: 0,
          remainingUsd: newBudget.cents / 100,
          projectName: project?.name || 'Unknown',
        }
      }));
      setShowAdd(false);
      setNewBudget({ projectId: '', cents: 10000 });
    } catch (error) {
      console.error('Failed to set budget:', error);
    }
  };

  const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const getProgressColor = (spent: number, total: number) => {
    const pct = total > 0 ? (spent / total) * 100 : 0;
    if (pct >= 90) return 'var(--warsha-color-error)';
    if (pct >= 70) return 'var(--warsha-color-warning)';
    return 'var(--warsha-color-success)';
  };

  return (
    <Box dir={dir} className="budgets" style={{ padding: 'var(--warsha-space-6)', minHeight: 'calc(100vh - 80px)', maxWidth: '1000px' }}>
      <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--warsha-space-6)' }}>
        <Box dir={dir}>
          <Button variant="ghost" size="sm" onClick={onBack} dir={dir} style={{ marginBottom: 'var(--warsha-space-2)' }}>
            ← {locale === 'ar' ? 'رجوع' : 'Back'}
          </Button>
          <Text size="xl" weight="bold" dir={dir}>
            {locale === 'ar' ? 'الميزانيات' : 'Budgets'}
          </Text>
          <Text size="md" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            {locale === 'ar' ? 'تتبع الإنفاق لكل مشروع' : 'Track spending per project'}
          </Text>
        </Box>
        <Button variant="primary" onClick={() => setShowAdd(true)} dir={dir}>
          + {locale === 'ar' ? 'تعيين ميزانية' : 'Set Budget'}
        </Button>
      </Box>

      {loading ? (
        <Box dir={dir} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <Text dir={dir}>{locale === 'ar' ? 'جاري التحميل...' : 'Loading...'}</Text>
        </Box>
      ) : (
        <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)' }}>
          {Object.entries(budgets).length === 0 ? (
            <Card dir={dir} style={{ textAlign: 'center', padding: 'var(--warsha-space-12) var(--warsha-space-6)' }}>
              <Text size="md" dir={dir} style={{ color: 'var(--warsha-color-muted)', marginBottom: 'var(--warsha-space-4)' }}>
                {locale === 'ar' ? 'لا توجد ميزانيات محددة' : 'No budgets set'}
              </Text>
              <Button variant="primary" onClick={() => setShowAdd(true)} dir={dir}>
                {locale === 'ar' ? 'تعيين أول ميزانية' : 'Set First Budget'}
              </Button>
            </Card>
          ) : (
            Object.entries(budgets).map(([projectId, budget]) => {
              const pct = budget.totalBudgetUsd > 0 ? (budget.spentUsd / budget.totalBudgetUsd) * 100 : 0;
              const color = getProgressColor(budget.spentUsd * 100, budget.totalBudgetUsd * 100);
              return (
                <Card key={projectId} dir={dir}>
                  <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--warsha-space-4)' }}>
                    <Box dir={dir}>
                      <Text weight="bold" size="lg" dir={dir}>{budget.projectName}</Text>
                      <Text size="sm" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>{t('projects.id_label', {}, locale) || 'ID:'} {projectId.slice(0, 8)}...</Text>
                    </Box>
                    <Box dir={dir} style={{ textAlign: dir === 'rtl' ? 'right' : 'left' }}>
                      <Text size="sm" weight="bold" dir={dir} style={{ color }}>
                        {formatMoney(Math.round(budget.spentUsd * 100))} / {formatMoney(Math.round(budget.totalBudgetUsd * 100))}
                      </Text>
                      <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)', marginTop: 'var(--warsha-space-1)' }}>
                        {locale === 'ar' ? 'متبقي' : 'Remaining'}: {formatMoney(Math.round(budget.remainingUsd * 100))}
                      </Text>
                    </Box>
                  </Box>

                  <Box dir={dir} style={{ height: '8px', backgroundColor: 'var(--warsha-color-border)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(pct, 100)}%`,
                      height: '100%',
                      backgroundColor: color,
                      transition: 'width 0.3s ease',
                    }} />
                  </Box>

                  <Box dir={dir} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--warsha-space-2)' }}>
                    <Text size="xs" dir={dir} style={{ color: color, fontWeight: 500 }}>
                      {pct.toFixed(1)}% {locale === 'ar' ? 'مستخدمة' : 'used'}
                    </Text>
                    <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
                      {locale === 'ar' ? 'محددة' : 'Set'}: {formatMoney(Math.round(budget.totalBudgetUsd * 100))}
                    </Text>
                  </Box>
                </Card>
              );
            })
          )}
        </Box>
      )}

      {showAdd && (
        <div style={{
          position: 'fixed',
          top: 0,
          insetInlineStart: 0,
          insetInlineEnd: 0,
          bottom: 0,
          backgroundColor: 'var(--warsha-color-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          direction: dir,
        }}>
          <Card dir={dir} style={{ width: '100%', maxWidth: '480px', margin: 'var(--warsha-space-4)' }}>
            <Text size="lg" weight="bold" dir={dir} style={{ marginBottom: 'var(--warsha-space-6)' }}>
              {locale === 'ar' ? 'تعيين ميزانية جديدة' : 'Set New Budget'}
            </Text>
            
            <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)' }}>
              <Box dir={dir}>
                <Text size="sm" weight="medium" dir={dir} style={{ marginBottom: 'var(--warsha-space-2)' }}>
                  {locale === 'ar' ? 'المشروع' : 'Project'}
                </Text>
                <select
                  value={newBudget.projectId}
                  onChange={(e) => setNewBudget({ ...newBudget, projectId: e.target.value })}
                  style={{
                    width: '100%',
                    padding: 'var(--warsha-space-3)',
                    border: '1px solid var(--warsha-color-border-strong)',
                    borderRadius: '6px',
                    fontSize: 'var(--warsha-font-size-md)',
                  }}
                  dir={dir}
                >
                  <option value="">{locale === 'ar' ? 'اختر مشروع...' : 'Select project...'}</option>
                  {projects.filter(p => !budgets[p.id]).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Box>
              
              <Box dir={dir}>
                <Text size="sm" weight="medium" dir={dir} style={{ marginBottom: 'var(--warsha-space-2)' }}>
                  {locale === 'ar' ? 'الميزانية (دولار)' : 'Budget (USD)'}
                </Text>
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={newBudget.cents / 100}
                  onChange={(e) => setNewBudget({ ...newBudget, cents: Math.round(parseFloat(e.target.value) * 100) })}
                  style={{
                    width: '100%',
                    padding: 'var(--warsha-space-3)',
                    border: '1px solid var(--warsha-color-border-strong)',
                    borderRadius: '6px',
                    fontSize: 'var(--warsha-font-size-md)',
                    direction: 'ltr',
                  }}
                  dir="ltr"
                />
              </Box>
              
              <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end' }}>
                <Button variant="secondary" onClick={() => setShowAdd(false)} dir={dir}>
                  {locale === 'ar' ? 'إلغاء' : 'Cancel'}
                </Button>
                <Button variant="primary" onClick={handleSetBudget} disabled={!newBudget.projectId} dir={dir}>
                  {locale === 'ar' ? 'تعيين' : 'Set'}
                </Button>
              </Box>
            </Box>
          </Card>
        </div>
      )}
    </Box>
  );
}