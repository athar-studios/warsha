import type { RunId, WarshaClient, WarshaEvent } from '@warsha/client';
import { useLocale, useT } from '@warsha/i18n/v3';
import { Banner, Button, EmptyState, IconUsers } from '@warsha/ui/v3';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useClient } from '../../app/ClientContext';

import { actionLabel, AgentPanel, lastFileOf, roleLabel } from './AgentPanel';
import { Floor } from './Floor';
import type { AgentStatus } from './state';
import { placeWaitingAgents, reduceEvents } from './state';
import './factory.css';

/**
 * E3 Factory floor (plan §8, ### E3). The owner's overview of every working
 * agent: a schematic floor driven by the N1 session event stream, an agent
 * panel with the same store figures E4 shows, a one-keypress list view for
 * screen readers, and the owner's corner STOP-ALL (runs.cancel per active
 * run). Reduced motion removes every transition; a hidden tab pauses the
 * idle tick so no animation work runs off-screen.
 */

type ViewMode = 'floor' | 'list';

const ACTIVE_STATUSES = new Set(['running', 'paused', 'waiting_owner', 'planning']);

function useFactoryData(
  client: WarshaClient,
  reloadKey: number
): {
  agents: AgentStatus[];
  eventsByRun: Map<string, WarshaEvent[]>;
  swarmCounts: Map<string, number>;
  activeRunIds: string[];
  projectByRun: Map<string, string>;
  error: string | null;
} {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [eventsByRun, setEventsByRun] = useState<Map<string, WarshaEvent[]>>(new Map());
  const [swarmCounts, setSwarmCounts] = useState<Map<string, number>>(new Map());
  const [activeRunIds, setActiveRunIds] = useState<string[]>([]);
  const [projectByRun, setProjectByRun] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const projects = await client.listProjects();
        const runLists = await Promise.all(projects.map((project) => client.listRuns(project.id)));
        const runs = runLists.flat();
        const active = runs.filter((run) => ACTIVE_STATUSES.has(run.status));
        if (cancelled) return;
        setActiveRunIds(active.map((run) => run.id));
        // Cold open reads the persisted history (`runs.events`). `subscribeRun`
        // with no cursor returns only the in-memory ring, which is empty after a
        // daemon restart — that is what painted every agent Idle in the break
        // area. The ring stays as an incremental update, merged by event id.
        const eventLists = await Promise.all(
          active.map(async (run) => {
            const [persisted, live] = await Promise.all([
              client.getRunEvents(run.id as RunId).catch(() => [] as WarshaEvent[]),
              client
                .subscribeRun(run.id as RunId)
                .then((stream) => stream.events)
                .catch(() => [] as WarshaEvent[]),
            ]);
            const byId = new Map<string, WarshaEvent>();
            for (const event of persisted) byId.set(event.id, event);
            for (const event of live) byId.set(event.id, event);
            return { runId: run.id, events: [...byId.values()] };
          })
        );
        if (cancelled) return;
        const merged = eventLists.flatMap((entry) => entry.events);
        const derived = Array.from(placeWaitingAgents(reduceEvents(merged), active).values());
        setAgents(derived);
        setEventsByRun(new Map(eventLists.map((entry) => [entry.runId as string, entry.events])));
        setProjectByRun(new Map(runs.map((run) => [run.id, run.projectId])));
        const swarm = new Map<string, number>();
        await Promise.all(
          active.map(async (run) => {
            try {
              const subtasks = await client.listRunSubtasks(run.id);
              if (!cancelled) swarm.set(run.id, subtasks.length);
            } catch {
              if (!cancelled) swarm.set(run.id, 0);
            }
          })
        );
        if (!cancelled) {
          setSwarmCounts(swarm);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, reloadKey]);

  return { agents, eventsByRun, swarmCounts, activeRunIds, projectByRun, error };
}

export const FactoryPage: React.FC = () => {
  const contextClient = useClient();
  const client = contextClient as WarshaClient;
  const t = useT();
  const { dir } = useLocale();
  const [view, setView] = useState<ViewMode>('floor');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [stoppedRuns, setStoppedRuns] = useState<Set<string>>(new Set());
  const [stopError, setStopError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hidden, setHidden] = useState(false);
  const { agents, eventsByRun, swarmCounts, activeRunIds, projectByRun, error } = useFactoryData(
    client,
    reloadKey
  );
  const rafRef = useRef<number | null>(null);

  // Reduced motion: the floor drops every transition (matchMedia, no timer).
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const listener = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  // Hidden tab: cancel the idle tick so no animation frame runs off-screen.
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (hidden || reducedMotion) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    const tick = () => {
      setNowMs(Date.now());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [hidden, reducedMotion]);

  // One keypress to the list view (screen readers: button + keyboard).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'l' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        setView((current) => (current === 'floor' ? 'list' : 'floor'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const stopAll = useCallback(async () => {
    const pending = activeRunIds.filter((runId) => !stoppedRuns.has(runId));
    if (pending.length === 0) return;
    try {
      await Promise.all(
        pending.map((runId) => client.cancelRun(runId as RunId, 'factory stop-all'))
      );
      setStoppedRuns((current) => new Set([...current, ...pending]));
      setStopError(null);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setStopError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [activeRunIds, client, stoppedRuns]);

  const selected = agents.find((agent) => agent.key === selectedKey) ?? null;
  const selectedEvents = selected !== null ? (eventsByRun.get(selected.runId) ?? []) : [];
  const selectedProjectId = selected !== null ? (projectByRun.get(selected.runId) ?? null) : null;

  const switchView = useCallback(() => {
    setView((current) => (current === 'floor' ? 'list' : 'floor'));
  }, []);

  return (
    <div className="factory-page" data-testid="factory-page">
      <header className="factory-header">
        <h1 className="factory-title">{t('factory.title')}</h1>
        <div className="factory-owner-corner" data-testid="factory-owner-corner">
          <Button
            variant="ghost"
            data-action="factory.view.toggle"
            aria-pressed={view === 'list'}
            onClick={switchView}
          >
            {view === 'floor' ? t('factory.listView') : t('factory.floorView')}
          </Button>
          <Button
            variant="danger"
            data-action="factory.stop.all"
            onClick={() => void stopAll()}
            disabled={stoppedRuns.size >= activeRunIds.length && activeRunIds.length > 0}
          >
            {t('factory.stopAll')}
          </Button>
        </div>
      </header>
      {error !== null && (
        <Banner variant="danger" data-testid="factory-error">
          <div className="factory-banner-row">
            <span>{error}</span>
            <Button
              size="sm"
              variant="secondary"
              data-action="factory.retry"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              {t('common.retry')}
            </Button>
          </div>
        </Banner>
      )}
      {stopError !== null && (
        <Banner variant="danger" data-testid="factory-stop-error">
          {stopError}
        </Banner>
      )}
      {agents.length === 0 && error === null && (
        <EmptyState
          data-testid="factory-empty"
          icon={<IconUsers />}
          title={t('factory.empty')}
          description={t('factory.empty.desc')}
        />
      )}
      <div aria-live="polite" data-testid="factory-list-status" className="visually-hidden">
        {view === 'list' ? t('factory.listViewHint') : ''}
      </div>
      {view === 'floor' ? (
        <Floor
          agents={agents}
          nowMs={nowMs}
          reducedMotion={reducedMotion}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          swarmCounts={swarmCounts}
          t={t}
          dir={dir}
        />
      ) : (
        <div className="factory-table-wrap">
          <table className="factory-table" data-testid="factory-list-view">
            <caption className="visually-hidden">{t('factory.listViewHint')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('factory.list.agent')}</th>
                <th scope="col">{t('factory.list.state')}</th>
                <th scope="col">{t('factory.list.run')}</th>
                <th scope="col">{t('factory.list.role')}</th>
                <th scope="col">{t('factory.list.action')}</th>
                <th scope="col">{t('factory.list.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr
                  key={agent.key}
                  onClick={() => setSelectedKey(agent.key)}
                  data-action="factory.agent.view"
                  data-testid={`factory-list-row-${agent.key}`}
                >
                  <td>
                    <bdi className="factory-mono">{agent.key}</bdi>
                  </td>
                  <td>{t(`factory.state.${agent.state}`)}</td>
                  <td>
                    <bdi className="factory-mono">{agent.runId}</bdi>
                  </td>
                  <td data-testid="factory-list-role">
                    <bdi dir="auto">{roleLabel(agent.role, t)}</bdi>
                  </td>
                  <td data-testid="factory-list-action">
                    <bdi dir="auto">{actionLabel(agent.lastAction, t)}</bdi>
                  </td>
                  <td data-testid="factory-list-cost">
                    <bdi dir="ltr">{t('factory.cost_cents', { cents: agent.costCents })}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected !== null && (
        <AgentPanel
          agent={selected}
          lastFile={lastFileOf(selectedEvents)}
          codeHref={selectedProjectId !== null ? `/p/${selectedProjectId}/code` : '#'}
          t={t}
        />
      )}
    </div>
  );
};
