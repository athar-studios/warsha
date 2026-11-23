import {
  canonicalRoleKey,
  type GateEvidence,
  type ProjectId,
  type Role,
  type RunId,
  type RunModeConfig,
  type RunSummary,
} from '@warsha/client';
import { useT } from '@warsha/i18n/v3';
import '@warsha/ui/v3/tokens/tokens.css';
import { Banner, Button, IconFolder, Sheet, Skeleton } from '@warsha/ui/v3';
import React, { useEffect, useMemo, useState } from 'react';

import { useAction } from '../../actions';
import { useClient } from '../../app/ClientContext';
import { useDataReady } from '../../app/DataReadyContext';
import type { DaemonStage } from '../../copy/stages';
import {
  useAgent,
  useArtifacts,
  useBudget,
  useFiles,
  useGates,
  useHarnesses,
  useModels,
  usePreview,
  useProject,
  useProjects,
  useRoles,
  useRun,
  useRunEvents,
  useRuns,
} from '../../data';
import { useNavigate, useRoute } from '../../router';

import { AdvancedComposer } from './components/AdvancedComposer';
import { BenchHeader } from './components/BenchHeader';
import { BenchRail } from './components/BenchRail';
import { BenchRecoveryCard } from './components/BenchRecoveryCard';
import { BenchTabs } from './components/BenchTabs';
import { StageStrip } from './components/StageStrip';
import { ArtifactsTab } from './tabs/ArtifactsTab';
import { AssistantTab } from './tabs/AssistantTab';
import { ChangesTab } from './tabs/ChangesTab';
import { CostTab } from './tabs/CostTab';
import { FilesTab } from './tabs/FilesTab';
import { OverviewTab } from './tabs/OverviewTab';
import { PlanTab } from './tabs/PlanTab';
import { PreviewTab } from './tabs/PreviewTab';
import { TeamTab } from './tabs/TeamTab';
import { TerminalTab } from './tabs/TerminalTab';
import { type BenchTabId, BENCH_TABS } from './types';
import { useNarrowViewport } from './useNarrowViewport';

import './bench.css';

export default function BenchPage(): React.ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const { params } = useRoute();
  const client = useClient();
  const { setReady } = useDataReady();

  // Route parameters
  const routeProjectId = params.projectId || '';
  const routeRunId = params.runId || '';
  const routeTab = (params.tab || 'overview') as BenchTabId;
  const activeTab: BenchTabId = BENCH_TABS.includes(routeTab) ? routeTab : 'overview';

  // Primary data hooks
  const projectsHook = useProjects();
  const projectHook = useProject(routeProjectId || undefined);
  const runHook = useRun(routeRunId || undefined);

  // Resolved entities
  const run = runHook.data;
  const effectiveProjectId = run?.projectId || routeProjectId || projectsHook.data?.[0]?.id || '';
  const effectiveRunId = run?.id || routeRunId || '';

  // Secondary hooks based on effective IDs
  const activeProjectRunsHook = useRuns(effectiveProjectId || undefined);
  const eventsHook = useRunEvents(effectiveRunId || undefined);
  const gatesHook = useGates(effectiveRunId || undefined);
  const artifactsHook = useArtifacts(effectiveRunId || undefined);
  // Gate C evidence lives here, not in the tab, so switching tabs or coming back does not
  // throw away what the owner already paid for — and so the approve guard can see it.
  //
  // It is kept with the run it was collected for: the rail can move this same screen to
  // another run without remounting it, and evidence measured in run A is not evidence for
  // run B — neither to show on its Changes tab nor to unlock its Gate C.
  const [collectedEvidence, setCollectedEvidence] = useState<{
    runId: RunId;
    value: GateEvidence;
  } | null>(null);
  const evidence =
    collectedEvidence !== null && collectedEvidence.runId === run?.id
      ? collectedEvidence.value
      : null;
  const budgetHook = useBudget(effectiveProjectId || undefined);
  const rolesHook = useRoles();
  const modelsHook = useModels();
  const harnessesHook = useHarnesses();
  const filesHook = useFiles(effectiveProjectId || undefined);
  const agentHook = useAgent(effectiveRunId || undefined);
  const previewHook = usePreview(effectiveProjectId || undefined);

  // Runmodes state (retrieved from client.listRunModes)
  const [runModes, setRunModes] = useState<RunModeConfig[]>([]);
  useEffect(() => {
    if (!client) return;
    client
      .listRunModes()
      .then(setRunModes)
      .catch(() => {});
  }, [client]);

  // D4: the chosen mode for the NEXT run (plan / spec-file stop at GateB for
  // the owner's approval; agent runs straight through). Kept local — the mode
  // travels with the runs.start call, not with the project.
  const [newRunMode, setNewRunMode] = useState<'agent' | 'plan' | 'spec-file' | 'swarm'>('agent');

  // D5: the Swarm choice appears in the run-mode picker only when the active
  // project's `enable_swarm` is on (the setting default is off).
  const [swarmAvailable, setSwarmAvailable] = useState(false);
  useEffect(() => {
    if (!client || !effectiveProjectId) {
      setSwarmAvailable(false);
      return;
    }
    let cancelled = false;
    client
      .getSwarmSettings(effectiveProjectId as ProjectId)
      .then((settings) => {
        if (!cancelled) setSwarmAvailable(settings.enableSwarm);
      })
      .catch(() => {
        if (!cancelled) setSwarmAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, effectiveProjectId]);

  // Below 768px the rail leaves the layout and opens from a labelled button (planner decision 4): the
  // Workbench has no room for a 264px column beside the screen at 390, and squeezing the screen into
  // what is left produced the unusable captures the 2026-11-10 review rejected.
  const narrow = useNarrowViewport();
  const [railOpen, setRailOpen] = useState(false);
  const railOpenAction = useAction('bench.rail.open', async () => {
    setRailOpen(true);
  });

  // Aggregated runs per project for the rail
  const [runsByProject, setRunsByProject] = useState<Record<string, RunSummary[]>>({});

  useEffect(() => {
    if (effectiveProjectId && activeProjectRunsHook.data) {
      setRunsByProject((prev) => ({
        ...prev,
        [effectiveProjectId]: activeProjectRunsHook.data ?? [],
      }));
    }
  }, [effectiveProjectId, activeProjectRunsHook.data]);

  useEffect(() => {
    if (!client || !projectsHook.data) return;
    const projectsToFetch = projectsHook.data.filter((p) => p.id !== effectiveProjectId);
    for (const proj of projectsToFetch) {
      client
        .listRuns(proj.id)
        .then((runs) => {
          setRunsByProject((prev) => ({ ...prev, [proj.id]: runs }));
        })
        .catch(() => {});
    }
  }, [client, projectsHook.data, effectiveProjectId]);

  // Keep run and gate status in sync while a run is Running so stage timeouts,
  // cancellations, and watchdog reaping surface promptly without requiring user action.
  const { reload: reloadRun } = runHook;
  const { reload: reloadGates } = gatesHook;
  const { reload: reloadProjectRuns } = activeProjectRunsHook;

  useEffect(() => {
    if (!effectiveRunId || run?.status !== 'running') return;
    const interval = setInterval(() => {
      reloadRun();
      reloadGates();
      reloadProjectRuns();
    }, 2500);
    return () => clearInterval(interval);
  }, [effectiveRunId, run?.status, reloadRun, reloadGates, reloadProjectRuns]);

  const latestEventSeq = eventsHook.data?.[eventsHook.data.length - 1]?.seq;
  useEffect(() => {
    if (latestEventSeq !== undefined && run?.status === 'running') {
      reloadRun();
      reloadGates();
      reloadProjectRuns();
    }
  }, [latestEventSeq, run?.status, reloadRun, reloadGates, reloadProjectRuns]);

  // Primary loading & readiness contract (main[data-ready="true"])
  const isPrimarySettled =
    (projectsHook.status !== 'loading' && (runHook.status !== 'loading' || !routeRunId)) ||
    Boolean(run);

  useEffect(() => {
    setReady(isPrimarySettled);
    return () => setReady(true);
  }, [isPrimarySettled, setReady]);

  // Actions wired to useAction
  const startNewRunAction = useAction(
    'bench.run.start',
    async (
      pId: string,
      idea: string,
      runMode?: 'agent' | 'plan' | 'spec-file' | 'ask' | 'swarm'
    ) => {
      if (!client) return;
      // D5: a swarm run is an agent run in a swarm-enabled project — the
      // daemon's Code stage decomposes it into subtasks. There is no separate
      // wire mode; the project setting carries the behaviour.
      const wireMode = runMode === 'swarm' ? 'agent' : runMode;
      const newRun = await client.startRun(
        pId as ProjectId,
        idea || t('bench.header.new_run'),
        wireMode ?? 'agent'
      );
      runHook.reload();
      activeProjectRunsHook.reload();
      navigate(`/p/${pId}/r/${newRun.id}/${activeTab}`);
    }
  );

  const [isRetrying, setIsRetrying] = useState(false);

  const handleRecoveryRetry = async (_model: string, engine: string) => {
    if (!client) return;
    setIsRetrying(true);
    try {
      if (engine) {
        await client.setBackendRouting({
          default_backend: engine === 'native' ? null : engine,
        });
      }
      const pId = (effectiveProjectId || 'default') as ProjectId;
      const newRun = await client.startRun(pId, t('bench.header.new_run'), 'agent');
      runHook.reload();
      activeProjectRunsHook.reload();
      navigate(`/p/${pId}/r/${newRun.id}/${activeTab}`);
    } finally {
      setIsRetrying(false);
    }
  };

  const advanceRunAction = useAction('bench.run.advance', async (rId: string) => {
    if (!client) return;
    await client.advanceRun(rId as RunId);
    runHook.reload();
    gatesHook.reload();
    eventsHook.reload();
  });

  const cancelRunAction = useAction(
    'bench.run.cancel.confirm',
    async (rId: string, reason?: string) => {
      if (!client) return;
      await client.cancelRun(rId as RunId, reason);
      runHook.reload();
      eventsHook.reload();
    }
  );

  const approveGateAction = useAction('bench.gate.approve', async (rId: string, stage: string) => {
    if (!client) return;
    // Desktop-only guard (OD-B3, R-BRIDGE-B2): the owner decides Gate C on evidence, so the
    // screen refuses to approve that gate until this session has collected some. The daemon
    // does not enforce this and no setting turns it on — it is a UI rule, labelled as such
    // in the card (`bench.evidence.approve_guard`), and it guards nothing else.
    if (stage === 'gate_c' && evidence === null) {
      throw new Error(t('bench.evidence.approve_guard'));
    }
    await client.approveGate(rId as RunId, stage as never);
    await client.advanceRun(rId as RunId);
    runHook.reload();
    gatesHook.reload();
    eventsHook.reload();
  });

  const changesGateAction = useAction(
    'bench.gate.changes.send',
    async (rId: string, stage: string, notes: string) => {
      if (!client) return;
      await client.requestChanges(rId as RunId, stage as never, notes);
      gatesHook.reload();
      eventsHook.reload();
    }
  );

  const rejectGateAction = useAction(
    'bench.gate.reject.confirm',
    async (rId: string, stage: string, reason: string) => {
      if (!client) return;
      await client.rejectGate(rId as RunId, stage as never, reason);
      gatesHook.reload();
      eventsHook.reload();
    }
  );

  const followupAction = useAction('bench.followup.send', async (promptText: string) => {
    if (!client || !effectiveRunId) return;
    await client.followupRun(effectiveRunId as RunId, promptText);
    eventsHook.reload();
  });

  const harnessSelectAction = useAction('bench.harness.select', async (hId: string) => {
    if (!client) return;
    await client.selectHarness(hId, effectiveProjectId || undefined);
    harnessesHook.reload();
  });

  const runmodeSetAction = useAction('bench.runmode.set', async (config: RunModeConfig) => {
    if (!client) return;
    await client.setRunMode(config);
    const updated = await client.listRunModes();
    setRunModes(updated);
  });

  const budgetSaveAction = useAction('bench.budget.save', async (cents: number) => {
    if (!client || !effectiveProjectId) return;
    await client.setProjectBudget(effectiveProjectId as ProjectId, cents);
    budgetHook.reload();
  });

  const previewStartAction = useAction('bench.preview.start', async () => {
    if (!client || !effectiveProjectId) return;
    await client.startPreview(effectiveProjectId, 'npm run dev');
    previewHook.reload();
  });

  const previewStopAction = useAction('bench.preview.stop', async () => {
    if (!client || !effectiveProjectId) return;
    await client.stopPreview(effectiveProjectId);
    previewHook.reload();
  });

  const assistantSendAction = useAction('bench.assistant.send', async (text: string) => {
    if (!client || !effectiveRunId) return undefined;
    return client.agentTurn(effectiveRunId, text);
  });

  const assistantPlanModeAction = useAction('bench.assistant.mode.plan', async () => {
    if (!client) return;
    await client.returnAgentToPlanMode(effectiveRunId || undefined);
    agentHook.reload();
  });

  const assistantAgentModeAction = useAction('bench.assistant.mode.agent', async () => {
    if (!client) return;
    await client.approveAgentMode(effectiveRunId || undefined);
    agentHook.reload();
  });

  const teamModelSetAction = useAction(
    'bench.team.model.set',
    async (role: Role, providerId: string, modelId: string) => {
      if (!client) return;
      const existingRouting = rolesHook.data?.find((r) => canonicalRoleKey(r.role) === role);
      const newConfig = {
        role,
        targets: [{ provider_id: providerId, model_id: modelId, weight: 100 }],
        fallback_enabled: existingRouting?.fallback_enabled ?? false,
        budget_cents_per_run: existingRouting?.budget_cents_per_run ?? 0,
        daily_spend_cap_cents: existingRouting?.daily_spend_cap_cents ?? null,
      };
      await client.setRoleConfig(newConfig);
      rolesHook.reload();
    }
  );

  const handleTabChange = (newTab: BenchTabId) => {
    navigate(`/p/${effectiveProjectId}/r/${effectiveRunId}/${newTab}`);
  };

  const handleSelectRun = (pId: string, rId: string) => {
    setRailOpen(false);
    navigate(`/p/${pId}/r/${rId}/${activeTab}`);
  };

  /** The rail's props for one run selection, shared by the inline rail and the narrow Sheet. */
  const railProps = (activeRunId: string) => ({
    projects: projectsHook.data ?? [],
    projectsStatus: projectsHook.status,
    runsByProject,
    activeProjectId: effectiveProjectId,
    activeRunId,
    onNewProject: () => navigate('/'),
    onSelectRun: handleSelectRun,
    onRetryProjects: () => projectsHook.reload(),
  });

  /**
   * Where the rail goes: in the layout at 768px and up, behind one labelled button below it.
   * The button is the action `bench.rail.open`; the Sheet owns focus, Escape and the return.
   */
  const renderRail = (activeRunId: string): React.ReactElement =>
    narrow ? (
      <div className="v3-bench-rail-opener">
        <Button
          variant="secondary"
          size="sm"
          icon={<IconFolder size={16} />}
          data-action="bench.rail.open"
          data-testid="bench-rail-open-btn"
          onClick={() => {
            void railOpenAction.run();
          }}
        >
          {t('bench.rail.open')}
        </Button>
      </div>
    ) : (
      <BenchRail {...railProps(activeRunId)} />
    );

  const handleReconnect = () => {
    eventsHook.reload();
    runHook.reload();
    gatesHook.reload();
  };

  const handlePreviewOpen = () => {
    if (previewHook.data?.url && typeof window !== 'undefined') {
      window.open(previewHook.data.url, '_blank');
    }
  };

  // Amendment (b): current stage gate waiting
  const isWaitingCurrentGate = useMemo(() => {
    if (!run || !gatesHook.data) return false;
    return gatesHook.data.some(
      (g) => g.stage === run.stage && 'state' in g.state && g.state.state === 'pending'
    );
  }, [run, gatesHook.data]);

  // Loading presentation
  if (!isPrimarySettled) {
    return (
      <div
        data-testid="bench-loading"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w-space-4)',
          padding: 'var(--w-space-4)',
        }}
      >
        <Skeleton height="var(--w-space-10)" />
        <Skeleton height="var(--w-space-8)" />
        <Skeleton height="var(--w-space-10)" />
      </div>
    );
  }

  // Error presentation
  if (runHook.status === 'error' && !run) {
    return (
      <div
        style={{
          padding: 'var(--w-space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w-space-4)',
        }}
        data-testid="bench-error"
      >
        <Banner
          variant="danger"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={handleReconnect}
              data-action="bench.stream.reconnect"
            >
              {t('bench.retry')}
            </Button>
          }
        >
          {runHook.error?.message || t('bench.error')}
        </Banner>
        <BenchRecoveryCard onRetry={handleRecoveryRetry} isRetrying={isRetrying} />
      </div>
    );
  }

  // Empty run presentation (no run for project)
  if (!run) {
    return (
      <div
        className="v3-bench-container"
        data-density="compact"
        data-narrow={narrow ? 'true' : 'false'}
        data-testid="bench-empty"
      >
        {renderRail('')}
        {narrow && (
          <Sheet
            open={railOpen}
            onClose={() => setRailOpen(false)}
            title={t('bench.rail.title')}
            closeLabel={t('common.close')}
            side="start"
            data-testid="bench-rail-sheet"
          >
            <BenchRail {...railProps('')} />
          </Sheet>
        )}
        <div className="v3-bench-main">
          <Banner
            variant="info"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void startNewRunAction.run(effectiveProjectId, t('bench.header.new_run'))
                }
                data-action="bench.run.start"
              >
                {t('bench.header.new_run')}
              </Button>
            }
          >
            {t('bench.empty')}
          </Banner>
        </div>
      </div>
    );
  }

  return (
    <div
      className="v3-bench-container"
      data-density="compact"
      data-narrow={narrow ? 'true' : 'false'}
      data-testid="bench-container"
    >
      {renderRail(run.id)}
      {narrow && (
        <Sheet
          open={railOpen}
          onClose={() => setRailOpen(false)}
          title={t('bench.rail.title')}
          closeLabel={t('common.close')}
          side="start"
          data-testid="bench-rail-sheet"
        >
          <BenchRail {...railProps(run.id)} />
        </Sheet>
      )}

      <div className="v3-bench-main" data-testid="bench-main">
        <BenchHeader
          project={projectHook.data}
          run={run}
          gates={gatesHook.data ?? []}
          onAdvance={() => void advanceRunAction.run(run.id)}
          advancePending={advanceRunAction.pending}
          onStartNewRun={() => void startNewRunAction.run(run.projectId, t('bench.header.new_run'))}
          startPending={startNewRunAction.pending}
          onCancelRun={(reason) => void cancelRunAction.run(run.id, reason)}
          cancelPending={cancelRunAction.pending}
          onReconnect={handleReconnect}
        />

        <StageStrip
          currentStage={run.stage as DaemonStage}
          isWaitingGate={isWaitingCurrentGate}
          isFailed={run.status === 'failed'}
        />

        <BenchTabs activeTab={activeTab} onChange={handleTabChange} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {activeTab === 'overview' && (
            <OverviewTab
              run={run}
              gates={gatesHook.data ?? []}
              events={eventsHook.data ?? []}
              artifacts={artifactsHook.data ?? []}
              onApproveGate={(stage) => void approveGateAction.run(run.id, stage)}
              approvePending={approveGateAction.pending}
              onRequestChanges={(notes) => void changesGateAction.run(run.id, run.stage, notes)}
              changesPending={changesGateAction.pending}
              onRejectGate={(reason) => void rejectGateAction.run(run.id, run.stage, reason)}
              rejectPending={rejectGateAction.pending}
              onRecoveryRetry={handleRecoveryRetry}
              isRetrying={isRetrying}
            />
          )}

          {activeTab === 'plan' && <PlanTab artifacts={artifactsHook.data ?? []} />}

          {activeTab === 'files' && (
            <FilesTab
              projectId={run.projectId}
              files={filesHook.data ?? []}
              status={filesHook.status}
              onReload={() => filesHook.reload()}
            />
          )}

          {activeTab === 'changes' && (
            <ChangesTab
              runId={run.id}
              runStage={run.stage}
              artifacts={artifactsHook.data ?? []}
              evidence={evidence}
              onCollectEvidence={async (program, args) => {
                if (!client) throw new Error(t('bench.evidence.error_failed'));
                // The one `gates.evidence` call in this screen: an Owner / Spend action,
                // taken only from the card's button (OD-B3 — never on mount, reload or switch).
                const collected = await client.gateEvidence(run.id as RunId, program, args);
                setCollectedEvidence({ runId: run.id as RunId, value: collected });
                return collected;
              }}
              onOpenFile={() => {
                // Each changed path opens the Files tab, where the tree is; the path itself is
                // the button's text, and the tab carries no per-file selection to deep-link to.
                navigate(`/p/${run.projectId}/r/${run.id}/files`);
              }}
            />
          )}

          {activeTab === 'terminal' && <TerminalTab events={eventsHook.data ?? []} />}

          {activeTab === 'team' && (
            <TeamTab
              roles={rolesHook.data ?? []}
              models={modelsHook.data ?? []}
              events={eventsHook.data ?? []}
              onSetRoleModel={(role, pId, mId) => void teamModelSetAction.run(role, pId, mId)}
            />
          )}

          {activeTab === 'assistant' && (
            <AssistantTab
              agentState={agentHook.data}
              status={agentHook.status}
              onSendTurn={async (text) => assistantSendAction.run(text)}
              sendPending={assistantSendAction.pending}
              onSwitchToPlan={() => void assistantPlanModeAction.run()}
              planPending={assistantPlanModeAction.pending}
              onSwitchToAgent={() => void assistantAgentModeAction.run()}
              agentPending={assistantAgentModeAction.pending}
              onReload={() => agentHook.reload()}
            />
          )}

          {activeTab === 'cost' && (
            <CostTab
              budget={budgetHook.data}
              status={budgetHook.status}
              events={eventsHook.data ?? []}
              onSaveBudget={(cents) => void budgetSaveAction.run(cents)}
              savePending={budgetSaveAction.pending}
              onReload={() => budgetHook.reload()}
            />
          )}

          {activeTab === 'artifacts' && <ArtifactsTab artifacts={artifactsHook.data ?? []} />}

          {activeTab === 'preview' && (
            <PreviewTab
              preview={previewHook.data}
              onStart={() => void previewStartAction.run()}
              startPending={previewStartAction.pending}
              onStop={() => void previewStopAction.run()}
              stopPending={previewStopAction.pending}
              onOpen={handlePreviewOpen}
            />
          )}
        </div>

        <AdvancedComposer
          harnesses={harnessesHook.data ?? []}
          runModes={runModes}
          budgetUsd={budgetHook.data?.totalBudgetUsd ?? 0}
          onSendFollowup={(promptText) => void followupAction.run(promptText)}
          followupPending={followupAction.pending}
          onSelectHarness={(hId) => void harnessSelectAction.run(hId)}
          harnessPending={harnessSelectAction.pending}
          onSetRunMode={(cfg) => void runmodeSetAction.run(cfg)}
          runModePending={runmodeSetAction.pending}
          onSaveBudget={(cents) => void budgetSaveAction.run(cents)}
          budgetPending={budgetSaveAction.pending}
          // D4: the run-MODE picker for new runs — separate from the view-mode
          // switch and from the listen-mode runmode select above.
          runModeChoice={newRunMode}
          swarmAvailable={swarmAvailable}
          onRunModeChoice={setNewRunMode}
          onStartRun={(idea) => void startNewRunAction.run(effectiveProjectId, idea, newRunMode)}
        />
      </div>
    </div>
  );
}
