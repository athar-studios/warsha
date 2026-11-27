import {
  canonicalRoleKey,
  type AuthStatus,
  type CostEstimate,
  type GateSummary,
  type GithubStatus,
  type ProjectId,
  type ProjectSummary,
  type ProviderConfig,
  type RoleRouting,
  type RunSummary,
} from '@warsha/client';
import { useLocale, useT } from '@warsha/i18n/v3';
import {
  Banner,
  BudgetField,
  Button,
  DataTable,
  Dialog,
  IconSend,
  Sheet,
  Skeleton,
  StatusPill,
  TextArea,
  TextField,
  type DataTableColumn,
  type StatusPillState,
} from '@warsha/ui/v3';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { formatRelativeDurationLocalized } from '../../../date';
import { useAction } from '../../actions';
import { useCapabilities } from '../../app/CapabilitiesContext';
import { useClient } from '../../app/ClientContext';
import { useDataReady } from '../../app/DataReadyContext';
import { useDensity } from '../../app/DensityContext';
import {
  MAX_DEFAULT_BUDGET_USD,
  parseDefaultBudget,
  writeDefaultBudget,
} from '../../app/defaultBudget';
import { notify } from '../../app/toast';
import { getSimpleStageLabelKey, toSimpleStage, type SimpleStage } from '../../copy/stages';
import { useDefaultBudget, useModels, useProjects, useQuotaGauge, useRoles } from '../../data';
import { markInterviewEntry } from '../../data/interviewEntry';
import { describeRpcError, type DescribedRpcError } from '../../data/rpcErrors';
import { useResource } from '../../data/useResource';
import { useNavigate } from '../../router';
import { RunModeChip, toRunModeChip } from '../bench/components/RunModeChip';
import { countPendingGatesAtCurrentStage } from '../frame/Frame';
import SecretaryChat from '../project/SecretaryChat';

import {
  INITIAL_PROJECT_SOURCE,
  ProjectSourcePicker,
  resolveProjectSource,
  SourceConfirmPanel,
  validateProjectSource,
  type ProjectSourceValue,
  type SourceConfirmRequest,
} from './ProjectSourcePicker';
import {
  ownerAlerts,
  raisedKeysAfter,
  type OwnerAlert,
  GATE_WAIT_THRESHOLD_MINUTES,
  QUOTA_NEAR_PERCENT,
  SPEND_NEAR_PERCENT,
} from './alerts';

import './home.css';

export type MiniSegmentState = 'done' | 'current' | 'waiting' | 'failed' | 'todo';

export const EXAMPLE_CHIP_KEYS = [
  'home.example_1',
  'home.example_2',
  'home.example_3',
  'home.example_4',
] as const;

export function deriveProjectName(idea: string): string {
  const trimmed = idea.trim();
  if (!trimmed) return '';
  const firstLine = trimmed.split('\n')[0].trim();
  return firstLine.slice(0, 60);
}

export interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit?: (name: string, idea: string, repoPath?: string, repoUrl?: string) => Promise<void>;
  /** DEFECT 2(a): mirrors the composer's provider-warning gate for the create button. */
  startBlocked?: boolean;
  startBlockedReason?: string;
}

/** Thrown when the source probe needs the git-init confirmation first. */
class ConfirmNeeded extends Error {}

export function NewProjectDialog({
  open,
  onClose,
  onSubmit,
  startBlocked = false,
  startBlockedReason,
}: NewProjectDialogProps): React.ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const client = useClient();
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const [sourceValue, setSourceValue] = useState<ProjectSourceValue>(INITIAL_PROJECT_SOURCE);
  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<DescribedRpcError | string | null>(null);
  const [confirm, setConfirm] = useState<SourceConfirmRequest | null>(null);
  const [pendingMeta, setPendingMeta] = useState<{
    projectName: string;
    trimmedIdea: string;
  } | null>(null);

  const githubCreateBlocked =
    sourceValue.mode === 'github_create' && !githubStatus?.configured;

  const resetDialog = (): void => {
    setName('');
    setIdea('');
    setSourceValue(INITIAL_PROJECT_SOURCE);
    setConfirm(null);
    setPendingMeta(null);
  };

  const createWithRepo = async (
    projectName: string,
    trimmedIdea: string,
    repoPath?: string,
    repoUrl?: string
  ): Promise<void> => {
    if (!client) return;
    if (onSubmit) {
      await onSubmit(projectName, trimmedIdea, repoPath, repoUrl);
      return;
    }
    if (repoUrl) {
      await client.createProject(projectName, trimmedIdea, locale, repoPath, repoUrl);
    } else if (repoPath) {
      await client.createProject(projectName, trimmedIdea, locale, repoPath);
    } else {
      await client.createProject(projectName, trimmedIdea, locale);
    }
  };

  const handleConfirmAccept = async (): Promise<void> => {
    if (!client || !confirm || !pendingMeta) return;
    setSubmitting(true);
    setError(null);
    try {
      const prepared =
        confirm.mode === 'new_folder'
          ? await client.prepareProjectFolder(confirm.parentDir, confirm.folderName)
          : await client.prepareExistingFolder(confirm.targetPath);
      await createWithRepo(
        pendingMeta.projectName,
        pendingMeta.trimmedIdea,
        prepared.repoPath,
        undefined
      );
      resetDialog();
      onClose();
    } catch (err) {
      setError(describeRpcError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmCancel = (): void => {
    setConfirm(null);
    setPendingMeta(null);
  };

  const handleSubmit = async () => {
    const trimmedIdea = idea.trim();
    if (!trimmedIdea || startBlocked) return;
    const validationError = validateProjectSource(sourceValue, githubStatus, t);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    setConfirm(null);
    setPendingMeta(null);
    try {
      const projectName = name.trim() || deriveProjectName(trimmedIdea);
      if (onSubmit) {
        if (!client) {
          await onSubmit(projectName, trimmedIdea, undefined, undefined);
        } else {
          const resolved = await resolveProjectSource(client, sourceValue);
          if (resolved.kind === 'confirm-init') {
            setConfirm({
              targetPath: resolved.targetPath,
              mode: sourceValue.mode,
              parentDir: sourceValue.parentDir.trim(),
              folderName: sourceValue.folderName.trim(),
            });
            setPendingMeta({ projectName, trimmedIdea });
            return;
          }
          await onSubmit(projectName, trimmedIdea, resolved.repoPath, resolved.repoUrl);
        }
      } else if (client) {
        const resolved = await resolveProjectSource(client, sourceValue);
        if (resolved.kind === 'confirm-init') {
          setConfirm({
            targetPath: resolved.targetPath,
            mode: sourceValue.mode,
            parentDir: sourceValue.parentDir.trim(),
            folderName: sourceValue.folderName.trim(),
          });
          setPendingMeta({ projectName, trimmedIdea });
          return;
        }
        if (resolved.repoUrl) {
          await client.createProject(
            projectName,
            trimmedIdea,
            locale,
            resolved.repoPath,
            resolved.repoUrl
          );
        } else if (resolved.repoPath) {
          await client.createProject(projectName, trimmedIdea, locale, resolved.repoPath);
        } else {
          await client.createProject(projectName, trimmedIdea, locale);
        }
      }
      resetDialog();
      onClose();
    } catch (err) {
      setError(describeRpcError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('home.new_project_dialog_title')}
      description={t('home.new_project_dialog_desc')}
      closeLabel={t('common.close')}
      data-testid="new-project-dialog"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
        {error && (
          <Banner variant="danger" title={typeof error === 'string' ? error : t(error.key)}>
            {typeof error === 'string' ? null : error.detail ? (
              <span dir="auto">{error.detail}</span>
            ) : null}
          </Banner>
        )}
        <TextField
          label={t('home.project_name_label')}
          placeholder={t('home.project_name_placeholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="new-project-name-input"
        />
        <TextArea
          label={t('home.idea_label')}
          placeholder={t('home.idea_placeholder')}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          rows={3}
          data-testid="new-project-idea-input"
        />
        <ProjectSourcePicker
          value={sourceValue}
          onChange={(next) => {
            setError(null);
            setConfirm(null);
            setPendingMeta(null);
            setSourceValue(next);
          }}
          client={client}
          t={t}
          githubStatus={githubStatus}
          onGithubStatusChange={setGithubStatus}
          onOpenIntegrations={() => {
            onClose();
            navigate('/settings/integrations');
          }}
          disabled={submitting}
          idPrefix="new-project-source"
        />
        {confirm && (
          <SourceConfirmPanel
            idPrefix="new-project-source"
            targetPath={confirm.targetPath}
            t={t}
            pending={submitting}
            onAccept={() => void handleConfirmAccept()}
            onCancel={handleConfirmCancel}
          />
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--w-space-2)',
            marginBlockStart: 'var(--w-space-2)',
          }}
        >
          <Button
            variant="secondary"
            data-action="home.new-project.cancel"
            onClick={onClose}
            disabled={submitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            data-action="home.new-project.submit"
            onClick={() => void handleSubmit()}
            disabled={!idea.trim() || submitting || githubCreateBlocked || startBlocked}
            disabledReason={startBlocked ? startBlockedReason : undefined}
            loading={submitting}
            data-testid="new-project-submit-btn"
          >
            {t('home.new_project_submit')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function findCoordinatorModel(
  roles: readonly RoleRouting[] | null | undefined,
  models: readonly { modelId: string; displayName: string | null }[] | null | undefined
): string | null {
  if (!roles || roles.length === 0) {
    return models?.[0]?.displayName || models?.[0]?.modelId || null;
  }
  const coordinatorRole =
    roles.find((r) => canonicalRoleKey(r.role) === 'intake') ??
    roles.find((r) => canonicalRoleKey(r.role) === 'pm') ??
    roles[0];
  const target = coordinatorRole?.targets?.[0];
  if (!target) {
    return models?.[0]?.displayName || models?.[0]?.modelId || null;
  }
  const matchingModel = models?.find((m) => m.modelId === target.model_id);
  return matchingModel?.displayName || target.model_id;
}

export function findDefaultBudget(
  preferences: readonly { key: string; score: number }[] | null | undefined
): number {
  if (!preferences || preferences.length === 0) return 10;
  const pref = preferences.find((p) => p.key === 'default_budget_usd');
  if (!pref) return 10;
  const val = Number(pref.score);
  return Number.isFinite(val) && val > 0 ? val : 10;
}

export function computeProjectStatus(
  runs: readonly RunSummary[] | undefined,
  waitingGatesCount: number
): { status: StatusPillState; stageKey: string; summaryKey: string } {
  if (!runs || runs.length === 0) {
    return {
      status: 'idle',
      stageKey: 'stages.idea',
      summaryKey: 'home.summary_idle',
    };
  }

  const latestRun = runs[0];
  const stageKey = getSimpleStageLabelKey(latestRun.stage);

  if (waitingGatesCount > 0 || latestRun.status === 'awaiting_gate') {
    return {
      status: 'waiting',
      stageKey,
      summaryKey: 'home.summary_waiting',
    };
  }

  if (latestRun.status === 'running') {
    return {
      status: 'running',
      stageKey,
      summaryKey: 'home.summary_running',
    };
  }

  if (latestRun.status === 'completed') {
    return {
      status: 'done',
      stageKey,
      summaryKey: 'home.summary_done',
    };
  }

  if (latestRun.status === 'failed') {
    return {
      status: 'failed',
      stageKey,
      summaryKey: 'home.summary_failed',
    };
  }

  if (latestRun.status === 'cancelled') {
    return {
      status: 'cancelled',
      stageKey,
      summaryKey: 'home.summary_cancelled',
    };
  }

  if (latestRun.status === 'paused') {
    return {
      status: 'paused',
      stageKey,
      summaryKey: 'home.summary_paused',
    };
  }

  return {
    status: 'idle',
    stageKey,
    summaryKey: 'home.summary_idle',
  };
}

export function computeMiniSegments(
  runs: readonly RunSummary[] | undefined,
  waitingGatesCount: number
): MiniSegmentState[] {
  const STAGES: readonly SimpleStage[] = ['idea', 'plan', 'build', 'qa', 'delivery'];
  if (!runs || runs.length === 0) {
    return ['current', 'todo', 'todo', 'todo', 'todo'];
  }

  const latestRun = runs[0];
  const currentSimple = toSimpleStage(latestRun.stage);
  const currentIndex = STAGES.indexOf(currentSimple);

  return STAGES.map((_, idx) => {
    if (idx < currentIndex) {
      return 'done';
    }
    if (idx === currentIndex) {
      if (waitingGatesCount > 0 || latestRun.status === 'awaiting_gate') {
        return 'waiting';
      }
      if (latestRun.status === 'completed') {
        return 'done';
      }
      if (latestRun.status === 'failed') {
        return 'failed';
      }
      return 'current';
    }
    return 'todo';
  });
}

/** One row of the home needs-you strip: a gate wait or an approval ask, oldest first. */
export interface NeedsYouRow {
  key: string;
  kind: 'gate' | 'ask' | 'failed';
  /** Stable i18n label: `home.needsyou.gate` / `home.needsyou.ask`. */
  labelKey: string;
  /** What waits: the gate's stage word, or the ask's tool name. */
  subject: string;
  /** The run the row belongs to. */
  runId: string;
  projectId: ProjectId | null;
  projectName?: string;
  /** RFC 3339 the row started waiting; oldest first is the strip's order. */
  since: string;
  /** Navigate target for the row's Open button. */
  href: string;
}

/**
 * E2: merge gate waits with approval asks into one longest-waiting-first strip.
 * A gate's waiting time is its run's `updatedAt` (the daemon's last change to the run row,
 * which for a parked run is the gate's arrival); an ask carries its own `requestedAt`.
 */
export function buildNeedsYou(
  t: (key: string, vars?: Record<string, string | number>) => string,
  runs: readonly RunSummary[],
  gatesByRun: Readonly<
    Record<
      string,
      {
        runId: string;
        projectId: ProjectId;
        runUpdatedAt: string;
        stage: string;
        pending: boolean;
      }[]
    >
  >,
  asks: readonly {
    id: string;
    runId: string;
    projectId: ProjectId | null;
    tool: string;
    requestedAt: string;
  }[],
  projects: readonly ProjectSummary[] = []
): NeedsYouRow[] {
  const rows: NeedsYouRow[] = [];
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  for (const run of runs) {
    if (run.status === 'completed' || run.status === 'cancelled') {
      continue;
    }
    if (run.status === 'failed') {
      rows.push({
        key: `failed-${run.id}`,
        kind: 'failed',
        labelKey: 'home.status_failed',
        subject: projectNames.get(run.projectId) ?? t('home.project_unnamed'),
        runId: run.id,
        projectId: run.projectId,
        projectName: projectNames.get(run.projectId),
        since: run.updatedAt,
        href: `/p/${run.projectId}/r/${run.id}`,
      });
      continue;
    }
    const pending = gatesByRun[run.id] ?? [];
    for (const gate of pending) {
      if (!gate.pending || gate.stage !== run.stage) continue;
      const projectName = projectNames.get(run.projectId) ?? t('home.project_unnamed');
      const gateName = t(`bench.stage.${gate.stage}`);
      const subjectKey = 'home.needsyou.gate_subject';
      const translated = t(subjectKey, {
        project: projectName,
        run: run.id,
        gate: gateName,
      });
      const subject =
        translated === subjectKey ? `${projectName} · ${run.id} · ${gateName}` : translated;
      rows.push({
        key: `gate-${run.id}-${gate.stage}`,
        kind: 'gate',
        labelKey: 'home.needsyou.gate',
        subject,
        runId: run.id,
        projectId: run.projectId,
        projectName,
        since: gate.runUpdatedAt,
        href: `/p/${run.projectId}/r/${run.id}/${gate.stage}`,
      });
    }
  }
  for (const ask of asks) {
    rows.push({
      key: `ask-${ask.id}`,
      kind: 'ask',
      labelKey: 'home.needsyou.ask',
      subject: ask.tool,
      runId: ask.runId,
      projectId: ask.projectId ?? null,
      since: ask.requestedAt,
      href: '/inbox',
    });
  }
  return rows.sort((left, right) => left.since.localeCompare(right.since));
}

/** The once-per-condition owner alerts, computed from daemon records only. */
/** Routed-but-unhealthy providers that must gate the composer Start button. */
export function findUnhealthyRoutedProviders(
  providers: readonly ProviderConfig[] | null | undefined,
  routings: readonly RoleRouting[] | null | undefined,
  authStatuses?: Readonly<Record<string, AuthStatus>>
): ProviderConfig[] {
  if (!providers || providers.length === 0) return [];
  const routed = new Set<string>();
  if (routings && routings.length > 0) {
    for (const routing of routings) {
      for (const target of routing.targets ?? []) {
        if (target.provider_id) routed.add(target.provider_id);
      }
    }
  }
  const considerRoutedOnly = routed.size > 0;
  return providers.filter((provider) => {
    if (!provider.enabled) return false;
    if (considerRoutedOnly && !routed.has(provider.name)) return false;
    if (provider.last_test_ok === false) return true;
    if (provider.last_test_ok !== true) {
      return authStatuses?.[provider.name]?.kind === 'unauthenticated';
    }
    return false;
  });
}

export function homeAlerts(params: {
  oldestWaitingGateAt: string | null;
  failedRuns: readonly RunSummary[];
  quotaPercent: number | null;
  spendPercent: number | null;
  raised: Readonly<Record<string, string>>;
}): OwnerAlert[] {
  const hour = new Date().getHours();
  return ownerAlerts({
    oldestWaitingGateAt: params.oldestWaitingGateAt,
    failedRuns: params.failedRuns,
    quotaPercent: params.quotaPercent,
    spendPercent: params.spendPercent,
    hour,
    raised: params.raised,
    quietHours: { start: 23, end: 6 },
  });
}

export default function HomePage(): React.ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const client = useClient();
  const { setReady } = useDataReady();
  const { mode } = useDensity();
  const capabilities = useCapabilities();

  const [idea, setIdea] = useState('');
  const [sourceValue, setSourceValue] = useState<ProjectSourceValue>(INITIAL_PROJECT_SOURCE);
  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);
  // Either already-localized validation copy (a plain string) or a
  // localized daemon rejection (catalog key + raw detail, R-4).
  const [composerError, setComposerError] = useState<DescribedRpcError | string | null>(null);
  // B-1/R-7 pending git-init confirmation on the Simple Home composer: set when
  // resolveProjectSource probes an existing non-git folder instead of creating.
  const [composerConfirm, setComposerConfirm] = useState<SourceConfirmRequest | null>(null);
  // Which flow (interview vs start) is waiting on the confirmaion above.
  const [composerPendingFlow, setComposerPendingFlow] = useState<'interview' | 'start' | null>(
    null
  );
  const [composerPendingIdea, setComposerPendingIdea] = useState<string | null>(null);
  const [composerPendingProject, setComposerPendingProject] = useState<string | null>(null);
  const [composerConfirmBusy, setComposerConfirmBusy] = useState(false);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [defaultsSheetOpen, setDefaultsSheetOpen] = useState(false);
  const [runsByProject, setRunsByProject] = useState<Record<string, RunSummary[]>>({});
  const [waitingGatesByProject, setWaitingGatesByProject] = useState<Record<string, number>>({});
  const [totalWaitingGates, setTotalWaitingGates] = useState(0);
  // E2: the needs-you strip rows (gates + approval asks, longest waiting first) and the
  // once-per-condition alert bookkeeping.
  const [needsYou, setNeedsYou] = useState<NeedsYouRow[]>([]);
  const [secretarySheetOpen, setSecretarySheetOpen] = useState(false);
  // Bumped after a failed-run retry so the runs/gates read repeats and the failed row clears.
  const [runsReloadTick, setRunsReloadTick] = useState(0);
  const retryProjectIdRef = useRef<ProjectId | null>(null);
  const raisedRef = useRef<Record<string, string>>({});

  const projectsResult = useProjects();
  const rolesResult = useRoles();
  const modelsResult = useModels();
  // DEFECT 2(a): provider health for the composer warning. `providers.list`
  // carries last_test_* and `auth_status` carries key presence; the warning
  // gates Start (until acknowledged) rather than failing the run later.
  const [providerHealth, setProviderHealth] = useState<readonly ProviderConfig[]>([]);
  const [providerAuth, setProviderAuth] = useState<Readonly<Record<string, AuthStatus>>>({});
  const [providerWarningAcked, setProviderWarningAcked] = useState(false);

  useEffect(() => {
    let active = true;
    if (!client) {
      setProviderHealth([]);
      setProviderAuth({});
      setProviderWarningAcked(false);
      return;
    }
    const loadHealth = async (): Promise<void> => {
      try {
        const provList = await client.listProviders();
        if (!active) return;
        setProviderHealth(provList);
        setProviderWarningAcked(false);
        const statuses: Record<string, AuthStatus> = {};
        await Promise.all(
          provList.map(async (provider) => {
            try {
              statuses[provider.name] = await client.providerAuthStatus(provider.name);
            } catch {
              // Leave absent: the fallback only warns on explicit unauthenticated.
            }
          })
        );
        if (active) setProviderAuth(statuses);
      } catch {
        if (active) {
          setProviderHealth([]);
          setProviderAuth({});
        }
      }
    };
    void loadHealth();
    return () => {
      active = false;
    };
  }, [client]);
  // The default budget is a plain set/read value, re-read on mount, on focus and after any save.
  const defaultBudgetResult = useDefaultBudget();

  const quotaGauge = useQuotaGauge();
  const [alertSnapshot, setAlertSnapshot] = useState<{
    oldestWaitingGateAt: string | null;
    failedRuns: RunSummary[];
    maxSpendPercent: number | null;
  }>({ oldestWaitingGateAt: null, failedRuns: [], maxSpendPercent: null });

  // M5: Dedicated effect for alert evaluation to avoid re-fetching project runs/gates/budgets on quota poll.
  const [alertTick, setAlertTick] = useState(0);
  useEffect(() => {
    const alertList = homeAlerts({
      oldestWaitingGateAt: alertSnapshot.oldestWaitingGateAt,
      failedRuns: alertSnapshot.failedRuns,
      quotaPercent: quotaGauge.percentage,
      spendPercent: alertSnapshot.maxSpendPercent,
      raised: raisedRef.current,
    });

    // Compute currently active condition keys
    const now = Date.now();
    const activeConditionKeys = new Set<string>();
    if (
      alertSnapshot.oldestWaitingGateAt !== null &&
      (now - Date.parse(alertSnapshot.oldestWaitingGateAt)) / 60_000 >= GATE_WAIT_THRESHOLD_MINUTES
    )
      activeConditionKeys.add('gate_waiting');
    if (alertSnapshot.failedRuns.length > 0) activeConditionKeys.add('run_failed');
    if (quotaGauge.percentage !== null && quotaGauge.percentage >= QUOTA_NEAR_PERCENT)
      activeConditionKeys.add('quota_near');
    if (
      alertSnapshot.maxSpendPercent !== null &&
      alertSnapshot.maxSpendPercent >= SPEND_NEAR_PERCENT
    )
      activeConditionKeys.add('spend_near');

    // Retain only currently active keys in raisedRef
    const nextRaised: Record<string, string> = {};
    for (const [key, msgKey] of Object.entries(raisedRef.current)) {
      if (activeConditionKeys.has(key)) {
        nextRaised[key] = msgKey;
      }
    }

    if (alertList.length > 0) {
      for (const alert of alertList) {
        notify({
          type: 'warning',
          message: t(alert.messageKey, alert.params),
        });
      }
      raisedRef.current = {
        ...nextRaised,
        ...raisedKeysAfter(alertList),
      };
    } else {
      raisedRef.current = nextRaised;
    }
  }, [quotaGauge.percentage, alertTick, alertSnapshot, t]);

  // Honest data-ready signaling
  useEffect(() => {
    if (projectsResult.status === 'loading') {
      setReady(false);
    } else {
      setReady(true);
    }
  }, [projectsResult.status, setReady]);

  // Read routed model and default budget
  const coordinatorModelName = useMemo(() => {
    return findCoordinatorModel(rolesResult.data, modelsResult.data);
  }, [rolesResult.data, modelsResult.data]);

  const defaultBudget = defaultBudgetResult.value;

  const [sheetBudgetValue, setSheetBudgetValue] = useState<number | string>(defaultBudget);

  useEffect(() => {
    setSheetBudgetValue(defaultBudget);
  }, [defaultBudget]);

  useEffect(() => {
    const interval = setInterval(() => {
      setAlertTick((t) => t + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Load runs and gates across projects
  useEffect(() => {
    if (!client || !projectsResult.data || projectsResult.data.length === 0) {
      setRunsByProject({});
      setWaitingGatesByProject({});
      setTotalWaitingGates(0);
      return;
    }

    let active = true;
    const projectList = projectsResult.data;

    const loadRunsAndGates = async (): Promise<void> => {
      const runsMap: Record<string, RunSummary[]> = {};
      const waitingMap: Record<string, number> = {};
      const gatesByRunId: Record<string, GateSummary[]> = {};
      let totalWaiting = 0;
      let oldestWaitingGateAt: string | null = null;
      const failedRuns: RunSummary[] = [];
      const gateRows: Record<
        string,
        {
          runId: string;
          projectId: ProjectId;
          runUpdatedAt: string;
          stage: string;
          pending: boolean;
        }[]
      > = {};

      await Promise.all(
        projectList.map(async (project: ProjectSummary) => {
          try {
            const runs = await client.listRuns(project.id);
            runsMap[project.id] = runs;

            let projectWaiting = 0;
            for (const run of runs) {
              if (run.status === 'failed') failedRuns.push(run);

              if (
                run.status === 'completed' ||
                run.status === 'cancelled' ||
                run.status === 'failed'
              ) {
                continue;
              }

              try {
                if (!gatesByRunId[run.id]) {
                  gatesByRunId[run.id] = await client.getGates(run.id);
                }
                const gates = gatesByRunId[run.id];
                projectWaiting += countPendingGatesAtCurrentStage(gates, run.stage);

                gateRows[run.id] = gates.map((g) => ({
                  runId: run.id,
                  projectId: run.projectId,
                  runUpdatedAt: run.updatedAt,
                  stage: g.stage,
                  pending: g.state.state === 'pending' && g.stage === run.stage,
                }));

                for (const row of gateRows[run.id]) {
                  if (
                    row.pending &&
                    (oldestWaitingGateAt === null || row.runUpdatedAt < oldestWaitingGateAt)
                  ) {
                    oldestWaitingGateAt = row.runUpdatedAt;
                  }
                }
              } catch {
                // Ignore single run gate failure
              }
            }
            waitingMap[project.id] = projectWaiting;
            totalWaiting += projectWaiting;
          } catch {
            // Ignore single project run failure
          }
        })
      );

      const allRuns = projectList.flatMap((project) => runsMap[project.id] ?? []);
      let asks: {
        id: string;
        runId: string;
        projectId: ProjectId | null;
        tool: string;
        requestedAt: string;
      }[] = [];
      try {
        const approvals = await client.mcpApprovalsList();
        asks = approvals.map((ask) => ({
          id: ask.id,
          runId: ask.runId,
          projectId: (allRuns.find((r) => r.id === ask.runId)?.projectId ??
            null) as ProjectId | null,
          tool: ask.tool,
          requestedAt: ask.requestedAt,
        }));
      } catch {
        asks = [];
      }

      if (active) {
        setRunsByProject(runsMap);
        setWaitingGatesByProject(waitingMap);
        setTotalWaitingGates(totalWaiting);
        setNeedsYou(buildNeedsYou(t, allRuns, gateRows, asks, projectList));
        // Calculate max spend percent
        let maxSpendPercent: number | null = null;
        await Promise.all(
          projectList.map(async (project) => {
            try {
              const budget = await client.getProjectBudget(project.id);
              if (budget.totalBudgetUsd > 0) {
                const pct = (budget.spentUsd / budget.totalBudgetUsd) * 100;
                if (maxSpendPercent === null || pct > maxSpendPercent) {
                  maxSpendPercent = pct;
                }
              }
            } catch {
              // Ignore budget fetch error
            }
          })
        );

        // E2: Once-per-condition alerts snapshot.
        setAlertSnapshot({ oldestWaitingGateAt, failedRuns, maxSpendPercent });
      }
    };

    void loadRunsAndGates();

    return () => {
      active = false;
    };
  }, [client, projectsResult.data, t, runsReloadTick]);

  const createProjectWithRepo = async (
    projectName: string,
    trimmedIdea: string,
    repoPath?: string,
    repoUrl?: string
  ): Promise<ProjectSummary> => {
    if (!client) throw new Error(t('common.error'));
    if (repoUrl) {
      return client.createProject(projectName, trimmedIdea, locale, repoPath, repoUrl);
    }
    if (repoPath) {
      return client.createProject(projectName, trimmedIdea, locale, repoPath);
    }
    return client.createProject(projectName, trimmedIdea, locale);
  };

  // Throws ConfirmNeeded when the probe finds an existing non-git folder; the
  // caller (start/interview action) catches it and shows the confirm panel
  // instead of creating. Accept continues via the prepared repo path.
  const createConfiguredProject = async (
    projectName: string,
    trimmedIdea: string
  ): Promise<ProjectSummary> => {
    if (!client) throw new Error(t('common.error'));
    const resolved = await resolveProjectSource(client, sourceValue);
    if (resolved.kind === 'confirm-init') {
      setComposerConfirm({
        targetPath: resolved.targetPath,
        mode: sourceValue.mode,
        parentDir: sourceValue.parentDir.trim(),
        folderName: sourceValue.folderName.trim(),
      });
      throw new ConfirmNeeded(resolved.targetPath);
    }
    return createProjectWithRepo(projectName, trimmedIdea, resolved.repoPath, resolved.repoUrl);
  };

  const prepareComposerConfirmedRepo = async (): Promise<string> => {
    if (!client || !composerConfirm) throw new Error(t('common.error'));
    const prepared =
      composerConfirm.mode === 'new_folder'
        ? await client.prepareProjectFolder(composerConfirm.parentDir, composerConfirm.folderName)
        : await client.prepareExistingFolder(composerConfirm.targetPath);
    return prepared.repoPath;
  };

  // Action: home.interview.start
  const startInterviewAction = useAction('home.interview.start', async () => {
    if (!client) throw new Error(t('common.error'));
    const trimmedIdea = idea.trim();
    if (!trimmedIdea) return;
    const validationError = validateProjectSource(sourceValue, githubStatus, t);
    if (validationError) {
      setComposerError(validationError);
      return;
    }
    setComposerError(null);
    const projectName = deriveProjectName(trimmedIdea);
    setComposerPendingFlow('interview');
    setComposerPendingIdea(trimmedIdea);
    setComposerPendingProject(projectName);
    try {
      const project = await createConfiguredProject(projectName, trimmedIdea);
      setComposerConfirm(null);
      setComposerPendingFlow(null);
      setComposerPendingIdea(null);
      setComposerPendingProject(null);
      projectsResult.reload();
      await client.interviewStart(project.id, trimmedIdea);
      markInterviewEntry(project.id);
      navigate(`/p/${project.id}`);
    } catch (err) {
      if (err instanceof ConfirmNeeded) return;
      setComposerError(describeRpcError(err, t));
      throw err;
    }
  });
  // Action: home.start
  // MUST call projects.create -> runs.start -> budget.set IN THAT ORDER
  const startAction = useAction('home.start', async () => {
    if (!client) {
      throw new Error(t('common.error'));
    }

    const trimmedIdea = idea.trim();
    if (!trimmedIdea) return;
    const validationError = validateProjectSource(sourceValue, githubStatus, t);
    if (validationError) {
      setComposerError(validationError);
      return;
    }
    setComposerError(null);

    const projectName = deriveProjectName(trimmedIdea);
    const budgetCents = Math.round(Number(defaultBudget) * 100);
    setComposerPendingFlow('start');
    setComposerPendingIdea(trimmedIdea);
    setComposerPendingProject(projectName);

    try {
      // 1. projects.create
      const project = await createConfiguredProject(projectName, trimmedIdea);
      setComposerConfirm(null);
      setComposerPendingFlow(null);
      setComposerPendingIdea(null);
      setComposerPendingProject(null);
      projectsResult.reload();

      // 2. runs.start — the budget the owner entered is the budget the run records.
      await client.startRun(project.id, trimmedIdea, undefined, undefined, budgetCents);

      // 3. budget.set
      await client.setProjectBudget(project.id, budgetCents);

      // Navigate to /p/:id
      navigate(`/p/${project.id}`);
    } catch (err) {
      if (err instanceof ConfirmNeeded) return;
      setComposerError(describeRpcError(err, t));
      throw err;
    }
  });

  const clearComposerConfirm = (): void => {
    setComposerConfirm(null);
    setComposerPendingFlow(null);
    setComposerPendingIdea(null);
    setComposerPendingProject(null);
    setComposerError(null);
  };

  const continueComposerAfterConfirm = useAction('home.confirm-accept', async () => {
    if (!client || !composerConfirm) return;
    const flow = composerPendingFlow;
    const pendingIdea = composerPendingIdea ?? idea.trim();
    const pendingProject =
      composerPendingProject ?? (pendingIdea ? deriveProjectName(pendingIdea) : '');
    if (!flow || !pendingIdea || !pendingProject) return;
    setComposerConfirmBusy(true);
    setComposerError(null);
    try {
      const repoPath = await prepareComposerConfirmedRepo();
      setComposerConfirm(null);
      setComposerPendingFlow(null);
      setComposerPendingIdea(null);
      setComposerPendingProject(null);
      if (flow === 'interview') {
        const project = await createProjectWithRepo(pendingProject, pendingIdea, repoPath);
        projectsResult.reload();
        await client.interviewStart(project.id, pendingIdea);
        markInterviewEntry(project.id);
        navigate(`/p/${project.id}`);
        return;
      }
      // start flow — MUST keep create -> runs.start -> budget.set order.
      const budgetCents = Math.round(Number(defaultBudget) * 100);
      const project = await createProjectWithRepo(pendingProject, pendingIdea, repoPath);
      projectsResult.reload();
      await client.startRun(project.id, pendingIdea, undefined, undefined, budgetCents);
      await client.setProjectBudget(project.id, budgetCents);
      navigate(`/p/${project.id}`);
    } catch (err) {
      setComposerError(describeRpcError(err, t));
      throw err;
    } finally {
      setComposerConfirmBusy(false);
    }
  });

  const handleComposerConfirmAccept = (): void => {
    void continueComposerAfterConfirm.run();
  };

  const handleComposerConfirmCancel = (): void => {
    clearComposerConfirm();
  };

  // Action: home.defaults.budget.save
  const budgetSaveAction = useAction('home.defaults.budget.save', async () => {
    const parsed = parseDefaultBudget(sheetBudgetValue);
    if (!parsed.ok) {
      notify({
        type: 'error',
        message:
          parsed.reason === 'too-high'
            ? t('settings.general.budget.too_high', { max: MAX_DEFAULT_BUDGET_USD })
            : t('settings.general.budget.invalid'),
        actionId: 'home.defaults.budget.save',
      });
      return;
    }

    // A plain set (see app/defaultBudget.ts): the stored value is replaced, never added to.
    await writeDefaultBudget(parsed.value);

    notify({
      type: 'success',
      message: t('home.defaults_saved'),
      actionId: 'home.defaults.budget.save',
    });

    defaultBudgetResult.reload();
  });

  // Action: home.retry
  const retryAction = useAction('home.retry', async () => {
    projectsResult.reload();
  });

  // Action: home.run.retry — one paid runs.start; failures toast through useAction.
  const retryRunAction = useAction('home.run.retry', async () => {
    const retryProjectId = retryProjectIdRef.current;
    if (!client || retryProjectId === null) return;
    await client.startRun(retryProjectId, t('home.retry_run_idea'));
    projectsResult.reload();
    setRunsReloadTick((tick) => tick + 1);
  });

  const githubCreateBlocked =
    sourceValue.mode === 'github_create' && !githubStatus?.configured;

  const handleInterviewSubmit = (): void => {
    if (!idea.trim() || startInterviewAction.pending || !capabilities.provider) return;
    if (showProviderWarning) return;
    const validationError = validateProjectSource(sourceValue, githubStatus, t);
    if (validationError) {
      setComposerError(validationError);
      return;
    }
    setComposerError(null);
    void startInterviewAction.run();
  };

  const handleStartSubmit = (): void => {
    if (!idea.trim() || startAction.pending || !capabilities.provider) return;
    if (showProviderWarning) return;
    const validationError = validateProjectSource(sourceValue, githubStatus, t);
    if (validationError) {
      setComposerError(validationError);
      return;
    }
    setComposerError(null);
    void startAction.run();
  };

  // A4: the pre-run estimate, fetched once the idea is long enough to start
  // from and recomputed as the owner edits it. Before the project exists the
  // daemon estimates against the global role routings, so the project id is
  // the wildcard.
  const estimateResult = useResource<CostEstimate | null>(
    () =>
      client && idea.trim().length >= 12
        ? client.estimateRun('*' as ProjectId, idea)
        : Promise.resolve(null),
    () => false,
    [client, idea]
  );
  const estimate = estimateResult.data ?? null;

  const handleChipClick = (chipKey: string): void => {
    setIdea(t(chipKey));
  };

  const recentProjects = useMemo(() => {
    if (!projectsResult.data) return [];
    return projectsResult.data.slice(0, 6);
  }, [projectsResult.data]);

  const hasProvider = capabilities.provider;

  const unhealthyProviders = useMemo(
    () => findUnhealthyRoutedProviders(providerHealth, rolesResult.data, providerAuth),
    [providerHealth, providerAuth, rolesResult.data]
  );
  // DEFECT 2(a): warn on unhealthy routed providers, never fake success. A
  // fresh install with no providers keeps today's add-provider flow (no new
  // friction); the banner only gates Start once a row exists and looks bad.
  const showProviderWarning =
    hasProvider &&
    providerHealth.length > 0 &&
    unhealthyProviders.length > 0 &&
    !providerWarningAcked;
  const startBlocked = showProviderWarning || githubCreateBlocked;
  const startBlockedReason = showProviderWarning
    ? t('home.provider_warning.start_blocked')
    : undefined;

  const projectsListError = projectsResult.error
    ? describeRpcError(projectsResult.error, t)
    : null;

  // Table columns for Advanced mode
  const tableColumns: DataTableColumn<ProjectSummary>[] = useMemo(() => {
    return [
      {
        id: 'name',
        header: t('home.col_name'),
        accessor: (row) => {
          const displayName = row.name || t('home.project_unnamed');
          return (
            <bdi
              dir="auto"
              title={displayName}
              style={{
                display: 'block',
                fontWeight: 'var(--w-font-weight-semibold)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minInlineSize: 0,
                maxInlineSize: '100%',
              }}
            >
              {displayName}
            </bdi>
          );
        },
      },
      {
        id: 'status',
        header: t('home.col_status'),
        accessor: (row) => {
          const runs = runsByProject[row.id];
          const waiting = waitingGatesByProject[row.id] ?? 0;
          const { status } = computeProjectStatus(runs, waiting);
          const statusLabels: Record<StatusPillState, string> = {
            idle: t('home.status_idle'),
            running: t('home.status_running'),
            waiting: t('home.status_waiting'),
            done: t('home.status_done'),
            failed: t('home.status_failed'),
            cancelled: t('home.status_cancelled'),
            paused: t('home.status_paused'),
          };
          const latestRun = runs?.[0];
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--w-space-2)' }}>
              {latestRun?.runMode && toRunModeChip(latestRun.runMode) !== 'agent' ? (
                <RunModeChip runMode={latestRun.runMode} />
              ) : null}
              <StatusPill status={status} label={statusLabels[status]} />
            </span>
          );
        },
      },
      {
        id: 'stage',
        header: t('home.col_stage'),
        accessor: (row) => {
          const runs = runsByProject[row.id];
          const waiting = waitingGatesByProject[row.id] ?? 0;
          const { stageKey } = computeProjectStatus(runs, waiting);
          return <span>{t(stageKey)}</span>;
        },
      },
      {
        id: 'actions',
        header: t('home.project_open'),
        align: 'end',
        accessor: (row) => (
          <Button
            variant="ghost"
            size="sm"
            data-action="home.project.open"
            onClick={() => navigate(`/p/${row.id}`)}
          >
            {t('home.project_open')}
          </Button>
        ),
      },
    ];
  }, [t, runsByProject, waitingGatesByProject, navigate]);

  const retryButtonElement = (
    <Button
      variant="secondary"
      size="sm"
      data-action="home.retry"
      loading={retryAction.pending}
      onClick={() => {
        void retryAction.run();
      }}
    >
      {t('home.retry')}
    </Button>
  );

  const inboxReviewButtonElement = (
    <Button
      variant="secondary"
      size="sm"
      data-action="home.inbox.review"
      onClick={() => navigate('/inbox')}
    >
      {t('home.inbox_review')}
    </Button>
  );

  return (
    <div className="v3-home-root">
      <div className="v3-home-narrow">
        <div className="v3-home-header">
          <h1 className="v3-home-title">{t('home.greeting')}</h1>
          <div style={{ display: 'flex', gap: 'var(--w-space-2)' }}>
            <Button
              variant="secondary"
              data-action="home.new-project.open"
              data-testid="home-new-project-open"
              onClick={() => setNewProjectDialogOpen(true)}
            >
              {t('home.new_project_btn')}
            </Button>
            <Button
              data-action="home.secretary.open"
              data-testid="home-secretary-open"
              onClick={() => setSecretarySheetOpen(true)}
            >
              {t('secretary.title')}
            </Button>
          </div>
        </div>
        <p className="v3-home-help">{t('home.help')}</p>

        <NewProjectDialog
          open={newProjectDialogOpen}
          startBlocked={startBlocked}
          startBlockedReason={startBlockedReason}
          onClose={() => {
            setNewProjectDialogOpen(false);
            projectsResult.reload();
          }}
        />

        <Sheet
          open={secretarySheetOpen}
          onClose={() => setSecretarySheetOpen(false)}
          title={t('secretary.title')}
          closeLabel={t('common.close')}
          data-testid="home-secretary-sheet"
        >
          <SecretaryChat projectId={null} t={t} />
        </Sheet>

        {/* Error state */}
        {projectsResult.status === 'error' && (
          <div
            role="region"
            aria-label={t('home.error_title')}
            className="v3-home-error-wrap"
            data-testid="home-error-banner"
          >
            <Banner variant="danger" title={t('home.error_title')} action={retryButtonElement}>
              {projectsListError ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-1)' }}>
                  <span>{t(projectsListError.key)}</span>
                  {projectsListError.detail ? (
                    <bdi dir="auto">{projectsListError.detail}</bdi>
                  ) : null}
                </div>
              ) : (
                t('common.error')
              )}
            </Banner>
          </div>
        )}

        {/* E2: the needs-you strip — gates and asks merged, longest waiting first. */}
        {needsYou.length > 0 && (
          <div role="region" aria-label={t('home.needsyou.title')} data-testid="home-needsyou">
            <ul className="v3-home-needsyou" aria-label={t('home.needsyou.title')}>
              {needsYou.map((row) => {
                const sinceText = formatRelativeDurationLocalized(row.since, locale);
                return (
                  <li
                    key={row.key}
                    className="v3-home-needsyou-row"
                    data-testid={`home-needsyou-row-${row.key}`}
                    data-kind={row.kind}
                    data-run-id={row.runId}
                    data-project-id={row.projectId ?? undefined}
                  >
                    <span className="v3-home-needsyou-label">{t(row.labelKey)}</span>
                    <span className="v3-home-needsyou-subject">{row.subject}</span>
                    <span className="v3-home-needsyou-wait">
                      {t('home.needsyou.since', {
                        duration: sinceText,
                        since: sinceText,
                      })}
                    </span>
                    {row.kind === 'failed' && (
                      <Button
                        variant="primary"
                        data-action="home.run.retry"
                        disabled={retryRunAction.pending}
                        onClick={() => {
                          if (row.projectId === null || retryRunAction.pending) return;
                          retryProjectIdRef.current = row.projectId;
                          void retryRunAction.run();
                        }}
                      >
                        {t('home.retry')}
                      </Button>
                    )}
                    <a
                      href={row.href}
                      className="v3-home-needsyou-open"
                      data-action="home.needsyou.open"
                      data-testid={`home-needsyou-open-${row.key}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(row.href);
                      }}
                    >
                      {t('home.needsyou.open')}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* The single composer card */}
        <div className="v3-home-composer-card" data-testid="home-composer-card">
          <label htmlFor="home-idea-input" className="v3-home-composer-label">
            {t('home.idea_label')}
          </label>
          <TextArea
            id="home-idea-input"
            value={idea}
            onChange={(e) => {
              setComposerError(null);
              setIdea(e.target.value);
            }}
            onEnter={handleStartSubmit}
            placeholder={t('home.idea_placeholder')}
            rows={4}
            data-testid="home-idea-input"
          />
          <ProjectSourcePicker
            value={sourceValue}
            onChange={(next) => {
              setComposerError(null);
              clearComposerConfirm();
              setSourceValue(next);
            }}
            client={client}
            t={t}
            githubStatus={githubStatus}
            onGithubStatusChange={setGithubStatus}
            onOpenIntegrations={() => navigate('/settings/integrations')}
            disabled={startAction.pending || startInterviewAction.pending}
            idPrefix="home-source"
          />
          {composerConfirm ? (
            <SourceConfirmPanel
              idPrefix="home-source"
              targetPath={composerConfirm.targetPath}
              t={t}
              pending={composerConfirmBusy || continueComposerAfterConfirm.pending}
              onAccept={handleComposerConfirmAccept}
              onCancel={handleComposerConfirmCancel}
            />
          ) : null}
          {composerError ? (
            <div style={{ marginBlockStart: 'var(--w-space-2)' }}>
              <Banner
                variant="danger"
                title={
                  typeof composerError === 'string' ? composerError : t(composerError.key)
                }
                data-testid="home-composer-error"
              >
                {typeof composerError === 'string' ? null : composerError.detail ? (
                  <span dir="auto">{composerError.detail}</span>
                ) : null}
              </Banner>
            </div>
          ) : null}

          {showProviderWarning ? (
            <div style={{ marginBlockStart: 'var(--w-space-2)' }}>
              <Banner
                variant="attention"
                title={t('home.provider_warning.title')}
                data-testid="home-provider-warning"
                action={
                  <div
                    style={{
                      display: 'flex',
                      gap: 'var(--w-space-2)',
                      flexWrap: 'wrap',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      data-action="home.provider.warning.settings"
                      onClick={() => navigate('/settings/models')}
                    >
                      {t('home.provider_warning.open_settings')}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      data-action="home.provider.warning.proceed"
                      data-testid="home-provider-proceed"
                      onClick={() => setProviderWarningAcked(true)}
                    >
                      {t('home.provider_warning.proceed')}
                    </Button>
                  </div>
                }
              >
                {(() => {
                  const marker = '__WARSHA_PROVIDER_NAMES__';
                  const template = t('home.provider_warning.body', { name: marker });
                  const [before = '', after = ''] = template.split(marker);
                  return (
                    <span>
                      {before}
                      {unhealthyProviders.map((provider, index) => (
                        <span key={provider.name}>
                          {index > 0 ? ', ' : null}
                          <bdi dir="ltr">{provider.name}</bdi>
                        </span>
                      ))}
                      {after}
                    </span>
                  );
                })()}
              </Banner>
            </div>
          ) : null}

          <div className="v3-home-composer-footer">
            <span className="v3-home-defaults-line">
              <span>{t('home.defaults_prefix')}</span>
              <bdi dir="auto" className="v3-home-ltr">
                {coordinatorModelName || t('home.model_auto')}
              </bdi>
              <span>·</span>
              <span>{t('home.defaults_budget_prefix')}</span>
              <bdi dir="ltr" className="v3-home-ltr">
                ${defaultBudget}
              </bdi>
              <span>·</span>
              <button
                type="button"
                data-action="home.defaults.open"
                onClick={() => setDefaultsSheetOpen(true)}
                className="v3-home-link-btn"
              >
                {t('home.defaults_open')}
              </button>
            </span>

            {hasProvider ? (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={
                    !idea.trim() ||
                    startInterviewAction.pending ||
                    githubCreateBlocked ||
                    showProviderWarning
                  }
                  disabledReason={startBlockedReason}
                  loading={startInterviewAction.pending}
                  onClick={handleInterviewSubmit}
                  data-action="home.interview.start"
                  data-testid="home-interview-button"
                >
                  {t('home.interview_start')}
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  iconEnd={<IconSend size={18} />}
                  disabled={
                    !idea.trim() || startAction.pending || githubCreateBlocked || showProviderWarning
                  }
                  disabledReason={startBlockedReason}
                  loading={startAction.pending}
                  onClick={handleStartSubmit}
                  data-action="home.start"
                  data-testid="home-start-button"
                >
                  {t('home.start')}
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                size="lg"
                data-action="home.provider.add"
                onClick={() => navigate('/onboarding')}
                data-testid="home-provider-add-button"
              >
                {t('home.provider_add')}
              </Button>
            )}
          </div>
          {estimate && (
            <p
              className="home-estimate"
              data-testid="home-estimate"
              data-action="home.estimate.show"
            >
              {t('home.estimate.line', {
                min: (estimate.minCents / 100).toFixed(2),
                max: (estimate.maxCents / 100).toFixed(2),
              })}
              {estimate.warnings.length > 0 && (
                <span className="home-estimate-warnings"> {estimate.warnings.join(' · ')}</span>
              )}
            </p>
          )}
        </div>

        {/* Four starter example chips */}
        <div
          className="v3-home-chips"
          role="region"
          aria-label={t('home.examples_label')}
          data-testid="home-chips-group"
        >
          {EXAMPLE_CHIP_KEYS.map((chipKey, idx) => (
            <button
              key={chipKey}
              type="button"
              data-action="home.example.use"
              onClick={() => handleChipClick(chipKey)}
              className="v3-home-chip"
              data-testid={`home-chip-${idx}`}
            >
              {t(chipKey)}
            </button>
          ))}
        </div>

        {/* Attention banner when gates wait (Amendment §5.5-b) */}
        {totalWaitingGates > 0 && (
          <div
            role="region"
            aria-label={t('home.inbox_banner_text')}
            className="v3-home-banner-wrap"
            data-testid="home-inbox-banner"
          >
            <Banner variant="attention" action={inboxReviewButtonElement}>
              <strong>
                {totalWaitingGates === 1
                  ? t('home.inbox_single')
                  : t('home.inbox_plural', { count: totalWaitingGates })}
              </strong>{' '}
              — {t('home.inbox_banner_text')}
            </Banner>
          </div>
        )}

        {/* Loading skeleton for recent projects */}
        {projectsResult.status === 'loading' && (
          <div
            className="v3-home-projects-section"
            aria-label={t('home.projects_heading')}
            data-testid="home-projects-loading"
          >
            <div className="v3-home-section-header">
              <h2>{t('home.projects_heading')}</h2>
            </div>
            <div className="v3-home-skeleton-cards">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="v3-home-skeleton-card">
                  <Skeleton width="60%" height="var(--w-space-4)" />
                  <Skeleton width="100%" height="var(--w-space-2)" />
                  <Skeleton width="80%" height="var(--w-space-3)" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Projects section (only shown when ready and has projects) */}
        {projectsResult.status === 'ready' && recentProjects.length > 0 && (
          <section
            className="v3-home-projects-section"
            aria-label={t('home.projects_heading')}
            data-testid="home-projects-section"
          >
            <div className="v3-home-section-header">
              <h2>{t('home.projects_heading')}</h2>
              <button
                type="button"
                data-action="home.projects.all"
                onClick={() => navigate('/projects')}
                className="v3-home-link-btn"
              >
                {t('home.projects_all')}
              </button>
            </div>

            {mode === 'developers' ? (
              <DataTable
                columns={tableColumns}
                data={recentProjects}
                keyExtractor={(row) => row.id}
                ariaLabel={t('home.table_label')}
                compact
              />
            ) : (
              <div className="v3-home-grid" data-testid="home-projects-grid">
                {recentProjects.map((project) => {
                  const runs = runsByProject[project.id];
                  const waiting = waitingGatesByProject[project.id] ?? 0;
                  const { status, stageKey, summaryKey } = computeProjectStatus(runs, waiting);
                  const miniSegments = computeMiniSegments(runs, waiting);

                  const statusLabels: Record<StatusPillState, string> = {
                    idle: t('home.status_idle'),
                    running: t('home.status_running'),
                    waiting: t('home.status_waiting'),
                    done: t('home.status_done'),
                    failed: t('home.status_failed'),
                    cancelled: t('home.status_cancelled'),
                    paused: t('home.status_paused'),
                  };

                  return (
                    <button
                      key={project.id}
                      type="button"
                      data-action="home.project.open"
                      onClick={() => navigate(`/p/${project.id}`)}
                      className="v3-home-card"
                      data-testid={`home-project-card-${project.id}`}
                    >
                      <div className="v3-home-card-header">
                        <h3
                          className="v3-home-card-title"
                          style={{
                            minInlineSize: 0,
                            overflow: 'hidden',
                          }}
                        >
                          <bdi
                            dir="auto"
                            title={project.name || t('home.project_unnamed')}
                            style={{
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              minInlineSize: 0,
                              maxInlineSize: '100%',
                            }}
                          >
                            {project.name || t('home.project_unnamed')}
                          </bdi>
                        </h3>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 'var(--w-space-2)',
                          }}
                        >
                          {runs?.[0]?.runMode && toRunModeChip(runs[0].runMode) !== 'agent' ? (
                            <RunModeChip runMode={runs[0].runMode} />
                          ) : null}
                          <StatusPill status={status} label={statusLabels[status]} />
                        </span>
                      </div>

                      <div
                        className="v3-home-mini-stepper"
                        aria-label={t('home.mini_progress_label')}
                      >
                        {miniSegments.map((seg, idx) => (
                          <i
                            key={idx}
                            className={`v3-home-mini-bar v3-home-mini-bar--${seg}`}
                            aria-hidden="true"
                          />
                        ))}
                      </div>

                      <span className="v3-home-card-summary">
                        {t(stageKey)} · {t(summaryKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Defaults Sheet */}
      <Sheet
        open={defaultsSheetOpen}
        onClose={() => setDefaultsSheetOpen(false)}
        title={t('home.defaults_title')}
        description={t('home.defaults_desc')}
        closeLabel={t('common.close')}
        data-testid="home-defaults-sheet"
      >
        <div className="v3-home-sheet-content">
          <div className="v3-home-sheet-section">
            <h3 className="v3-home-sheet-title">{t('home.defaults_models_open')}</h3>
            <p className="v3-home-sheet-sub">
              {t('home.defaults_prefix')}{' '}
              <bdi dir="auto" className="v3-home-ltr">
                {coordinatorModelName || t('home.model_auto')}
              </bdi>
            </p>
            <Button
              variant="secondary"
              size="sm"
              data-action="home.defaults.models.open"
              onClick={() => {
                setDefaultsSheetOpen(false);
                navigate('/settings/models');
              }}
            >
              {t('home.defaults_models_open')}
            </Button>
          </div>

          <div className="v3-home-sheet-section">
            <span className="v3-home-sheet-label">{t('home.defaults_budget_label')}</span>
            <BudgetField
              value={sheetBudgetValue}
              onChange={setSheetBudgetValue}
              ariaLabel={t('home.defaults_budget_label')}
              customPlaceholder={t('home.defaults_budget_placeholder')}
            />
            <Button
              variant="secondary"
              size="sm"
              data-action="home.defaults.budget.save"
              loading={budgetSaveAction.pending}
              onClick={() => {
                void budgetSaveAction.run();
              }}
            >
              {t('home.defaults_budget_save')}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
