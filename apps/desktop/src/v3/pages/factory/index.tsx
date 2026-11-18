import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunId, WarshaClient, WarshaEvent } from '@warsha/client';
import { useClient } from '../../app/ClientContext';
import { useT } from '@warsha/i18n/v3';
import { Banner, Button } from '@warsha/ui/v3';
import { Floor } from './Floor';
import { AgentPanel, lastFileOf } from './AgentPanel';
import type { AgentStatus } from './state';
import { idleMsOf, reduceEvents } from './state';

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
        const eventLists = await Promise.all(
          active.map(async (run) => ({
            runId: run.id,
            events: (await client.subscribeRun(run.id as RunId)).events,
          }))
        );
        if (cancelled) return;
        const merged = eventLists.flatMap((entry) => entry.events);
        const derived = Array.from(reduceEvents(merged).values());
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
      <h1>{t('factory.title')}</h1>
      {error !== null && (
        <Banner variant="danger" data-testid="factory-error">
          {error}
        </Banner>
      )}
      {stopError !== null && (
        <Banner variant="danger" data-testid="factory-stop-error">
          {stopError}
        </Banner>
      )}
      <div
        className="factory-owner-corner"
        data-testid="factory-owner-corner"
        style={{ display: 'flex', gap: 'var(--w-space-3)', paddingBlockEnd: 'var(--w-space-3)' }}
      >
        <Button
          data-action="factory.stop.all"
          onClick={() => void stopAll()}
          disabled={stoppedRuns.size >= activeRunIds.length && activeRunIds.length > 0}
        >
          {t('factory.stopAll')}
        </Button>
        <Button
          data-action="factory.view.toggle"
          aria-pressed={view === 'list'}
          onClick={switchView}
        >
          {view === 'floor' ? t('factory.listView') : t('factory.floorView')}
        </Button>
      </div>
      {agents.length === 0 && (
        <Banner variant="info" data-testid="factory-empty">
          {t('factory.empty')}
        </Banner>
      )}
      <div
        aria-live="polite"
        data-testid="factory-list-status"
        style={{
          position: 'absolute',
          inlineSize: 1,
          blockSize: 1,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
        }}
      >
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
        />
      ) : (
        <table data-testid="factory-list-view">
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
                <td>{agent.key}</td>
                <td>{t(`factory.state.${agent.state}`)}</td>
                <td>{agent.runId}</td>
                <td>{agent.role ?? '—'}</td>
                <td>{agent.lastAction}</td>
                <td>{`${agent.costCents}¢`}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
