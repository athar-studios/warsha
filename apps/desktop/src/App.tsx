// @warsha/desktop — Main app component with Simple/Advanced mode routing
import { invoke } from '@tauri-apps/api/core';
import { createClient, type WarshaClient, type ProjectSummary, type RunSummary } from '@warsha/client';
import { useLocale, useDirection, t, type Locale } from '@warsha/i18n';
import { Box, Text, Button } from '@warsha/ui';
import React, { useState, useEffect, createContext, useContext, ReactNode } from 'react';

import {
  BackendKitPanel,
  type BackendFeature,
  type BackendKind,
  type BackendTable,
  type PaymentsGateStatus,
} from './components/BackendKitPanel';
import { PermissionModeChip, type PermissionMode } from './components/PermissionModeChip';
import { PlanModeBadge, type AgentMode } from './components/PlanModeBadge';
import { ProviderSetupWizard } from './components/ProviderSetupWizard';
import { StatusStrip, initialDeliveryStages, type DeliveryStage } from './components/StatusStrip';
import { ThemeToggle } from './components/ThemeToggle';
import { AdvancedMode } from './screens/AdvancedMode';
import { ArtifactViewer } from './screens/ArtifactViewer';
import { Budgets } from './screens/Budgets';
import { CrashReports, type CrashReport } from './screens/CrashReports';
import { Devices } from './screens/Devices';
import { GatesInbox } from './screens/GatesInbox';
import { Onboarding } from './screens/Onboarding';
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
import { StoreReviews, type StoreReview } from './screens/StoreReviews';
import { ThemeProvider, useTheme } from './theme';


// Screen types
type Screen = 
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
  | 'crash-reports'
  | 'store-reviews'
  | 'backend-kit';

// The Settings tab strip (PLAN.md M20 wiring batch): every settings sub-screen can
// reach the others, so none of them is a dead end. Order is the sidebar order.
const SETTINGS_SCREENS: Screen[] = [
  'settings',
  'settings-providers',
  'routines',
  'crash-reports',
  'store-reviews',
  'backend-kit',
];

// Tab labels. `t` returns the key itself when the catalog has no entry yet, so the
// label falls back to the local text until `@warsha/i18n` gains the key (the same
// `localized` rule the M8b/M14a/M17 components use).
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

function settingsTabLabel(screen: Screen, locale: Locale): string {
  switch (screen) {
    case 'settings-providers':
      return localized('nav.providers', 'Providers', locale);
    case 'routines':
      return localized('settings.routines', 'Routines', locale);
    case 'crash-reports':
      return localized('settings.crashReports', 'Crash reports', locale);
    case 'store-reviews':
      return localized('settings.storeReviews', 'Store reviews', locale);
    case 'backend-kit':
      return localized('settings.backendKit', 'Backend kit', locale);
    default:
      return localized('nav.settings', 'Settings', locale);
  }
}

// App mode
type AppMode = 'simple' | 'advanced';

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
  'crash-reports',
  'store-reviews',
  'backend-kit',
];

/** Screens that render one project (`simple`, `advanced`). */
const PROJECT_SCREENS: readonly Screen[] = ['simple', 'advanced'];

/** Screens that render one run (`run`, `gates`, `artifacts`). */
const RUN_SCREENS: readonly Screen[] = ['run', 'gates', 'artifacts'];

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
  mode: AppMode,
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

// Mode context
interface ModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

export function useMode() {
  const context = useContext(ModeContext);
  if (!context) {
    throw new Error('useMode must be used within ModeProvider');
  }
  return context;
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
 * token can be a constant in this file: `src-tauri/src/lib.rs` publishes both as the `daemon_url`
 * and `daemon_token` config keys, and this reads them back. A reported URL that is not an HTTP
 * URL is ignored — an empty or malformed answer must not become the client's endpoint.
 *
 * A browser has no shell: `pnpm dev` in a plain browser and the Playwright harness
 * (`e2e/harness.ts`) both answer those keys with the empty string, and the development defaults
 * below are what the harness stubs, so the visual checks measure the same client they always did.
 */
const DEV_DAEMON_URL = 'http://127.0.0.1:8766';
const DEV_DAEMON_TOKEN = 'test-token';

async function daemonEndpoint(): Promise<{ baseUrl: string; token: string }> {
  const reportedUrl = await readConfig('daemon_url');
  const reportedToken = await readConfig('daemon_token');
  const baseUrl = /^https?:\/\/\S+$/.test(reportedUrl)
    ? reportedUrl.replace(/\/+$/, '')
    : DEV_DAEMON_URL;
  return { baseUrl, token: reportedToken === '' ? DEV_DAEMON_TOKEN : reportedToken };
}

// Get saved mode
async function getSavedMode(): Promise<AppMode> {
  try {
    const result = await invoke<string>('get_config', { key: 'app_mode' });
    return (result as AppMode) || 'simple';
  } catch {
    return 'simple';
  }
}

// Save mode
async function saveMode(mode: AppMode): Promise<void> {
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

function ModeProvider({ children, initialMode }: { children: ReactNode; initialMode: AppMode }) {
  const [mode, setMode] = useState<AppMode>(initialMode);

  const handleSetMode = async (newMode: AppMode) => {
    setMode(newMode);
    await saveMode(newMode);
  };

  return (
    <ModeContext.Provider value={{ mode, setMode: handleSetMode }}>
      {children}
    </ModeContext.Provider>
  );
}

function AppContent() {
  const dir = useDirection();
  const locale = useLocale();
  // The owner's theme choice (light / dark / system). The provider writes `data-theme`; this
  // shell only mounts the switch.
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [client, setClient] = useState<WarshaClient | null>(null);
  const [, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunSummary | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [savedMode, setSavedMode] = useState<AppMode>('simple');
  // Work protection: per-session permission mode, shown in the status strip.
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('ask_for_risky');
  // Ship status strip (M5a): the four delivery stages. Seeded pending, because
  // nothing has reported a check yet; the CI/GitHub check feed replaces this
  // initializer once the delivery RPC exists.
  const [deliveryStages] = useState<DeliveryStage[]>(initialDeliveryStages);
  // Agent workflow (M18): Plan/Agent mode, shown next to the mode toggle. The badge
  // only asks for a switch; Plan → Agent needs the owner's approval card, so this
  // shell records the requested mode and the gates inbox grants it.
  const [agentMode, setAgentMode] = useState<AgentMode>('plan');
  // Settings → Routines / Providers (M8b): `warshad` has no routines.* or provider
  // listing RPC on this branch, so both lists start empty and the handlers are the
  // seams a later RPC plugs into.
  const [routines] = useState<Routine[]>([]);
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  // Post-launch care (M17): crash reports and store reviews are read-only lists;
  // nothing records or fetches them yet.
  const [crashReports] = useState<CrashReport[]>([]);
  const [storeReviews] = useState<StoreReview[]>([]);
  // Backend kit (M19): the backend kind, the enabled services, the tables the agent
  // created and the payments gate (shut until the owner approves it).
  const [backendKind, setBackendKind] = useState<BackendKind>('pocket_base');
  const [backendFeatures, setBackendFeatures] = useState<BackendFeature[]>([]);
  const [backendTables] = useState<BackendTable[]>([]);
  const [paymentsGate] = useState<PaymentsGateStatus>({ enabled: false });

  // Initialize client and load mode
  useEffect(() => {
    const initApp = async () => {
      try {
        const { baseUrl, token } = await daemonEndpoint();
        const apiClient = createClient(baseUrl, token);
        setClient(apiClient);

        const complete = await checkOnboarding();
        setOnboardingComplete(complete);

        const mode = await getSavedMode();
        setSavedMode(mode);

        if (!complete) {
          setScreen('onboarding');
          return;
        }

        const projectsData = await apiClient.listProjects();
        setProjects(projectsData);

        const target = await startupTarget(mode, projectsData, apiClient, window.location.search);
        if (target.project) setSelectedProject(target.project);
        if (target.run) setSelectedRun(target.run);
        setScreen(target.screen);
      } catch (error) {
        console.error('Failed to initialize app:', error);
        setScreen('onboarding');
      }
    };
    initApp();
  }, []);

  /**
   * Leave the first-run wizard.
   *
   * The wizard has already created the project through `@warsha/client`; this records that the first
   * run is done (the `set_config` / `onboarding_complete` seam `checkOnboarding` reads back), selects
   * what it created, and opens the owner's saved mode on it.
   */
  const handleOnboardingComplete = (project: ProjectSummary) => {
    void saveOnboardingComplete();
    setOnboardingComplete(true);
    setSelectedProject(project);
    setScreen(savedMode);
    if (client) {
      client.listProjects().then(setProjects);
    }
  };

  // Not wired to a screen yet: the create-project flow still lives inside ProjectsBoard. Kept as-is
  // because rewiring it is component behaviour, which the M20 foundations brief excludes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the M20 wiring follow-up
  const handleCreateProject = async (name: string, idea: string) => {
    if (!client) return;
    try {
      const project = await client.createProject(name);
      await client.startRun(project.id, idea);
      const projectsData = await client.listProjects();
      setProjects(projectsData);
      setSelectedProject(project);
      const runs = await client.listRuns(project.id);
      if (runs.length > 0) {
        setSelectedRun(runs[0]);
        setScreen(savedMode);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  // Routines: the registry and its runner live in `warsha-pipeline`, but the daemon
  // exposes no routines.* method yet, so these three only record the seam. Nothing is
  // scheduled or executed from the shell.
  const handleRoutineRun = (_id: string) => {
    // TODO(M20 wiring): call the daemon's routines.run-now RPC once it exists.
  };
  const handleRoutinePause = (_id: string) => {
    // TODO(M20 wiring): call the daemon's routines.pause RPC once it exists.
  };
  const handleRoutineResume = (_id: string) => {
    // TODO(M20 wiring): call the daemon's routines.resume RPC once it exists.
  };

  // Settings → Providers (M16): every provider is off by default, so the row edits
  // only touch the list this shell holds; persisting them needs the settings RPC.
  const handleProviderToggle = (name: string, enabled: boolean) => {
    setProviders((current) =>
      current.map((entry) => (entry.name === name ? { ...entry, enabled } : entry))
    );
  };
  const handleProviderMode = (name: string, mode: ProviderMode) => {
    setProviders((current) =>
      current.map((entry) => (entry.name === name ? { ...entry, mode } : entry))
    );
  };
  const handleProviderPin = (name: string, version: string) => {
    setProviders((current) =>
      current.map((entry) => (entry.name === name ? { ...entry, pinnedVersion: version } : entry))
    );
  };

  // Backend kit (M19): the panel's edits are local; the MCP client that creates the
  // tables, policies and buckets, and the export that writes the SQL dump, are not wired.
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

  const renderScreen = () => {
    if (!onboardingComplete) {
      // The first-run wizard owns everything up to the owner's first project; it talks to the daemon
      // through the same client the shell uses (`client` is `null` only until start-up has built it).
      return <Onboarding client={client} onComplete={handleOnboardingComplete} />;
    }

    if (!client) {
      return (
        <Box dir={dir} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <Text dir={dir}>{t('app.loading', {}, locale) || 'Loading...'}</Text>
        </Box>
      );
    }

    // Main navigation for both modes
    const navigation = (
      <Box dir={dir} style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100vh',
        backgroundColor: 'var(--warsha-color-bg)'
      }}>
        {/* Top Bar */}
        <Box dir={dir} style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          // The bar carries the brand, the ship status, the permission chip, the Plan/Agent badge,
          // the mode toggle, the theme switch and Settings. On a narrow window that is more than one
          // row of controls, so it wraps: without this the row stayed 1124px wide in a 390px window
          // and the whole document scrolled sideways.
          flexWrap: 'wrap',
          rowGap: 'var(--warsha-space-2)',
          paddingInline: 'var(--warsha-space-4)',
          paddingBlock: 'var(--warsha-space-3)',
          backgroundColor: 'var(--warsha-color-surface)',
          borderBottom: '1px solid var(--warsha-color-border)',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}>
          <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-3)' }}>
            <Text size="xl" weight="bold" style={{ color: 'var(--warsha-color-accent-strong)' }}>{t('app.brand') || 'Warsha'}</Text>
            <Text size="sm" style={{ color: 'var(--warsha-color-text-muted)' }}>{t('app.version') || 'v0.1.0'}</Text>
          </Box>

          <Box dir={dir} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 'var(--warsha-space-2)', gap: 'var(--warsha-space-3)' }}>
            {/* Ship status strip: Code checks → Builds → Tests → Store-ready */}
            <StatusStrip stages={deliveryStages} />
          </Box>

          <Box dir={dir} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 'var(--warsha-space-2)', gap: 'var(--warsha-space-3)' }}>
            {/* Work protection: permission mode */}
            <PermissionModeChip mode={permissionMode} onChange={setPermissionMode} />

            {/* Agent workflow: Plan/Agent badge, next to the mode toggle */}
            <PlanModeBadge mode={agentMode} onToggle={setAgentMode} />

            {/* Mode Toggle */}
            <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-2)', backgroundColor: 'var(--warsha-color-surface-muted)', borderRadius: '8px', padding: 'var(--warsha-space-1)' }}>
              <Button
                variant={screen === 'simple' ? 'primary' : 'ghost'}
                size="sm"
                dir={dir}
                onClick={() => setScreen('simple')}
              >
                {t('app.simpleMode') || 'Simple'}
              </Button>
              <Button
                variant={screen === 'advanced' ? 'primary' : 'ghost'}
                size="sm"
                dir={dir}
                onClick={() => setScreen('advanced')}
              >
                {t('app.advancedMode') || 'Advanced'}
              </Button>
            </Box>
            
            {/* Theme: light / dark / system, applied as `data-theme` on <html> */}
            <ThemeToggle preference={themePreference} onChange={setThemePreference} />

            <Button variant="ghost" size="sm" dir={dir} data-testid="settings-open" onClick={() => setScreen('settings')}>
              {t('app.settings') || 'Settings'}
            </Button>
          </Box>
        </Box>

        {/* Content */}
        <Box dir={dir} style={{ flex: 1, overflow: 'auto' }}>
          {renderMainContent()}
        </Box>
      </Box>
    );

    return (
      <ModeProvider initialMode={savedMode}>
        {navigation}
      </ModeProvider>
    );
  };

  // The tab strip the settings sub-screens share, so Routines, Providers, the
  // post-launch lists and the backend kit are all reachable from Settings.
  const renderSettingsTabs = () => (
    <div
      dir={dir}
      role="tablist"
      data-testid="settings-tabs"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--warsha-space-2)',
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: '10px',
        backgroundColor: 'var(--warsha-color-surface)',
        borderBottom: '1px solid var(--warsha-color-border)',
        flexWrap: 'wrap',
      }}
    >
      {SETTINGS_SCREENS.map((target) => (
        <Button
          key={target}
          role="tab"
          aria-selected={screen === target}
          variant={screen === target ? 'primary' : 'ghost'}
          size="sm"
          dir={dir}
          data-testid={`settings-tab-${target}`}
          onClick={() => setScreen(target)}
        >
          {settingsTabLabel(target, locale)}
        </Button>
      ))}
    </div>
  );

  const renderMainContent = () => {
    if (!client) {
      return (
        <Box dir={dir} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <Text dir={dir}>{t('app.loading', {}, locale) || 'Loading...'}</Text>
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
        return <SimpleMode client={client} project={project} onBack={() => setScreen('projects')} />;
      }
      
      case 'advanced': {
        const project = selectedProject;
        if (!project) return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
        return <AdvancedMode client={client} project={project} onBack={() => setScreen('projects')} />;
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
        return <ProvidersSettings client={client} onBack={() => setScreen('projects')} />;
      
      case 'roles':
        return <RolesSettings client={client} onBack={() => setScreen('projects')} />;
      
      case 'budgets':
        return <Budgets client={client} onBack={() => setScreen('projects')} />;
      
      case 'devices':
        return <Devices client={client} onBack={() => setScreen('projects')} />;
      
      case 'settings':
        return (
          <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
            {renderSettingsTabs()}
            <SettingsScreen client={client} onBack={() => setScreen('projects')} />
          </Box>
        );

      case 'routines':
        return (
          <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
            {renderSettingsTabs()}
            <Routines
              routines={routines}
              onRun={handleRoutineRun}
              onPause={handleRoutinePause}
              onResume={handleRoutineResume}
            />
          </Box>
        );

      case 'settings-providers':
        return (
          <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
            {renderSettingsTabs()}
            <SettingsProviders
              providers={providers}
              onModeChange={handleProviderMode}
              onToggle={handleProviderToggle}
              onPinVersion={handleProviderPin}
            />
            {/* One-click setup (M14b): the six presets and the network-free
                "Test connection". `onSave` has no settings RPC behind it yet. */}
            <Box dir={dir} style={{ paddingInline: 'var(--warsha-space-4)', paddingBlock: 'var(--warsha-space-3)' }}>
              <ProviderSetupWizard />
            </Box>
          </Box>
        );

      case 'crash-reports':
        return (
          <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
            {renderSettingsTabs()}
            <CrashReports reports={crashReports} />
          </Box>
        );

      case 'store-reviews':
        return (
          <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
            {renderSettingsTabs()}
            <StoreReviews reviews={storeReviews} />
          </Box>
        );

      case 'backend-kit':
        return (
          <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
            {renderSettingsTabs()}
            <Box dir={dir} style={{ padding: 'var(--warsha-space-4)', maxWidth: '900px', margin: '0 auto', width: '100%' }}>
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
          </Box>
        );
      
      default:
        return <ProjectsBoard client={client} onProjectSelect={handleProjectSelect} />;
    }
  };

  const handleProjectSelect = (project: ProjectSummary) => {
    setSelectedProject(project);
    setScreen(savedMode);
  };

  return (
    // The locale provider lives in `main.tsx`, above this component: `useLocale()` here has to read
    // the *live* choice, and a provider mounted inside this shell would shadow it — that is what
    // kept the app stuck in Arabic with a language picker that changed nothing.
    <Box dir={dir} className="app" style={{ minHeight: '100vh', backgroundColor: 'var(--warsha-color-bg)' }}>
      {renderScreen()}
    </Box>
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