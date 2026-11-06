// @warsha/desktop — the bench: the shell, the mode and the routing (docs/design/REDESIGN.md §4, §10).
//
// What lives here and what does not. This file owns the *regions* the direction names — the top bar, the
// instrument strip, the settings tab strip and the main bench area — plus the state they read: the mode,
// the selected project and run, the gates waiting on the owner, the project's budget and the two
// post-launch lists. It does not own screen content: each screen keeps its own data path through
// `@warsha/client`, and the shell passes what the screens already take (`client`, `project`, `run`,
// `onBack`) so no accepted seam changes shape.
//
// Three rules this file is written against:
//
//   * **Simple is primary, Advanced is disclosure** (§3). The mode is the owner's saved choice, the switch
//     is the shell's, and changing it keeps the project and the run — it never changes the pipeline, the
//     gates or the data model;
//   * **the shell routes on state, screens stay deep-linkable** (§4). `?screen=…` is still the one address
//     a screen has, which is what the Playwright suite and the remote hand-off use;
//   * **every word is the catalog's** (§13). The `t(…) || 'literal'` fallbacks, the local tab labels and
//     the `localized()` shim that needed them are gone: a missing key now shows its own name, which is how
//     a gap gets noticed instead of silently turning into English copy in an Arabic session.
import { invoke } from '@tauri-apps/api/core';
import {
  createClient,
  type CrashReport as WireCrashReport,
  type GateSummary,
  type ProjectSummary,
  type RunSummary,
  type StoreReview as WireStoreReview,
  type WarshaClient,
} from '@warsha/client';
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Box, Button, Skeleton, tabPanelProps, type WorkbenchMode } from '@warsha/ui';
import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import {
  BackendKitPanel,
  type BackendFeature,
  type BackendKind,
  type BackendTable,
  type PaymentsGateStatus,
} from './components/BackendKitPanel';
import { BenchTopbar } from './components/BenchTopbar';
import { InstrumentStrip } from './components/InstrumentStrip';
import { ProviderSetupWizard } from './components/ProviderSetupWizard';
import {
  readDaemonEndpoint,
  UNRESOLVED_ENDPOINT,
  type DaemonEndpoint,
} from './daemon';
import { AdvancedMode } from './screens/AdvancedMode';
import { ArtifactViewer } from './screens/ArtifactViewer';
import { Budgets } from './screens/Budgets';
import { CrashReports, type CrashReport } from './screens/CrashReports';
import { Devices } from './screens/Devices';
import { GatesInbox } from './screens/GatesInbox';
import { HarnessesSettings } from './screens/HarnessesSettings';
import { ModelsSettings } from './screens/ModelsSettings';
import { Onboarding } from './screens/Onboarding';
import { PluginsSettings } from './screens/PluginsSettings';
import { ProjectsBoard } from './screens/ProjectsBoard';
import { ProvidersSettings } from './screens/ProvidersSettings';
import { RolesSettings } from './screens/RolesSettings';
import { Routines, type Routine } from './screens/Routines';
import { RunView } from './screens/RunView';
import {
  SettingsProviders,
  type ProviderEntry,
  type ProviderMode,
} from './screens/SettingsProviders';
import { SettingsScreen } from './screens/SettingsScreen';
import { SimpleMode } from './screens/SimpleMode';
import { SkillsSettings } from './screens/SkillsSettings';
import { StoreReviews, type StoreReview } from './screens/StoreReviews';
import { ThemeProvider } from './theme';

// Screen types
export type Screen =
  | 'onboarding'
  | 'projects'
  | 'run'
  | 'gates'
  | 'artifacts'
  | 'providers'
  | 'roles'
  | 'budgets'
  | 'devices'
  | 'simple'
  | 'advanced'
  | 'settings'
  | 'routines'
  | 'settings-providers'
  | 'harnesses'
  | 'skills'
  | 'plugins'
  | 'models'
  | 'crash-reports'
  | 'store-reviews'
  | 'backend-kit';

// The Settings tab strip (PLAN.md M20 wiring batch): every settings sub-screen can reach the others, so
// none of them is a dead end. Order is the sidebar order, and §4 gives all six one `role="tablist"`.
const SETTINGS_SCREENS: readonly Screen[] = [
  'settings',
  'settings-providers',
  'harnesses',
  'skills',
  'plugins',
  'models',
  'routines',
  'crash-reports',
  'store-reviews',
  'backend-kit',
];

/** The tab's word for one settings screen — the catalog's, never a local table (§13). */
export function settingsTabLabel(screen: Screen, locale: Locale): string {
  switch (screen) {
    case 'settings-providers':
      return t('nav.providers', {}, locale);
    case 'harnesses':
      return t('settings.harnesses', {}, locale);
    case 'skills':
      return t('settings.skills', {}, locale);
    case 'plugins':
      return t('settings.plugins', {}, locale);
    case 'models':
      return t('settings.models', {}, locale);
    case 'routines':
      return t('settings.routines', {}, locale);
    case 'crash-reports':
      return t('settings.crashReports', {}, locale);
    case 'store-reviews':
      return t('settings.storeReviews', {}, locale);
    case 'backend-kit':
      return t('settings.backendKit', {}, locale);
    default:
      return t('nav.settings', {}, locale);
  }
}

/**
 * Screens a deep link may name, e.g. `?screen=settings`.
 *
 * This shell routes on state rather than on URLs, so no screen has an address of its own. The query
 * parameter is the one way to open a screen directly, which is what the Playwright visual suite in
 * `apps/desktop/e2e/` uses instead of clicking through the app on every case. Only these names are
 * accepted; anything else (including `onboarding`) falls back to the saved mode, so a hand-typed
 * URL cannot put the shell into a screen it has no data for.
 */
const DEEP_LINK_SCREENS: readonly Screen[] = [
  'projects',
  'run',
  'gates',
  'artifacts',
  'providers',
  'roles',
  'budgets',
  'devices',
  'simple',
  'advanced',
  'settings',
  'routines',
  'settings-providers',
  'harnesses',
  'skills',
  'plugins',
  'models',
  'crash-reports',
  'store-reviews',
  'backend-kit',
];

/** Screens that render one project (`simple`, `advanced`). */
const PROJECT_SCREENS: readonly Screen[] = ['simple', 'advanced'];

/** Screens that render one run (`run`, `gates`, `artifacts`). */
const RUN_SCREENS: readonly Screen[] = ['run', 'gates', 'artifacts'];

/** Screens whose own layout owns the column, so the bench gives them the full width (§10). */
const WORKBENCH_SCREENS: readonly Screen[] = ['simple', 'advanced'];

/** The screen `search` (a `location.search` string) asks for, or `null` for "no deep link". */
export function requestedScreen(search: string): Screen | null {
  const value = new URLSearchParams(search).get('screen');
  if (value === null) return null;
  return (DEEP_LINK_SCREENS as readonly string[]).includes(value) ? (value as Screen) : null;
}

/** Where the shell opens, and what it has to select to get there. */
interface StartupTarget {
  screen: Screen;
  project: ProjectSummary | null;
  run: RunSummary | null;
}

/**
 * Resolve the first screen: the deep link when it names a screen the shell can render, the owner's
 * saved mode otherwise.
 *
 * A screen that renders a project or a run needs one selected before it mounts, so the first project
 * (and its first run) is loaded here instead of each screen fetching its own. A deep link whose data
 * does not exist — no projects, or a project with no runs — falls back to the saved mode rather than
 * showing an empty screen.
 */
async function startupTarget(
  mode: WorkbenchMode,
  projects: ProjectSummary[],
  client: WarshaClient,
  search: string
): Promise<StartupTarget> {
  const wanted = requestedScreen(search);
  const none: StartupTarget = { screen: mode, project: null, run: null };
  if (wanted === null) return none;

  const wantsProject = PROJECT_SCREENS.includes(wanted);
  const wantsRun = RUN_SCREENS.includes(wanted);
  const project = wantsProject || wantsRun ? projects[0] ?? null : null;
  if ((wantsProject || wantsRun) && project === null) return none;

  let run: RunSummary | null = null;
  if (wantsRun && project !== null) {
    const runs = await client.listRuns(project.id);
    run = runs[0] ?? null;
    if (run === null) return { screen: mode, project, run: null };
  }

  return { screen: wanted, project, run };
}

// Check if onboarding is complete
async function checkOnboarding(): Promise<boolean> {
  try {
    const result = await invoke<string>('get_config', { key: 'onboarding_complete' });
    return result === 'true';
  } catch {
    return false;
  }
}

// One shell config key, or the empty string when the shell has nothing to say (a browser, or a
// command that failed). Callers treat empty as "not reported" rather than as a value.
async function readConfig(key: string): Promise<string> {
  try {
    return await invoke<string>('get_config', { key });
  } catch {
    return '';
  }
}

/**
 * Where the daemon is, and the token that reaches it.
 *
 * The shell starts `warshad` itself and lets the OS choose the ports, so neither the URL nor the
 * token can be a constant in this file: `src-tauri/src/lib.rs` publishes `daemon_url` (the RPC
 * base), `daemon_ws_url` (where `/events` is really served — a different listener, so a different
 * port) and `daemon_token` (the session credential), and `readDaemonEndpoint` in `./daemon` reads
 * the three back and shapes them. A value the shell did not report stays unresolved — there is no
 * development default and no invented token here: a browser that stubs nothing sees the bench
 * honestly offline. The Playwright harness (`e2e/harness.ts`) answers the three keys itself, which
 * is what lets the visual checks measure the same client a real shell drives.
 */

/** The mode the shell last saved for itself: `app_mode` in the Tauri config, not a daemon reading. */
async function getSavedMode(): Promise<WorkbenchMode> {
  try {
    const result = await invoke<string>('get_config', { key: 'app_mode' });
    return result === 'advanced' ? 'advanced' : 'simple';
  } catch {
    return 'simple';
  }
}

// Save mode
async function saveMode(mode: WorkbenchMode): Promise<void> {
  try {
    await invoke('set_config', { key: 'app_mode', value: mode });
  } catch (error) {
    console.error('Failed to save mode:', error);
  }
}

// Mark the first run done, so the wizard does not come back. The write is best-effort: losing it
// costs one repeat of the wizard at the next launch, not the project it created.
async function saveOnboardingComplete(): Promise<void> {
  try {
    await invoke('set_config', { key: 'onboarding_complete', value: 'true' });
  } catch (error) {
    console.error('Failed to save onboarding state:', error);
  }
}

/** The wire shape `postlaunch.crashes` answers, mapped to the screen's camelCase row. */
function toCrashReport(report: WireCrashReport): CrashReport {
  return {
    id: report.id,
    runId: report.run_id,
    message: report.message,
    stackTrace: report.stack_trace ?? null,
    occurredAt: report.occurred_at,
    sent: report.sent,
  };
}

/** The wire shape `postlaunch.reviews` answers, mapped to the screen's camelCase row. */
function toStoreReview(review: WireStoreReview): StoreReview {
  return {
    id: review.id,
    store: review.store,
    rating: review.rating,
    body: review.body,
    author: review.author,
    receivedAt: review.received_at,
  };
}

/** What a list the shell reads can be doing. §7: each of these has its own words on screen. */
type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

function AppContent() {
  const dir = useDirection();
  const locale = useLocale();
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [mode, setModeState] = useState<WorkbenchMode>('simple');
  const [client, setClient] = useState<WarshaClient | null>(null);
  const [endpoint, setEndpoint] = useState<DaemonEndpoint>(UNRESOLVED_ENDPOINT);
  const [, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunSummary | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [daemonOnline, setDaemonOnline] = useState(false);
  // The gates the bell counts and the instrument strip reports: `gates.list` for the run being shown.
  const [gates, setGates] = useState<GateSummary[] | null>(null);
  const [gatesState, setGatesState] = useState<LoadState>('idle');
  // The project's budget — the reading the instrument strip's meter and the Advanced costs plate share.
  const [budget, setBudget] = useState<{ spentUsd: number; totalUsd: number } | null>(null);
  // Post-launch care (M17): the two lists the daemon already answers (`postlaunch.crashes` /
  // `postlaunch.reviews`), read when the owner opens their tab.
  const [crashReports, setCrashReports] = useState<CrashReport[]>([]);
  const [crashState, setCrashState] = useState<LoadState>('idle');
  const [storeReviews, setStoreReviews] = useState<StoreReview[]>([]);
  const [reviewsState, setReviewsState] = useState<LoadState>('idle');
  // Settings → Routines / Providers (M8b): `warshad` has no routines.* or provider listing RPC on this
  // branch, so both lists start empty and the handlers are the seams a later RPC plugs into.
  const [routines] = useState<Routine[]>([]);
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  // Backend kit (M19): the backend kind, the enabled services, the tables the agent created and the
  // payments gate (shut until the owner approves it).
  const [backendKind, setBackendKind] = useState<BackendKind>('pocket_base');
  const [backendFeatures, setBackendFeatures] = useState<BackendFeature[]>([]);
  const [backendTables] = useState<BackendTable[]>([]);
  const [paymentsGate] = useState<PaymentsGateStatus>({ enabled: false });
  const tablistRef = useRef<HTMLDivElement>(null);

  // ------------------------------------------------------------------ start-up: client, mode, screen
  useEffect(() => {
    const initApp = async () => {
      try {
        const daemon = await readDaemonEndpoint(readConfig);
        setEndpoint(daemon);
        if (daemon.baseUrl === '') {
          // No shell reported where the daemon answers. The honest reading is "offline":
          // the bench does not dial a guessed port with an invented credential, and the
          // wizard's own start-up read is what says so on screen.
          setDaemonOnline(false);
          setScreen('onboarding');
          return;
        }
        const apiClient = createClient(daemon.baseUrl, daemon.token);
        setClient(apiClient);

        const complete = await checkOnboarding();
        setOnboardingComplete(complete);

        const saved = await getSavedMode();
        setModeState(saved);

        if (!complete) {
          setScreen('onboarding');
          return;
        }

        const projectsData = await apiClient.listProjects();
        setProjects(projectsData);
        // The start-up read is the shell's evidence that the daemon answers at all (§7).
        setDaemonOnline(true);

        const target = await startupTarget(saved, projectsData, apiClient, window.location.search);
        if (target.project) setSelectedProject(target.project);
        if (target.run) setSelectedRun(target.run);
        setScreen(target.screen);
      } catch (error) {
        console.error('Failed to initialize app:', error);
        setDaemonOnline(false);
        setScreen('onboarding');
      }
    };
    initApp();
  }, []);

  const setMode = useCallback((next: WorkbenchMode) => {
    // §3: the switch keeps the project, the run and the screen it belongs to — only the depth changes.
    setModeState(next);
    setScreen(next);
    void saveMode(next);
  }, []);

  /** Read the gates of the run the bench is showing — the bell's count and the strip's reading. */
  const loadGates = useCallback(() => {
    if (client === null || selectedRun === null) {
      setGates(null);
      setGatesState('idle');
      return;
    }
    let cancelled = false;
    setGatesState('loading');
    client
      .getGates(selectedRun.id)
      .then((list) => {
        if (cancelled) return;
        setGates(list);
        setGatesState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setGatesState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [client, selectedRun]);

  useEffect(() => loadGates(), [loadGates]);

  /** Hydrate providers from the daemon on mount / client connect (Wave 3). */
  useEffect(() => {
    if (client === null || typeof client.listProviders !== 'function') return;
    let cancelled = false;
    client
      .listProviders()
      .then((rows) => {
        if (cancelled) return;
        setProviders(
          rows.map((p) => ({
            name: p.name,
            mode: 'auto',
            enabled: p.enabled,
          }))
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);

  /** The project's budget, for the strip's meter (§4: one reading, two surfaces). */
  useEffect(() => {
    if (client === null || selectedProject === null) {
      setBudget(null);
      return undefined;
    }
    let cancelled = false;
    client
      .getProjectBudget(selectedProject.id)
      .then((status) => {
        if (!cancelled) setBudget({ spentUsd: status.spentUsd, totalUsd: status.totalBudgetUsd });
      })
      .catch(() => {
        // A budget the daemon has not recorded is "not reported", never `$0` (§7).
        if (!cancelled) setBudget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, selectedProject]);

  /** Read one post-launch list, mapping the wire shape into the screen's row shape. */
  const loadCrashReports = useCallback(() => {
    if (client === null) return;
    setCrashState('loading');
    client
      .listCrashReports()
      .then((list) => {
        setCrashReports(list.map(toCrashReport));
        setCrashState('ready');
      })
      .catch(() => setCrashState('failed'));
  }, [client]);

  const loadStoreReviews = useCallback(() => {
    if (client === null) return;
    setReviewsState('loading');
    client
      .listStoreReviews()
      .then((list) => {
        setStoreReviews(list.map(toStoreReview));
        setReviewsState('ready');
      })
      .catch(() => setReviewsState('failed'));
  }, [client]);

  // The lists are read when their tab opens — not at start-up, so a session that never visits Settings
  // asks the daemon for nothing it did not need.
  useEffect(() => {
    if (screen === 'crash-reports' && crashState === 'idle') loadCrashReports();
    if (screen === 'store-reviews' && reviewsState === 'idle') loadStoreReviews();
  }, [crashState, loadCrashReports, loadStoreReviews, reviewsState, screen]);

  /**
   * Leave the first-run wizard.
   *
   * The wizard has already created the project through `@warsha/client`; this records that the first
   * run is done (the `set_config` / `onboarding_complete` seam `checkOnboarding` reads back), selects
   * what it created, and opens the owner's mode on it.
   */
  const handleOnboardingComplete = (project: ProjectSummary) => {
    void saveOnboardingComplete();
    setOnboardingComplete(true);
    setSelectedProject(project);
    setScreen(mode);
    if (client) {
      client.listProjects().then(setProjects).catch(() => undefined);
    }
  };

  const handleProjectSelect = (project: ProjectSummary) => {
    setSelectedProject(project);
    setScreen(mode);
  };

  const openScreen = (target: Screen) => () => setScreen(target);

  // Routines: the registry and its runner live in `warsha-pipeline`, but the daemon exposes no
  // routines.* method yet, so these three only record the seam. Nothing is scheduled or executed here.
  const handleRoutineRun = (_id: string) => {
    // TODO(M20 wiring): call the daemon's routines.run-now RPC once it exists.
  };
  const handleRoutinePause = (_id: string) => {
    // TODO(M20 wiring): call the daemon's routines.pause RPC once it exists.
  };
  const handleRoutineResume = (_id: string) => {
    // TODO(M20 wiring): call the daemon's routines.resume RPC once it exists.
  };

  // Settings → Providers (M16): every provider is off by default, so the row edits only touch the list
  // this shell holds; persisting them needs the settings RPC.
  const handleProviderToggle = (name: string, enabled: boolean) => {
    setProviders((current) =>
      current.map((entry) => (entry.name === name ? { ...entry, enabled } : entry))
    );
  };
  const handleProviderMode = (name: string, provider: ProviderMode) => {
    setProviders((current) =>
      current.map((entry) => (entry.name === name ? { ...entry, mode: provider } : entry))
    );
  };
  const handleProviderPin = (name: string, version: string) => {
    setProviders((current) =>
      current.map((entry) => (entry.name === name ? { ...entry, pinnedVersion: version } : entry))
    );
  };

  // Backend kit (M19): the panel's edits are local; the MCP client that creates the tables, policies and
  // buckets, and the export that writes the SQL dump, are not wired.
  const handleBackendKind = (kind: BackendKind) => {
    setBackendKind(kind);
  };
  const handleBackendFeature = (feature: BackendFeature, enabled: boolean) => {
    setBackendFeatures((current) =>
      enabled
        ? [...current.filter((entry) => entry !== feature), feature]
        : current.filter((entry) => entry !== feature)
    );
  };
  const handleBackendExport = () => {
    // TODO(M20 wiring): call the daemon's backend-kit export RPC once it exists.
  };

  // ------------------------------------------------------------------- the settings tab strip (§9)
  const onTabsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const nodes = tablistRef.current?.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
    if (!nodes || nodes.length === 0) return;
    const rtl = dir === 'rtl';
    const forward = event.key === 'ArrowRight' ? !rtl : event.key === 'ArrowLeft' ? rtl : false;
    const back = event.key === 'ArrowLeft' ? !rtl : event.key === 'ArrowRight' ? rtl : false;
    const order = [...nodes];
    const current = order.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (forward) next = (current + 1) % order.length;
    else if (back) next = (current - 1 + order.length) % order.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    if (next === null) return;
    // Manual activation: the arrows move focus, Enter or Space (this button's own keys) selects.
    event.preventDefault();
    order[next]?.focus();
  };

  const renderSettingsTabs = () => (
    <div
      ref={tablistRef}
      dir={dir}
      role="tablist"
      aria-label={t('settings.tabs', {}, locale)}
      data-testid="settings-tabs"
      onKeyDown={onTabsKeyDown}
      className="bench-settings-tabs"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 'var(--warsha-space-1)',
        borderBlockEnd: 'var(--warsha-size-rule) solid var(--warsha-bench-rule)',
        backgroundColor: 'var(--warsha-color-surface)',
        overflowX: 'auto',
        minInlineSize: 0,
      }}
    >
      {SETTINGS_SCREENS.map((target) => {
        const selected = screen === target;
        return (
          <Button
            key={target}
            role="tab"
            aria-selected={selected}
            // Roving tabindex: one Tab stop for the whole strip, arrows for the rest (§9).
            tabIndex={selected ? 0 : -1}
            aria-controls={`settings-panel-${target}`}
            id={`settings-panel-${target}-tab`}
            variant="ghost"
            size="sm"
            dir={dir}
            data-testid={`settings-tab-${target}`}
            onClick={openScreen(target)}
            style={{
              flex: 'none',
              borderRadius: 0,
              borderBlockEnd: selected
                ? 'var(--warsha-size-edge) solid var(--warsha-signal-text)'
                : 'var(--warsha-size-edge) solid transparent',
              backgroundColor: 'transparent',
              color: 'var(--warsha-color-text)',
              fontWeight: selected
                ? 'var(--warsha-font-weight-bold)'
                : 'var(--warsha-font-weight-medium)',
              paddingInline: 'var(--warsha-space-3)',
              minBlockSize: 'var(--warsha-size-touch)',
            }}
          >
            {settingsTabLabel(target, locale)}
          </Button>
        );
      })}
    </div>
  );

  /** A settings screen, inside the tab strip and named as its panel (§9's tab/panel pair). */
  const settingsScreen = (children: ReactNode): ReactNode => (
    <Box dir={dir} className="bench-settings" style={{ minHeight: '100%' }}>
      {renderSettingsTabs()}
      <div {...tabPanelProps(`settings-panel-${screen}`)} dir={dir} style={{ minInlineSize: 0, flex: 1 }}>
        {children}
      </div>
    </Box>
  );

  const renderMainContent = () => {
    if (!client) {
      return (
        <Box dir={dir} style={{ display: 'flex', justifyContent: 'center', paddingBlock: 'var(--warsha-space-8)' }}>
          <Skeleton label={t('app.loading', {}, locale)} lines={3} variant="row" />
        </Box>
      );
    }

    switch (screen) {
      case 'projects':
        return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;

      case 'run': {
        const run = selectedRun;
        if (!run) return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
        return <RunView client={client} run={run} onBack={() => setScreen('projects')} />;
      }

      case 'simple': {
        const project = selectedProject;
        if (!project) return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
        return (
          <SimpleMode
            client={client}
            project={project}
            endpoint={endpoint}
            onBack={() => setScreen('projects')}
            onModeChange={setMode}
          />
        );
      }

      case 'advanced': {
        const project = selectedProject;
        if (!project) return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
        return (
          <AdvancedMode
            client={client}
            project={project}
            endpoint={endpoint}
            onBack={() => setScreen('projects')}
            onModeChange={setMode}
          />
        );
      }

      case 'gates': {
        const run = selectedRun;
        if (!run) return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
        return <GatesInbox client={client} run={run} onBack={() => setScreen('run')} />;
      }

      case 'artifacts': {
        const run = selectedRun;
        if (!run) return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
        return <ArtifactViewer client={client} run={run} onBack={() => setScreen('run')} />;
      }

      case 'providers':
        return <ProvidersSettings client={client} onBack={() => setScreen('projects')} project={selectedProject} />;

      case 'roles':
        return <RolesSettings client={client} onBack={() => setScreen('projects')} />;

      case 'budgets':
        return <Budgets client={client} onBack={() => setScreen('projects')} />;

      case 'devices':
        return <Devices client={client} onBack={() => setScreen('projects')} />;

      case 'settings':
        return settingsScreen(<SettingsScreen client={client} onBack={() => setScreen('projects')} project={selectedProject} />);

      case 'routines':
        return settingsScreen(
          <Routines
            routines={routines}
            onRun={handleRoutineRun}
            onPause={handleRoutinePause}
            onResume={handleRoutineResume}
          />
        );

      case 'settings-providers':
        return settingsScreen(
          <>
            <SettingsProviders
              providers={providers}
              onModeChange={handleProviderMode}
              onToggle={handleProviderToggle}
              onPinVersion={handleProviderPin}
              client={client}
            />
            {/* One-click setup (M14b): the six presets and the network-free "Test connection". `onSave`
                has no settings RPC behind it yet. */}
            <Box dir={dir} style={{ paddingInline: 'var(--warsha-space-4)', paddingBlock: 'var(--warsha-space-3)' }}>
              <ProviderSetupWizard />
            </Box>
          </>
        );

      case 'harnesses':
        return settingsScreen(<HarnessesSettings client={client} project={selectedProject} />);

      case 'skills':
        return settingsScreen(<SkillsSettings client={client} project={selectedProject} />);

      case 'plugins':
        return settingsScreen(<PluginsSettings client={client} project={selectedProject} />);

      case 'models':
        return settingsScreen(<ModelsSettings client={client} project={selectedProject} />);

      case 'crash-reports':
        return settingsScreen(
          <CrashReports
            reports={crashReports}
            loading={crashState === 'loading'}
            failed={crashState === 'failed'}
            onRetry={loadCrashReports}
          />
        );

      case 'store-reviews':
        return settingsScreen(
          <StoreReviews
            reviews={storeReviews}
            loading={reviewsState === 'loading'}
            failed={reviewsState === 'failed'}
            onRetry={loadStoreReviews}
          />
        );

      case 'backend-kit':
        return settingsScreen(
          // The measure is `.bench-main--document`'s (§10), so the plate only needs its own padding.
          <Box dir={dir} style={{ padding: 'var(--warsha-space-4)', inlineSize: '100%', minInlineSize: 0 }}>
            <BackendKitPanel
              kind={backendKind}
              features={backendFeatures}
              tables={backendTables}
              payments={paymentsGate}
              onKindChange={handleBackendKind}
              onToggleFeature={handleBackendFeature}
              onExport={handleBackendExport}
            />
          </Box>
        );

      default:
        return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
    }
  };

  const pendingGates = gates === null ? null : gates.filter((gate) => gate.state.state === 'pending').length;

  if (!onboardingComplete) {
    // The first-run wizard owns everything up to the owner's first project, and the bench's chrome is
    // hidden while it speaks (§5: "instrument strip hidden"). It talks to the daemon through the same
    // client the shell uses (`client` is `null` only until start-up has built it).
    //
    // B4: it is also the bench, so it is in the bench's landmark. axe reported the wizard's whole tree as
    // content outside a region (`landmark-one-main`, `region`): a screen-reader user arriving for the
    // first time — the one time they will — had nothing to jump to. `<main>` with the same accessible
    // name the workbench uses is the fix, and `tabIndex={-1}` keeps it a target for a skip link later.
    return (
      <main
        dir={dir}
        className="bench bench--wizard"
        tabIndex={-1}
        aria-label={t('app.bench_label', {}, locale)}
        style={{ display: 'block' }}
      >
        <Onboarding client={client} onComplete={handleOnboardingComplete} />
      </main>
    );
  }

  return (
    <div dir={dir} className="bench" data-testid="bench">
      {/* §9: the keyboard gets into the bench without walking the chrome first. */}
      <a dir={dir} className="bench-skip" href="#bench-main">
        {t('app.skip_to_bench', {}, locale)}
      </a>

      <BenchTopbar
        project={selectedProject}
        run={selectedRun}
        mode={mode}
        onModeChange={setMode}
        gates={gates}
        gatesLoading={gatesState === 'loading'}
        gatesFailed={gatesState === 'failed'}
        onOpenGates={openScreen('gates')}
        onRetryGates={() => {
          void loadGates();
        }}
        onOpenSettings={openScreen('settings')}
      />

      <InstrumentStrip
        daemonOnline={daemonOnline}
        run={selectedRun}
        gatesWaiting={pendingGates}
        budget={budget}
      />

      {/* The screen. §10: the workbench owns the full width; a document screen gets the 1100px measure. */}
      <main
        id="bench-main"
        dir={dir}
        tabIndex={-1}
        className={
          WORKBENCH_SCREENS.includes(screen) ? 'bench-main bench-main--workbench' : 'bench-main bench-main--document'
        }
      >
        {renderMainContent()}
      </main>
    </div>
  );
}

export default function App() {
  // The theme outranks every screen: the provider writes `data-theme` on the document root, and
  // `main.tsx` applies the stored choice before the first paint so a dark app does not flash light.
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
