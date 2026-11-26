// apps/desktop/src/v3/pages/developers/index.tsx
// E4 Developers mode: every session of every run with real figures — costs, tokens
// (estimated labels), TPS, cost per merged packet, budgets + burn rate, swarm
// children grouped under their parent, receipt export.
import {
  ALL_ROLES,
  canonicalRoleKey,
  type ProjectId,
  type ProjectSummary,
  type RunSubtask,
  type RunSummary,
  type RunId,
  type ProvisioningRecord,
  type Session,
  type WarshaEvent,
} from '@warsha/client';
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  EmptyState,
  IconDownload,
  IconTerminal,
  Select,
  Skeleton,
} from '@warsha/ui/v3';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useAction } from '../../actions';
import { useClient } from '../../app/ClientContext';
import DevelopersList from '../../components/developers/DevelopersList';
import { roleLabel } from '../../copy/roles';
import { getStatusLabelKey } from '../bench/helpers';
import { findPendingGateAtCurrentStage } from '../inbox/gateHelpers';

import SessionDetail from './SessionDetail';
import './developers.css';
import { formatMs } from './format';
import { buildReceipt, burnRateCentsPerHour, costPerPacketCents, groupByParent, runCostCents, sessionMetrics } from './metrics';

export function formatCentsAsDollars(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return `$${value.toFixed(2)}`;
}

const DevelopersPage: React.FC = () => {
  const t = useT();
  /** Role label: the catalog name (wire ids `p_m`/`q_a` folded), the role id otherwise. */
  const roleName = (role: string): string => roleLabel(role, t);
  const client = useClient();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [waitingRunIds, setWaitingRunIds] = useState<ReadonlySet<string>>(new Set());
  const [runId, setRunId] = useState<RunId | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [events, setEvents] = useState<WarshaEvent[] | null>(null);
  const [subtasks, setSubtasks] = useState<RunSubtask[] | null>(null);
  const [budget, setBudget] = useState<{ spentCents: number; capCents: number | null } | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState<ProvisioningRecord[] | null>(null);

  const refreshAction = useAction('developers.list.refresh', async () => {
    if (!client || !runId) return;
    try {
      const [sessionsRes, eventsRes, subtasksRes] = await Promise.allSettled([
        client.listRunSessions(runId),
        client.getRunEvents(runId),
        client.listRunSubtasks(runId),
      ]);
      let anyFailed = false;
      if (sessionsRes.status === 'fulfilled') {
        setSessions(sessionsRes.value);
      } else {
        anyFailed = true;
      }
      if (eventsRes.status === 'fulfilled') {
        setEvents(eventsRes.value);
      } else {
        anyFailed = true;
      }
      if (subtasksRes.status === 'fulfilled') {
        setSubtasks(subtasksRes.value);
      } else {
        anyFailed = true;
      }
      if (anyFailed) {
        setError(t('developers.error'));
      } else {
        setError(null);
      }
    } catch {
      setError(t('developers.error'));
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
      } catch {
        if (!cancelled) setError(t('developers.error'));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, t]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      if (!client || !projectId) return;
      try {
        const [runList, budgetStatus, assigned] = await Promise.all([
          client.listRuns(projectId),
          client.getProjectBudget(projectId).catch(() => null),
          // A missing method throws before .catch can attach. Resolve first so
          // an older client, or a test double, still loads the run list.
          Promise.resolve()
            .then(() => client.listProvisioning(projectId))
            .catch(() => null),
        ]);
        if (cancelled) return;
        setRuns(runList);
        setWaitingRunIds(new Set());
        setProvisioning(assigned);
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
        // D-RN-UI-R5: the daemon keeps a run `running` while it waits at a gate; the same
        // pending-gate-at-current-stage rule as the frame chips decides which are waiting.
        const waiting = new Set<string>();
        await Promise.all(
          runList.map(async (item) => {
            if (item.status !== 'running' && item.status !== 'in_progress') return;
            try {
              const gates = await Promise.resolve().then(() => client.getGates(item.id));
              if (findPendingGateAtCurrentStage(gates, item) !== null) waiting.add(item.id);
            } catch {
              // A failed gate read leaves the run's own status label in place.
            }
          })
        );
        if (!cancelled) setWaitingRunIds(waiting);
      } catch {
        if (!cancelled) setError(t('developers.error'));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, projectId, t]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      if (!client || !runId) return;
      try {
        const [sessionsRes, eventsRes, subtasksRes] = await Promise.allSettled([
          client.listRunSessions(runId),
          client.getRunEvents(runId),
          client.listRunSubtasks(runId),
        ]);
        if (cancelled) return;
        let anyFailed = false;
        if (sessionsRes.status === 'fulfilled') {
          setSessions(sessionsRes.value);
        } else {
          anyFailed = true;
        }
        if (eventsRes.status === 'fulfilled') {
          setEvents(eventsRes.value);
        } else {
          anyFailed = true;
        }
        if (subtasksRes.status === 'fulfilled') {
          setSubtasks(subtasksRes.value);
        } else {
          anyFailed = true;
        }
        if (anyFailed) {
          setError(t('developers.error'));
        } else {
          setError(null);
        }
      } catch {
        if (!cancelled) setError(t('developers.error'));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, runId, t]);

  const visibleSessions = useMemo(() => {
    if (!sessions) return null;
    return sessions.filter(
      (session) =>
        (roleFilter === 'all' || (canonicalRoleKey(session.role) ?? session.role) === roleFilter) &&
        (providerFilter === 'all' || session.provider === providerFilter)
    );
  }, [sessions, roleFilter, providerFilter]);

  const providers = useMemo(() => {
    const names = new Set<string>(
      (sessions ?? []).map((session) => session.provider).filter((provider) => provider !== '')
    );
    return [...names];
  }, [sessions]);

  const groups = useMemo(() => groupByParent(visibleSessions ?? []), [visibleSessions]);
  const figures = useMemo(() => {
    const map: Record<string, { action: string; elapsed: string; cost: string; provider: string; model: string }> = {};
    for (const session of visibleSessions ?? []) {
      const metrics = sessionMetrics(session, events ?? []);
      const notRouted = session.provider === '' || session.provider === 'routed';
      map[session.id] = {
        action: `${session.status}`,
        elapsed: formatMs(metrics.elapsedMs),
        // No provider was chosen yet: say so instead of the "unknown" fallback.
        cost: notRouted ? t('developers.not_routed_yet') : metrics.costCents === null ? t('developers.unknown') : `${metrics.costCents} ¢`,
        provider: notRouted ? t('developers.not_routed_yet') : session.provider,
        model: session.model === '' || session.model === 'default' ? t('developers.not_routed_yet') : session.model,
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
      } catch {
        setError(t('developers.error'));
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
        <h1 className="developers-title">{t('developers.title')}</h1>
        <div className="developers-loading" role="status" aria-label={t('developers.loading')}>
          <Skeleton variant="text" width="40%" />
          <Skeleton width="100%" height="var(--w-space-9)" />
          <Skeleton width="100%" height="var(--w-space-10)" />
        </div>
      </div>
    );
  }

  return (
    <div className="developers-page" data-testid="developers-page">
      <h1 className="developers-title">{t('developers.title')}</h1>

      <div className="developers-filters" data-testid="developers-filters">
        <Select
          label={t('developers.filter.project')}
          data-testid="developers-filter-project"
          title={projects?.find((p) => p.id === projectId)?.name ?? ''}
          value={projectId ?? ''}
          onChange={(event) => {
            setProjectId((event.target.value as ProjectId) || null);
            setRunId(null);
            setProvisioning(null);
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
            label: `${item.id} · ${item.stage} · ${t(
              getStatusLabelKey(waitingRunIds.has(item.id) ? 'awaiting_gate' : item.status)
            )}`,
          }))}
        />
        <Select
          label={t('developers.filter.role')}
          data-testid="developers-filter-role"
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          options={[
            { value: 'all', label: t('developers.filter.all') },
            ...ALL_ROLES.map((role) => ({ value: role, label: roleName(role) })),
          ]}
        />
        <Select
          label={t('developers.filter.provider')}
          data-testid="developers-filter-provider"
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
          options={[
            { value: 'all', label: t('developers.filter.all') },
            ...providers.map((provider) => ({
              value: provider,
              label: provider === '' ? t('developers.not_routed_yet') : provider,
            })),
          ]}
        />
        <Button data-action="developers.list.refresh" onClick={() => void refreshAction.run()}>
          {t('developers.list.refresh')}
        </Button>
      </div>

      {error !== null && (
        <Banner variant="danger" data-testid="developers-error">
          <div className="developers-banner-row">
            <span>{error}</span>
            <Button
              size="sm"
              variant="secondary"
              data-action="developers.list.refresh"
              onClick={() => void refreshAction.run()}
            >
              {t('common.retry')}
            </Button>
          </div>
        </Banner>
      )}

      <section className="developers-provisioning" data-testid="developers-provisioning">
        <h2 className="developers-provisioning-title">{t('developers.provisioning.title')}</h2>
        {provisioning === null || provisioning.length === 0 ? (
          <p className="developers-provisioning-empty">{t('developers.provisioning.empty')}</p>
        ) : (
          <table className="developers-provisioning-table">
            <thead>
              <tr>
                <th>{t('developers.provisioning.agent')}</th>
                <th>{t('developers.table.role')}</th>
                <th>{t('developers.provisioning.skills')}</th>
                <th>{t('developers.provisioning.tools')}</th>
                <th>{t('developers.provisioning.source')}</th>
                <th>{t('developers.provisioning.audited')}</th>
              </tr>
            </thead>
            <tbody>
              {provisioning.map((record) => (
                <tr key={record.agentId} data-testid="developers-provisioning-row">
                  <td>{record.agentId}</td>
                  <td>{roleName(record.role)}</td>
                  <td>
                    {record.skills.length === 0
                      ? t('developers.provisioning.none')
                      : record.skills.join(', ')}
                  </td>
                  <td>
                    {record.tools.length === 0
                      ? t('developers.provisioning.none')
                      : record.tools.join(', ')}
                  </td>
                  <td>{record.source}</td>
                  <td>
                    {record.audited
                      ? t('developers.provisioning.audited')
                      : t('developers.provisioning.not_audited')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

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
        <Button
          variant="secondary"
          size="sm"
          icon={<IconDownload />}
          className="developers-budget-export"
          data-testid="developers-receipt-export"
          data-action="developers.receipt.export"
          onClick={() => void failedExport.run()}
        >
          {t('developers.export.receipt')}
        </Button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          data-testid="developers-empty"
          icon={<IconTerminal />}
          title={t('developers.no_sessions')}
          description={t('developers.no_sessions.desc')}
        />
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
