// apps/desktop/src/v3/pages/developers/index.tsx
// E4 Developers mode: every session of every run with real figures — costs, tokens
// (estimated labels), TPS, cost per merged packet, budgets + burn rate, swarm
// children grouped under their parent, receipt export.
import type { ProjectId, ProjectSummary, RunSubtask, RunSummary, RunId, Session, WarshaEvent } from '@warsha/client';
import { useT } from '@warsha/i18n/v3';
import { Banner, Button, Select } from '@warsha/ui/v3';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useAction } from '../../actions';
import { useClient } from '../../app/ClientContext';
import DevelopersList from '../../components/developers/DevelopersList';

import SessionDetail from './SessionDetail';
import { formatMs } from './format';
import { buildReceipt, burnRateCentsPerHour, costPerPacketCents, groupByParent, runCostCents, sessionMetrics } from './metrics';

export function formatCentsAsDollars(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return `$${value.toFixed(2)}`;
}

const DevelopersPage: React.FC = () => {
  const t = useT();
  const client = useClient();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [runId, setRunId] = useState<RunId | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [events, setEvents] = useState<WarshaEvent[] | null>(null);
  const [subtasks, setSubtasks] = useState<RunSubtask[] | null>(null);
  const [budget, setBudget] = useState<{ spentCents: number; capCents: number | null } | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshAction = useAction('developers.list.refresh', async () => {
    if (!client || !runId) return;
    try {
      setSessions(await client.listRunSessions(runId));
      setEvents(await client.getRunEvents(runId));
      setSubtasks(await client.listRunSubtasks(runId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      if (!client) return;
      try {
        const list = await client.listProjects();
        if (!cancelled) {
          setProjects(list);
          if (list.length > 0) setProjectId((current) => current ?? list[0].id);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      if (!client || !projectId) return;
      try {
        const [runList, budgetStatus] = await Promise.all([
          client.listRuns(projectId),
          client.getProjectBudget(projectId).catch(() => null),
        ]);
        if (cancelled) return;
        setRuns(runList);
        setBudget(
          budgetStatus === null
            ? null
            : {
                spentCents: Math.round(budgetStatus.spentUsd * 100),
                capCents:
                  budgetStatus.totalBudgetUsd > 0 ? Math.round(budgetStatus.totalBudgetUsd * 100) : null,
              }
        );
        setRunId((current) => current ?? runList[0]?.id ?? null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, projectId]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      if (!client || !runId) return;
      try {
        const [runSessions, runEvents, runSubtasks] = await Promise.all([
          client.listRunSessions(runId),
          client.getRunEvents(runId),
          client.listRunSubtasks(runId),
        ]);
        if (cancelled) return;
        setSessions(runSessions);
        setEvents(runEvents);
        setSubtasks(runSubtasks);
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, runId]);

  const visibleSessions = useMemo(() => {
    if (!sessions) return null;
    return sessions.filter(
      (session) =>
        (roleFilter === 'all' || session.role === roleFilter) &&
        (providerFilter === 'all' || session.provider === providerFilter)
    );
  }, [sessions, roleFilter, providerFilter]);

  const providers = useMemo(() => {
    const names = new Set<string>((sessions ?? []).map((session) => session.provider));
    return [...names];
  }, [sessions]);

  const groups = useMemo(() => groupByParent(visibleSessions ?? []), [visibleSessions]);
  const figures = useMemo(() => {
    const map: Record<string, { action: string; elapsed: string; cost: string }> = {};
    for (const session of visibleSessions ?? []) {
      const metrics = sessionMetrics(session, events ?? []);
      map[session.id] = {
        action: `${session.status}`,
        elapsed: formatMs(metrics.elapsedMs),
        cost: metrics.costCents === null ? t('developers.unknown') : `${metrics.costCents} ¢`,
      };
    }
    return map;
  }, [visibleSessions, events, t]);
  const selectedSession = (sessions ?? []).find((session) => session.id === selectedSessionId) ?? null;

  const exportReceipt = useCallback((): void => {
    if (!client || !runId || !projectId) return;
    void (async () => {
      try {
        const [run, permissions, defaults] = await Promise.all([
          client.getRun(runId),
          client.getProjectPermissions(projectId),
          client.getDefaultPermissions(),
        ]);
        const receipt = buildReceipt({
          run: run as unknown as Record<string, unknown>,
          permissions: permissions as unknown as Record<string, unknown>,
          defaults: defaults as unknown as Record<string, unknown>,
          failoverEvents: (events ?? []).filter((event) => event.kind === 'fallback'),
          permissionDecisions: (events ?? []).filter(
            (event) => event.kind === 'gate_decision' || event.kind === 'tool_call'
          ),
          sessions: sessions ?? [],
          subtasks: subtasks ?? [],
        });
        const blob = new Blob([receipt], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `receipt-${runId}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, [client, runId, projectId, events, sessions, subtasks]);

  const cost = runCostCents(events ?? []);
  const packets = costPerPacketCents(events ?? [], subtasks ?? []);
  const run = (runs ?? []).find((item) => item.id === runId) ?? null;
  const burn =
    run !== null ? burnRateCentsPerHour(run.startedAt, run.updatedAt, cost) : null;
  const failedExport = useAction('developers.receipt.export', async () => {
    exportReceipt();
  });

  if (!projects) {
    return (
      <div className="developers-page" data-testid="developers-page">
        <h1>{t('developers.title')}</h1>
        <p>{t('developers.loading')}</p>
      </div>
    );
  }

  return (
    <div className="developers-page" data-testid="developers-page">
      <h1>{t('developers.title')}</h1>

      <div className="developers-filters" data-testid="developers-filters">
        <Select
          label={t('developers.filter.project')}
          data-testid="developers-filter-project"
          title={projects?.find((p) => p.id === projectId)?.name ?? ''}
          value={projectId ?? ''}
          onChange={(event) => {
            setProjectId((event.target.value as ProjectId) || null);
            setRunId(null);
            setSessions(null);
            setEvents(null);
            setSubtasks(null);
            setSelectedSessionId(null);
          }}
          options={(projects ?? []).map((project) => ({ value: project.id, label: project.name }))}
        />
        <Select
          label={t('developers.filter.run')}
          data-testid="developers-filter-run"
          value={runId ?? ''}
          onChange={(event) => {
            setRunId((event.target.value as RunId) || null);
            setSelectedSessionId(null);
          }}
          options={(runs ?? []).map((item) => ({
            value: item.id,
            label: `${item.id} · ${item.stage} · ${item.status}`,
          }))}
        />
        <Select
          label={t('developers.filter.role')}
          data-testid="developers-filter-role"
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          options={[
            { value: 'all', label: t('developers.filter.all') },
            ...['intake', 'researcher', 'pm', 'designer', 'architect', 'coder', 'reviewer', 'release', 'marketer', 'secretary'].map(
              (role) => ({ value: role, label: role })
            ),
          ]}
        />
        <Select
          label={t('developers.filter.provider')}
          data-testid="developers-filter-provider"
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
          options={[
            { value: 'all', label: t('developers.filter.all') },
            ...providers.map((provider) => ({ value: provider, label: provider })),
          ]}
        />
        <Button data-action="developers.list.refresh" onClick={() => void refreshAction.run()}>
          {t('developers.list.refresh')}
        </Button>
      </div>

      {error !== null && (
        <Banner variant="danger" data-testid="developers-error">
          {error}
        </Banner>
      )}

      <div className="developers-budget" data-testid="developers-budget">
        <span>
          {t('developers.budget', {
            spent: formatCentsAsDollars(budget?.spentCents),
            cap:
              budget?.capCents === null || budget === null
                ? t('developers.unknown')
                : formatCentsAsDollars(budget.capCents),
          })}
        </span>
        {budget?.capCents !== null && budget !== null && budget.capCents > 0 && (
          <progress max={budget.capCents} value={budget.spentCents} />
        )}
        <span className="developers-burn" data-testid="developers-burn">
          {t('developers.burn', {
            rate: burn === null ? t('developers.unknown') : `${Math.round(burn)} ¢/h`,
          })}
        </span>
        <span
          className="developers-packets"
          data-testid="developers-cost-packet"
          title={t('developers.cost.packet_def')}
        >
          {t('developers.cost.packet', {
            value: packets === null ? '—' : `${packets.toFixed(1)} ¢`,
          })}
        </span>
        <Button data-testid="developers-receipt-export" data-action="developers.receipt.export" onClick={() => void failedExport.run()}>
          {t('developers.export.receipt')}
        </Button>
      </div>

      {groups.length === 0 ? (
        <p>{t('developers.no_sessions')}</p>
      ) : (
        <div className="developers-groups">
          {groups.map(({ parent, children }) => (
            <section key={parent.id} className="developers-group">
              <DevelopersList sessions={[parent]} figures={figures} onSelect={setSelectedSessionId} />
              {children.length > 0 && (
                <div className="developers-swarm" data-testid="developers-swarm-children">
                  <p className="developers-swarm-banner">{t('developers.swarm.banner', { count: children.length })}</p>
                  <DevelopersList sessions={children} depth={1} figures={figures} onSelect={setSelectedSessionId} />
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {selectedSession !== null && runId !== null && projectId !== null && (
        <SessionDetail
          session={selectedSession}
          events={events ?? []}
          projectId={projectId}
          runId={runId}
        />
      )}
    </div>
  );
};

export default DevelopersPage;
