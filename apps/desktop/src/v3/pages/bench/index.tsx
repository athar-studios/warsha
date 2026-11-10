import type {
  ProjectId,
  Role,
  RunId,
  RunModeConfig,
  RunSummary,
} from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
// eslint-disable-next-line import/no-unresolved
import { Banner, Button, Skeleton } from '@warsha/ui/v3';
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
  const budgetHook = useBudget(effectiveProjectId || undefined);
  const rolesHook = useRoles();
  const modelsHook = useModels();
  const harnessesHook = useHarnesses();
  const filesHook = useFiles(effectiveProjectId || undefined);
  const agentHook = useAgent();
  const previewHook = usePreview(effectiveProjectId || undefined);

  // Runmodes state (retrieved from client.listRunModes)
  const [runModes, setRunModes] = useState<RunModeConfig[]>([]);
  useEffect(() => {
    if (!client) return;
    client.listRunModes().then(setRunModes).catch(() => {});
  }, [client]);

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

  // Primary loading & readiness contract (main[data-ready="true"])
  const isPrimarySettled =
    (projectsHook.status !== 'loading' && (runHook.status !== 'loading' || !routeRunId)) ||
    Boolean(run);

  useEffect(() => {
    setReady(isPrimarySettled);
    return () => setReady(true);
  }, [isPrimarySettled, setReady]);

  // Actions wired to useAction
  const startNewRunAction = useAction('bench.run.start', async (pId: string, idea: string) => {
    if (!client) return;
    const newRun = await client.startRun(pId as ProjectId, idea || t('bench.header.new_run'));
    runHook.reload();
    activeProjectRunsHook.reload();
    navigate(`/p/${pId}/r/${newRun.id}/${activeTab}`);
  });

  const advanceRunAction = useAction('bench.run.advance', async (rId: string) => {
    if (!client) return;
    await client.advanceRun(rId as RunId);
    runHook.reload();
    gatesHook.reload();
    eventsHook.reload();
  });

  const cancelRunAction = useAction('bench.run.cancel.confirm', async (rId: string, reason?: string) => {
    if (!client) return;
    await client.cancelRun(rId as RunId, reason);
    runHook.reload();
    eventsHook.reload();
  });

  const approveGateAction = useAction('bench.gate.approve', async (rId: string, stage: string) => {
    if (!client) return;
    await client.approveGate(rId as RunId, stage as never);
    await client.advanceRun(rId as RunId);
    runHook.reload();
    gatesHook.reload();
    eventsHook.reload();
  });

  const changesGateAction = useAction('bench.gate.changes.send', async (rId: string, stage: string, notes: string) => {
    if (!client) return;
    await client.requestChanges(rId as RunId, stage as never, notes);
    gatesHook.reload();
    eventsHook.reload();
  });

  const rejectGateAction = useAction('bench.gate.reject.confirm', async (rId: string, stage: string, reason: string) => {
    if (!client) return;
    await client.rejectGate(rId as RunId, stage as never, reason);
    gatesHook.reload();
    eventsHook.reload();
  });

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
    if (!client) return undefined;
    return client.agentTurn(text);
  });

  const assistantPlanModeAction = useAction('bench.assistant.mode.plan', async () => {
    if (!client) return;
    await client.returnAgentToPlanMode();
    agentHook.reload();
  });

  const assistantAgentModeAction = useAction('bench.assistant.mode.agent', async () => {
    if (!client) return;
    await client.approveAgentMode();
    agentHook.reload();
  });

  const teamModelSetAction = useAction(
    'bench.team.model.set',
    async (role: Role, providerId: string, modelId: string) => {
      if (!client) return;
      const existingRouting = rolesHook.data?.find((r) => r.role === role);
      const newConfig = {
        role,
        targets: [{ provider_id: providerId, model_id: modelId, weight: 100 }],
        fallback_enabled: existingRouting?.fallback_enabled ?? false,
        budget_cents_per_run: existingRouting?.budget_cents_per_run ?? 0,
      };
      await client.setRoleConfig(newConfig);
      rolesHook.reload();
    }
  );

  const handleTabChange = (newTab: BenchTabId) => {
    navigate(`/p/${effectiveProjectId}/r/${effectiveRunId}/${newTab}`);
  };

  const handleSelectRun = (pId: string, rId: string) => {
    navigate(`/p/${pId}/r/${rId}/${activeTab}`);
  };

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
      <div style={{ padding: 'var(--w-space-4)' }} data-testid="bench-error">
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
      </div>
    );
  }

  // Empty run presentation (no run for project)
  if (!run) {
    return (
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          minHeight: 'calc(100vh - var(--w-space-10))',
          boxSizing: 'border-box',
        }}
        data-testid="bench-empty"
      >
        <BenchRail
          projects={projectsHook.data ?? []}
          projectsStatus={projectsHook.status}
          runsByProject={runsByProject}
          activeProjectId={effectiveProjectId}
          activeRunId=""
          onNewProject={() => navigate('/')}
          onSelectRun={handleSelectRun}
          onRetryProjects={() => projectsHook.reload()}
        />
        <div style={{ flex: '999 1 0%', minInlineSize: '60%', padding: 'var(--w-space-4)' }}>
          <Banner
            variant="info"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void startNewRunAction.run(effectiveProjectId, t('bench.header.new_run'))}
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
      data-testid="bench-container"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        minHeight: 'calc(100vh - var(--w-space-10))',
        backgroundColor: 'var(--w-bg)',
        color: 'var(--w-text)',
        fontFamily: 'var(--w-font-sans)',
        boxSizing: 'border-box',
      }}
    >
      <BenchRail
        projects={projectsHook.data ?? []}
        projectsStatus={projectsHook.status}
        runsByProject={runsByProject}
        activeProjectId={effectiveProjectId}
        activeRunId={run.id}
        onNewProject={() => navigate('/')}
        onSelectRun={handleSelectRun}
        onRetryProjects={() => projectsHook.reload()}
      />

      <div
        className="v3-bench-main"
        data-testid="bench-main"
        style={{
          flex: '999 1 0%',
          minInlineSize: '60%',
          minWidth: 0,
          padding: 'var(--w-space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w-space-3)',
          boxSizing: 'border-box',
        }}
      >
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
            />
          )}

          {activeTab === 'plan' && (
            <PlanTab artifacts={artifactsHook.data ?? []} />
          )}

          {activeTab === 'files' && (
            <FilesTab
              projectId={run.projectId}
              files={filesHook.data ?? []}
              status={filesHook.status}
              onReload={() => filesHook.reload()}
            />
          )}

          {activeTab === 'changes' && (
            <ChangesTab runId={run.id} artifacts={artifactsHook.data ?? []} />
          )}

          {activeTab === 'terminal' && (
            <TerminalTab events={eventsHook.data ?? []} />
          )}

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

          {activeTab === 'artifacts' && (
            <ArtifactsTab artifacts={artifactsHook.data ?? []} />
          )}

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
        />
      </div>
    </div>
  );
}
