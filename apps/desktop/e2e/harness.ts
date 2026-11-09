// @warsha/desktop — the browser harness for the visual, layout and accessibility checks.
//
// The desktop app is a Tauri + SPA: it reaches its shell only when `invoke('get_config', …)` succeeds
// and a daemon answers its JSON-RPC. A browser has neither, so this module stubs exactly those two
// edges — nothing else about the app is mocked, which is what makes the screenshots worth trusting.
//
// The invariants live in `./support/` and are re-exported here so a spec imports one module, not three:
//
//   * `layout.ts` — box geometry (undefined tokens, horizontal scroll, oversize, overlap, empty boxes);
//   * `a11y.ts`   — axe-core WCAG 2.1 AA, the keyboard walk, and the clip pass;
//   * `fonts.ts`  — proof that chromium laid the page out with the design's own faces.
//
// This file is the desktop half: the stubs, the fixtures, the screen list and the §7 states.
//
// Every case is deterministic by construction:
//
//   * fonts.googleapis.com is aborted, so no capture depends on the network. The families the token
//     stack names first come from the capture host's fontconfig instead, and `auditUsedFonts` proves
//     chromium really drew with them — which is what closes REDESIGN §14's caveat that "final font
//     metrics are not verified". The app bundle carries no font bytes;
//   * the theme and the locale are written into `localStorage` before the first paint, exactly as the
//     app reads them (`warsha.theme`, `warsha.locale`);
//   * the clock is pinned by `playwright.config.ts` (`timezoneId: 'UTC'`) plus `clock.setFixedTime`,
//     and every fixture date is a fixed ISO string;
//   * animations and transitions are zeroed twice — `prefers-reduced-motion` (which the token layer
//     honours) and a stylesheet override;
//   * the `/events` socket is mocked open and answers a fixed transcript, so the Simple and Advanced
//     benches show real lanes, costs and a gate event without a daemon.
import type { Page } from '@playwright/test';

import type { Locale, Theme, Viewport } from './support/layout';
import { CORE_VIEWPORT_NAMES, viewportsNamed } from './support/layout';

export {
  auditIsClean,
  auditLayout,
  describeAudit,
  LOCALES,
  THEMES,
  VIEWPORTS,
  viewportsNamed,
} from './support/layout';
export type { LayoutAudit, Locale, Theme, Viewport, ViewportName } from './support/layout';

export {
  auditClipping,
  auditFocusWalk,
  axeIsClean,
  clipsAreClean,
  describeAxe,
  describeAxeReport,
  describeClips,
  describeFocus,
  focusIsClean,
  runAxe,
} from './support/a11y';
export type { A11yAudit, AxeFinding, ClipAudit, FocusAudit, FocusStop } from './support/a11y';

export {
  auditUsedFonts,
  describeFonts,
  describeFontNotes,
  FONT_INSTALL_HINT,
  formatFonts,
  MONO_FAMILY,
  SANS_FAMILY,
} from './support/fonts';
export type { FontAudit, FontProbeResult } from './support/fonts';

/**
 * Every screen key the shell can route to (`apps/desktop/src/App.tsx`, `Screen`), plus one key per
 * first-run wizard state the owner can be in.
 */
export type ScreenId =
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
  | 'backend-kit'
  | 'onboarding-language'
  | 'onboarding-provider'
  | 'onboarding-provider-first-run'
  | 'onboarding-key'
  | 'onboarding-test-ok'
  | 'onboarding-test-failed'
  | 'onboarding-project';

/** The RPC methods `@warsha/client` can put on the wire; the stub table is checked against it. */
export const RPC_METHODS = [
  'agent.approve_mode',
  'agent.plan_mode',
  'agent.state',
  'agent.turn',
  'backend.export',
  'backend.get',
  'backend.set',
  'budget.set',
  'budget.show',
  'devices.list',
  'devices.pair',
  'devices.pair-start',
  'devices.revoke',
  'files.read',
  'files.tree',
  'gates.approve',
  'gates.changes',
  'gates.list',
  'gates.reject',
  'handoff.apply',
  'handoff.create',
  'harness.delete',
  'harness.get',
  'harness.import',
  'harness.list',
  'harness.select',
  'health',
  'integrations.connect',
  'integrations.disconnect',
  'integrations.list',
  'integrations.test',
  'models.add',
  'models.list',
  'models.remove',
  'plugins.configure',
  'plugins.install',
  'plugins.list',
  'plugins.remove',
  'plugins.toggle',
  'postlaunch.crashes',
  'postlaunch.reviews',
  'preferences.list',
  'preferences.record',
  'preview.start',
  'preview.status',
  'preview.stop',
  'projects.create',
  'projects.get',
  'projects.list',
  'providers.add',
  'providers.check_models',
  'providers.list',
  'providers.remove',
  'providers.test',
  'roles.list',
  'roles.set',
  'routines.get',
  'routines.list',
  'routines.pause',
  'routines.resume',
  'routines.run_now',
  'runmode.list',
  'runmode.set',
  'runs.advance',
  'runs.artifacts',
  'runs.cancel',
  'runs.events',
  'runs.followup',
  'runs.get',
  'runs.list',
  'runs.start',
  'runs.subscribe',
  'skills.delete',
  'skills.import',
  'skills.list',
  'skills.toggle',
] as const;
export type RpcMethod = (typeof RPC_METHODS)[number];

/**
 * The endpoint the stubbed shell reports, under the keys `src-tauri/src/lib.rs` publishes.
 *
 * The app resolves its daemon purely from the Tauri config (`daemon_url`, `daemon_ws_url`,
 * `daemon_token` — see `apps/desktop/src/daemon.ts`); it carries no development default, so a
 * browser has to hear these values from the shell stub or the benches honestly show offline.
 * The answers match a real daemon's layout exactly:
 *
 *   * `daemon_url` is the RPC base on the daemon's RPC listener (`ws_port`, 8766);
 *   * `daemon_ws_url` is where `/events` is actually served — the daemon's axum HTTP listener
 *     (`http_port`, 8765), reported in socket form because the events port is not the RPC port
 *     and cannot be derived from it (`crates/warshad/src/lib.rs` routes `/events` on
 *     `http_port`; the shell's own test asserts `ws://127.0.0.1:8765` for these defaults);
 *   * `daemon_token` is the bearer the stubbed RPC asserts on every request, and the credential
 *     the mocked `/events` handshake would carry as `warsha.token.<token>`.
 */
export const DAEMON_URL = 'http://127.0.0.1:8766';
export const DAEMON_WS_URL = 'ws://127.0.0.1:8765';
export const DAEMON_TOKEN = 'test-token';

/** The three config keys the stub merges into every case, in the shape the shell answers them. */
const DAEMON_CONFIG: Record<string, string> = {
  daemon_url: DAEMON_URL,
  daemon_ws_url: DAEMON_WS_URL,
  daemon_token: DAEMON_TOKEN,
};

/**
 * How far the first-run wizard is driven before a case is measured.
 *
 * Onboarding is decided by `get_config` alone (`App.tsx` refuses to deep-link into it), so a case
 * that measures the wizard's third state has to walk there the way the owner does: click, type a key,
 * let the stubbed daemon answer. `created` goes one step further and creates the project, which is
 * where the wizard leaves the screen to the shell.
 */
export type WizardDrive =
  | 'language'
  | 'provider'
  | 'key'
  | 'test-ok'
  | 'test-failed'
  | 'project'
  | 'created';

/** One method's answer for one case. */
export interface RpcBehaviour {
  /** Answer this instead of the default fixture. */
  result?: unknown;
  /** Answer a JSON-RPC error carrying this message (the daemon's own words, never UI copy). */
  error?: string;
  /** Wait this long before answering, so a screen's in-flight state is reachable. */
  delayMs?: number;
  /** Never answer at all: the transport fails, which is what "the daemon is not there" means. */
  unreachable?: boolean;
}

/** The §7 states, as the ids `states.spec.ts` and the evidence file use. */
export type ScenarioId =
  | 'default'
  | 'empty'
  | 'loading'
  | 'screen-loading'
  | 'error'
  | 'offline'
  | 'permission'
  | 'success'
  | 'parked'
  | 'no-ceiling'
  | 'dense';

/**
 * One of REDESIGN §7's states, expressed as what the daemon does.
 *
 * A state is not a class the harness paints: `empty` is a daemon that answers with nothing, `error`
 * is a daemon that refuses, `offline` is a daemon that is not there, `loading` is a daemon that has
 * not answered yet, and `permission` / `success` are gate and provider readings the owner really
 * sees. The screen's own code decides what each one looks like — which is the point of testing them.
 */
export interface Scenario {
  id: ScenarioId;
  /** What the evidence file says this state is. */
  note: string;
  /** Per-method overrides of the default fixtures. */
  fixtures: Partial<Record<RpcMethod, RpcBehaviour>>;
  /**
   * Whether to wait for the daemon to answer before measuring.
   *
   * `settled` is the normal case: every request has been answered, so the screen shows its content.
   * `pending` stops at the first paint, which is the only way to photograph a loading state without
   * inventing one.
   */
  settle: 'settled' | 'pending';
}

/**
 * One screen the suite checks.
 *
 * `rpc` is what the case must have called by the time it is measured: the stub records every method,
 * and a case that renders without reaching the daemon is exactly the failure this list exists to
 * catch. A method the stub has no answer for is reported in `StubReport.unimplemented` and fails the
 * case instead of quietly rendering an error state.
 */
export interface ScreenCase {
  id: ScreenId;
  /** The screen's own anchor — a `className` or `data-testid` the component already carries. */
  root: string;
  /** JSON-RPC methods the screen must have called before it can be measured. */
  rpc: readonly string[];
  /**
   * The widths this screen is photographed at.
   *
   * §10 gives every screen a different shape at 390/768/1440; only the benches change again at 320
   * (rails collapse to strips) and 1024 (the end panel appears), so those two are named per screen
   * rather than applied everywhere and photographed twice for the same layout.
   */
  viewports: readonly Viewport[];
  /** `location.search` for the case; `?screen=<id>` when absent. */
  search?: string;
  /** Tauri config the case answers `get_config` with, merged over the defaults. */
  config?: Record<string, string>;
  /** How far to drive the first-run wizard before measuring. */
  drive?: WizardDrive;
  /** Wait for this selector instead of the screen root (a state inside the screen). */
  ready?: string;
  /** What `providers.list` answers for this case. */
  providers?: readonly ProviderFixture[];
}

/** The three widths §10 says every screen changes at. */
const CORE: readonly Viewport[] = viewportsNamed(CORE_VIEWPORT_NAMES);

/** The five widths §10 gives the benches a different shape at. */
const BENCH: readonly Viewport[] = viewportsNamed([
  '320x568',
  '390x844',
  '768x1024',
  '1024x768',
  '1440x900',
]);

/** The widths the run-shaped screens change at (no end panel, so no 1024 row). */
const TALL: readonly Viewport[] = viewportsNamed(['320x568', '390x844', '768x1024', '1440x900']);

/**
 * The calls the shell puts on the wire before a screen mounts.
 *
 * `App.tsx` resolves the deep link first: a screen the shell had to select a project for has already
 * asked for the projects and, to pick the run inside it, the project's runs.
 */
const STARTUP = ['projects.list', 'runs.list'] as const;

/** A screen that renders one run: the shell read its gates and its budget before it mounted. */
const RUN_RPC = ['projects.list', 'runs.list', 'gates.list', 'budget.show'] as const;

/**
 * Every screen and wizard state the checks cover, with the widths §10 says it changes at and the calls
 * the screen really makes.
 *
 * The selector is the screen's own anchor — a `className` or `data-testid` the component already
 * carries — so a check fails loudly if a screen stops rendering instead of silently measuring
 * nothing. `?screen=` is how a screen is opened (the shell routes on state, not on URLs); the wizard
 * is the exception, because the shell decides it from `onboarding_complete` and nothing else.
 *
 * The `rpc` lists are what the shell and the screen put on the wire together, read off a driven
 * session: `App.tsx` resolves the deep link before anything mounts, so `projects.list` is always there
 * and `runs.list` joins it for a screen the shell had to select a project or a run for. A screen that
 * stops reaching its data — the failure a screenshot alone cannot see — drops one of these and fails.
 */
export const SCREENS: readonly ScreenCase[] = [
  // The benches: every width §10 reshapes them at.
  {
    id: 'simple',
    root: '.simple-mode',
    rpc: [...STARTUP, 'budget.show', 'gates.list'],
    viewports: BENCH,
  },
  {
    id: 'advanced',
    root: '.bench-advanced',
    rpc: [...STARTUP, 'budget.show', 'agent.state', 'runs.events'],
    config: { app_mode: 'advanced' },
    viewports: BENCH,
  },
  { id: 'gates', root: '.gates-inbox', rpc: RUN_RPC, viewports: TALL },
  {
    id: 'projects',
    root: '.projects-board',
    rpc: [...STARTUP, 'budget.show'],
    viewports: TALL,
  },
  { id: 'run', root: '.run-view', rpc: RUN_RPC, viewports: TALL },
  { id: 'artifacts', root: '.artifact-viewer', rpc: RUN_RPC, viewports: TALL },

  // The settings family: phone, tablet, reference desktop.
  { id: 'settings', root: '.settings-screen', rpc: ['projects.list'], viewports: CORE },
  { id: 'providers', root: '.providers-settings', rpc: ['projects.list', 'providers.list'], viewports: CORE },
  {
    id: 'roles',
    root: '.roles-settings',
    rpc: ['projects.list', 'providers.list', 'roles.list'],
    viewports: CORE,
  },
  { id: 'budgets', root: '.budgets', rpc: ['projects.list', 'budget.show'], viewports: CORE },
  { id: 'devices', root: '.devices', rpc: ['projects.list', 'devices.list'], viewports: CORE },
  {
    id: 'settings-providers',
    root: '[data-testid="settings-providers"]',
    rpc: ['projects.list'],
    viewports: CORE,
  },
  { id: 'routines', root: '[data-testid="routines"]', rpc: ['projects.list'], viewports: CORE },
  {
    id: 'crash-reports',
    root: '[data-testid="crash-reports"]',
    rpc: ['projects.list', 'postlaunch.crashes'],
    viewports: CORE,
  },
  {
    id: 'store-reviews',
    root: '[data-testid="store-reviews"]',
    rpc: ['projects.list', 'postlaunch.reviews'],
    viewports: CORE,
  },
  {
    id: 'backend-kit',
    root: '[data-testid="backend-kit-panel"]',
    rpc: ['projects.list'],
    viewports: CORE,
  },

  // The first-run wizard: one case per state the owner can be in.
  {
    id: 'onboarding-language',
    root: '[data-testid="onboarding-language"]',
    rpc: ['providers.list'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'language',
    viewports: CORE,
  },
  {
    id: 'onboarding-provider',
    root: '[data-testid="onboarding-provider"]',
    rpc: ['providers.list'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'provider',
    viewports: CORE,
  },
  {
    // The true first run: the daemon reports no providers, so the wizard offers its own kinds.
    id: 'onboarding-provider-first-run',
    root: '[data-testid="onboarding-provider"]',
    rpc: ['providers.list'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'provider',
    providers: [],
    viewports: CORE,
  },
  {
    id: 'onboarding-key',
    root: '[data-testid="onboarding-key"]',
    rpc: ['providers.list'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'key',
    viewports: CORE,
  },
  {
    id: 'onboarding-test-ok',
    root: '[data-testid="onboarding-test"]',
    rpc: ['providers.list', 'providers.add', 'providers.test'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'test-ok',
    viewports: CORE,
  },
  {
    id: 'onboarding-test-failed',
    root: '[data-testid="onboarding-test"]',
    rpc: ['providers.list', 'providers.add', 'providers.test'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'test-failed',
    viewports: CORE,
  },
  {
    id: 'onboarding-project',
    root: '[data-testid="onboarding-project"]',
    rpc: ['providers.list', 'providers.add', 'providers.test'],
    search: '',
    config: { onboarding_complete: 'false' },
    drive: 'project',
    viewports: CORE,
  },
];

/** The case for `id`, so a spec can look one up without a cast. */
export function screenCase(id: ScreenId): ScreenCase {
  const found = SCREENS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no screen case is named "${id}"`);
  return found;
}

/** The methods a case must have called by the time it can be measured. */
export function requiredRpc(screen: ScreenCase): string[] {
  return [...new Set(screen.rpc)];
}

/**
 * The key the stubbed daemon refuses.
 *
 * `providers.test` fails for a provider whose registered key is this one, which is how the wizard's
 * refusal state is reached without a real model API: the stub models a provider that rejected the
 * key it was given. `ACCEPTED_KEY` is the same story the other way round.
 */
export const REJECTED_KEY = 'sk-warsha-refused';

/** The key the stubbed daemon accepts. */
export const ACCEPTED_KEY = 'sk-warsha-accepted';

/** The project name the `created` drive types, so the flow check can look for it. */
export const CREATED_PROJECT_NAME = 'متجر ورشة';

/** Fixture dates, so a formatted date cannot drift between runs. */
const RUN_STARTED = '2026-10-05T07:15:00.000Z';
const CREATED_AT = '2026-10-05T07:20:00.000Z';

/**
 * The instant every case runs at.
 *
 * A screen is allowed to read the clock — the run view stamps its event stream with `new Date()` and
 * renders the time with seconds — so the clock is frozen at a fixed instant instead of left live,
 * which would otherwise make that screen's screenshot differ on every run. `setFixedTime` replaces
 * `Date` only: timers and animation frames stay real, which `toHaveScreenshot` needs to settle.
 */
const FIXED_NOW = new Date(RUN_STARTED);

/**
 * Two projects, named the way the owner names them.
 *
 * The Arabic name is §11's long-string case on purpose: long enough that a truncating ledger row has
 * to prove it carries a `title`, and it keeps its shape in either direction. The Latin name is the
 * other half of the same screen. The ids stay stable across scenarios, because the shell selects the
 * first project and then its runs — a scenario that renamed the ids would move the bench to a run
 * that does not exist.
 */
const PROJECTS = [
  {
    id: 'proj-ui',
    name: 'متجر ورشة للأثاث المكتبي',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-02T09:30:00.000Z',
  },
  {
    id: 'proj-store',
    name: 'Warsha Store',
    createdAt: '2026-10-03T08:00:00.000Z',
    updatedAt: '2026-10-04T09:30:00.000Z',
  },
];

/** One run per interesting stage, so the board's columns and the run view have real content. */
const RUNS = [
  {
    id: 'run-code',
    projectId: 'proj-ui',
    stage: 'code',
    status: 'running',
    startedAt: RUN_STARTED,
    updatedAt: '2026-10-05T09:45:00.000Z',
  },
  {
    id: 'run-gate-a',
    projectId: 'proj-store',
    stage: 'gate_a',
    status: 'awaiting_gate',
    startedAt: RUN_STARTED,
    updatedAt: '2026-10-05T09:00:00.000Z',
  },
  {
    id: 'run-research',
    projectId: 'proj-ui',
    stage: 'research',
    status: 'running',
    startedAt: RUN_STARTED,
    updatedAt: '2026-10-05T09:10:00.000Z',
  },
  {
    id: 'run-review',
    projectId: 'proj-store',
    stage: 'review_qa_security',
    status: 'running',
    startedAt: RUN_STARTED,
    updatedAt: '2026-10-05T09:20:00.000Z',
  },
];

/** Two gates: one waiting for the owner, one already approved. */
const GATES = [
  { stage: 'gate_a', state: { state: 'pending' } },
  {
    stage: 'gate_b',
    state: { state: 'approved', by: 'device-owner', at: '2026-10-05T09:30:00.000Z' },
  },
];

/**
 * What `gates.list` answers for a run that has decided nothing: **all four** gate stages, every one of them
 * `pending`.
 *
 * This is the daemon's real shape, not a stress case — `list_gates` maps `Stage::all()` filtered to gates
 * over `run.gate_states.get(stage).unwrap_or_default()` (`crates/warshad/src/lib.rs:1577-1613`), so a stage
 * the run never wrote is `Pending`. It is the reason the parked reading exists: four pending rows are four
 * facts about a table, and only the one whose stage the run stands on is a request to the owner. The `GATES`
 * fixture above cannot show that, because it answers only the two stages a run has actually touched.
 */
const GATES_ALL_PENDING = [
  { stage: 'gate_a', state: { state: 'pending' } },
  { stage: 'gate_b', state: { state: 'pending' } },
  { stage: 'gate_c', state: { state: 'pending' } },
  { stage: 'gate_d', state: { state: 'pending' } },
];

/** One provider `providers.list` can report — the shape `@warsha/client` calls `ProviderConfig`. */
export interface ProviderFixture {
  name: string;
  kind: string;
  enabled: boolean;
  api_base?: string;
}

/**
 * What `providers.list` reports when a case does not say otherwise.
 *
 * A daemon that has been used once: one provider the wizard's catalog names by its kind, and one the
 * owner named something else and gave an endpoint of its own (machine data: mono, `translate="no"`).
 * The wizard shows both, which is what the `onboarding-provider` case pins;
 * `onboarding-provider-first-run` overrides this with `[]`.
 */
const DAEMON_PROVIDERS: readonly ProviderFixture[] = [
  { name: 'warsha-router', kind: 'open_router', enabled: true },
  { name: 'my-ollama', kind: 'ollama', enabled: true, api_base: 'http://127.0.0.1:11434/v1' },
];

/** The routing table `roles.list` answers with: three routed roles, in the pipeline's own order. */
const ROLE_ROUTINGS = [
  {
    role: 'pm',
    targets: [{ provider_id: 'warsha-router', model_id: 'claude-sonnet-4-5', weight: 100 }],
    fallback_enabled: true,
    budget_cents_per_run: 500,
  },
  {
    role: 'coder',
    targets: [
      { provider_id: 'warsha-router', model_id: 'gpt-5-codex', weight: 70 },
      { provider_id: 'my-ollama', model_id: 'qwen3-coder:30b', weight: 30 },
    ],
    fallback_enabled: false,
    // "no ceiling" is a fact the screen has to be able to tell from zero cents (§11's data honesty).
    budget_cents_per_run: null,
  },
  {
    role: 'reviewer',
    targets: [{ provider_id: 'warsha-router', model_id: 'gemini-3-pro', weight: 100 }],
    fallback_enabled: true,
    budget_cents_per_run: 120,
  },
];

/** Two paired devices: the owner's laptop and the phone that decides gates. */
const DEVICES = [
  {
    id: 'dev-laptop',
    name: 'Warsha-Desktop',
    pairedAt: '2026-10-01T08:00:00.000Z',
    lastSeen: '2026-10-05T09:40:00.000Z',
  },
  {
    id: 'dev-phone',
    name: 'هاتف المالك',
    pairedAt: '2026-10-02T10:00:00.000Z',
    lastSeen: '2026-10-05T09:44:00.000Z',
  },
];

/** The reading `budget.show` answers with, in the daemon's own cents (`BudgetStatus` is USD).
 *  `client.getProjectBudget` divides by 100 at the edge, so the screens render 12 / 4.37 / 7.63
 *  exactly as they did when the stub answered dollars directly. */
const BUDGET = { project_id: 'proj-ui', budget_cents: 1200, spent_cents: 437, remaining_cents: 763 };

/**
 * The run's log lines — the terminal dock's and the run view's content.
 *
 * These are machine data by §11's definition ("what the machines did"), so they carry commands, paths
 * and counts; the one Arabic line is a tool's own output rather than UI copy.
 */
const RUN_LOGS = [
  '$ cargo test --workspace',
  'test result: ok. 240 passed; 0 failed; 0 ignored',
  'wrote src/screens/SimpleMode.tsx',
  'جارٍ تنفيذ المهمة: مراجعة الكود',
  '$ git commit -m "feat: bench"',
  ' 3 files changed, 412 insertions(+), 88 deletions(-)',
];

/** One `/events` frame in the daemon's own wire shape. */
interface EventFixture {
  id: string;
  run_id: string;
  stage: string;
  role: string | null;
  kind: string;
  payload: { summary: string };
  cost_cents: number | null;
  created_at: string;
  device_id: string | null;
}

/**
 * The run's event transcript — the feed the Simple chat and the Advanced lanes fold out of.
 *
 * An idle socket would photograph an empty bench, and an empty bench proves nothing about §3's
 * disclosure ladder. The frames are the daemon's wire shape (snake_case, one JSON object per frame),
 * which is what `parseWarshaEvent` reads; costs and a gate event and an error are all in here so the
 * filter chips, the lane costs and the lit lamp have something real to show.
 */
const EVENT_FIXTURES: readonly EventFixture[] = [
  {
    id: 'evt-0001',
    run_id: 'run-code',
    stage: 'plan_tasks',
    role: 'pm',
    kind: 'tool_call',
    payload: { summary: 'spec.md' },
    cost_cents: 4,
    created_at: '2026-10-05T07:16:00.000Z',
    device_id: 'dev-laptop',
  },
  {
    id: 'evt-0002',
    run_id: 'run-code',
    stage: 'code',
    role: 'coder',
    kind: 'tool_call',
    payload: { summary: 'cargo build --offline' },
    cost_cents: 17,
    created_at: '2026-10-05T07:22:00.000Z',
    device_id: 'dev-laptop',
  },
  {
    id: 'evt-0003',
    run_id: 'run-code',
    stage: 'code',
    role: 'coder',
    kind: 'tool_result',
    payload: { summary: 'ok: 240 tests passed' },
    cost_cents: null,
    created_at: '2026-10-05T07:31:00.000Z',
    device_id: 'dev-laptop',
  },
  {
    id: 'evt-0004',
    run_id: 'run-code',
    stage: 'code',
    role: 'researcher',
    kind: 'error',
    payload: { summary: 'provider refused: rate_limited' },
    cost_cents: null,
    created_at: '2026-10-05T07:33:00.000Z',
    device_id: null,
  },
  {
    id: 'evt-0005',
    run_id: 'run-code',
    stage: 'gate_c',
    role: null,
    kind: 'gate_pending',
    payload: { summary: 'بانتظار موافقة المالك على مراجعة الجودة والأمان' },
    cost_cents: null,
    created_at: '2026-10-05T07:40:00.000Z',
    device_id: 'dev-phone',
  },
  {
    id: 'evt-0006',
    run_id: 'run-code',
    stage: 'review_qa_security',
    role: 'reviewer',
    kind: 'tool_call',
    payload: { summary: 'cargo clippy --all-targets -- -D warnings' },
    cost_cents: 9,
    created_at: '2026-10-05T07:44:00.000Z',
    device_id: 'dev-laptop',
  },
];

/** The frames the mocked socket pushes, in the order the daemon would have sent them. */
const EVENT_FRAMES: readonly string[] = EVENT_FIXTURES.map((frame) => JSON.stringify(frame));

/**
 * The run's log as the daemon keeps it: `runs.events` rows, in the same wire shape.
 *
 * `runs.logs` was never a method `warshad` serves (DECISIONS.md 2026-11-03), so the client reads
 * these events and formats one line per event itself. Each row carries its line in `payload.summary`
 * — the key `eventLogLine` prefers — which is what keeps the terminal dock's and the run view's text
 * byte-identical to the pre-rename baselines: the fixture moved from lines to events, the pixels did
 * not.
 */
const RUN_EVENTS: readonly EventFixture[] = RUN_LOGS.map((line, index) => ({
  id: `evt-log-${index + 1}`,
  run_id: 'run-code',
  stage: 'code',
  role: 'coder',
  kind: 'agent_step',
  payload: { summary: line },
  cost_cents: null,
  created_at: `2026-10-05T07:0${index}:00.000Z`,
  device_id: 'dev-laptop',
}));

/** What the stubs observed, so a test can assert the app really talked to them. */
export interface StubReport {
  /** JSON-RPC methods the app called, in order. */
  rpcMethods: string[];
  /** Requests whose bearer token was not the app's own — always zero when the stub is right. */
  unauthorized: number;
  /** Methods the stub does not implement, so an unexpected call fails the case instead of hiding. */
  unimplemented: string[];
  /**
   * Tauri `set_config` writes, in order.
   *
   * The first-run flag travels this way rather than over RPC, so the wizard's last step
   * (`onboarding_complete`) can only be asserted from here.
   */
  configWrites: { key: string; value: string }[];
  /** Frames the mocked `/events` socket pushed at the page. */
  eventsSent: number;
}

export interface OpenScreenOptions {
  /** Which screen to open (`?screen=`). */
  screen: ScreenId;
  viewport: Viewport;
  locale: Locale;
  theme: Theme;
  /** Which §7 state the daemon is in for this case; `default` when omitted. */
  scenario?: ScenarioId;
  /** Override the Tauri config, e.g. `{ onboarding_complete: 'false' }` to see onboarding. */
  config?: Record<string, string>;
  /** Replace the default `?screen=…` query, e.g. `''` to let the shell choose its own screen. */
  search?: string;
  /** Absolute origin for a page that has no `baseURL` (a context the test made itself). */
  origin?: string;
  /** How far to drive the first-run wizard; overrides the case's own `drive`. */
  drive?: WizardDrive;
  /**
   * Selector to wait for before measuring; the screen root by default.
   *
   * A case that opens a screen the shell decides for itself (onboarding) has to wait for something
   * else, and waiting for a selector that never appears would hide the reason behind a timeout.
   */
  ready?: string;
  /** What `providers.list` answers for this case; the daemon fixture by default. */
  providers?: readonly ProviderFixture[];
  /** Per-method overrides on top of the scenario's, for a case no scenario covers. */
  fixtures?: Partial<Record<RpcMethod, RpcBehaviour>>;
  /** Push the fixture transcript at the page; `open` for an idle daemon, `close` for §7's dropped feed. */
  events?: EventStubMode;
}

/**
 * Put every scroll container back to its start, so a screenshot is the same picture every time it is
 * taken. See the `overflow-anchor: none` note in each app's stylesheet: the suite keeps
 * `maxDiffPixelRatio: 0`, and that is only fair while nothing in the frame drifts.
 */
export async function settleScroll(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const node of Array.from(document.querySelectorAll('*'))) {
      const element = node as HTMLElement;
      if (typeof element.scrollTop === 'number' && element.scrollTop !== 0) element.scrollTop = 0;
      if (typeof element.scrollLeft === 'number' && element.scrollLeft !== 0) element.scrollLeft = 0;
    }
  });
}

/** Zero out motion: the token layer honours reduced motion, this catches anything that does not. */
const NO_MOTION_CSS = `
  *, *::before, *::after {
    animation: none !important;
    animation-duration: 0s !important;
    transition: none !important;
    transition-duration: 0s !important;
    caret-color: transparent !important;
  }
`;

/** One dev-server entry the stub remembers, so `preview.status`/`preview.stop` can answer for it. */
export interface StubPreview {
  readonly processId: string;
  readonly command: string;
  readonly args: readonly string[];
  status: 'starting' | 'stopped';
  readonly url: string | null;
}

/**
 * The daemon the stub models for one case.
 *
 * `providers.test` answers from `addedKeys`, which is what makes the wizard's refusal state
 * reachable without inventing it in the app: the key the case types is the whole difference between
 * the two test cases. `previews` is the other piece of state the daemon really keeps — a project
 * with no entry is refused by `preview.status`/`preview.stop` exactly as the live manager refuses
 * it (`LivePreviewManager::preview_entry`). `fixtures` is what a §7 state is written in.
 */
export interface StubDaemon {
  readonly providers: readonly ProviderFixture[];
  readonly addedKeys: Map<string, string>;
  readonly previews: Map<string, StubPreview>;
  readonly fixtures: Partial<Record<RpcMethod, RpcBehaviour>>;
}

/** The daemon a case runs against: its providers, the keys and previews it holds, its overrides. */
export function createDaemon(
  options: { providers?: readonly ProviderFixture[]; fixtures?: Partial<Record<RpcMethod, RpcBehaviour>> } = {}
): StubDaemon {
  return {
    providers: options.providers ?? DAEMON_PROVIDERS,
    addedKeys: new Map<string, string>(),
    previews: new Map<string, StubPreview>(),
    fixtures: options.fixtures ?? {},
  };
}

/** A fresh stub report, so an app-specific harness can start the same record. */
export function createStubReport(): StubReport {
  return { rpcMethods: [], unauthorized: 0, unimplemented: [], configWrites: [], eventsSent: 0 };
}

/**
 * The spellings jsonrpsee's generated named-params decoder accepts for one Rust argument.
 *
 * Measured against a running `warshad`: `list_gates(&self, run_id, …)` took both `{"run_id": …}`
 * and `{"runId": …}`, and serde ignores an unknown key rather than reporting it — the retraction
 * recorded at DECISIONS.md 2026-11-03 (#40 withdrawn), which is why key *casing* is not what #54
 * fixed. So `field` is written as the daemon writes it — snake_case — and its camelCase spelling is
 * accepted beside it, which is the whole accepted set and nothing wider. A key that is neither is a
 * *rename*, and a rename is what the stub must refuse.
 */
function paramSpellings(field: string): readonly string[] {
  if (!field.includes('_')) return [field];
  const camel = field
    .split('_')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
  return [field, camel];
}

/** Whether the request carries this argument at all, and under which raw value. */
function paramEntry(params: unknown, field: string): { found: boolean; value: unknown } {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return { found: false, value: undefined };
  }
  const source = params as Record<string, unknown>;
  for (const spelling of paramSpellings(field)) {
    if (spelling in source) return { found: true, value: source[spelling] };
  }
  return { found: false, value: undefined };
}

/** One argument of the RPC request as text, when the case sent one. */
function paramValue(params: unknown, field: string): string | null {
  const entry = paramEntry(params, field);
  if (!entry.found) return null;
  const value = entry.value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** The daemon's own refusal for a params object that does not bind this argument (serde, -32602). */
function missingField(field: string): StubOutcome {
  return { ok: false, code: -32602, message: `missing field '${field}'` };
}

/** serde's rendering of a value it did not expect, for the daemon's `invalid type` refusal. */
function serdeUnexpected(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `string ${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return `boolean ${String(value)}`;
  if (typeof value === 'number') {
    return Number.isInteger(value) ? `integer ${value}` : `floating point ${value}`;
  }
  if (Array.isArray(value)) return 'sequence';
  return 'map';
}

/**
 * One `PairingData` 32-byte array (`[u8; 32]`, `crates/warsha-remote/src/lib.rs:114-116`) as serde
 * binds it: a sequence of exactly 32 integers 0..=255, each refusal in serde's shape.
 */
function pairingBytesRefusal(value: unknown): StubOutcome | null {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      code: -32602,
      message: `invalid type: ${serdeUnexpected(value)}, expected an array of length 32`,
    };
  }
  const bytes: readonly unknown[] = value;
  if (bytes.length !== 32) {
    return {
      ok: false,
      code: -32602,
      message: `invalid length ${bytes.length}, expected an array of length 32`,
    };
  }
  const badIndex = bytes.findIndex(
    (byte) => typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255
  );
  if (badIndex >= 0) {
    return {
      ok: false,
      code: -32602,
      message: `invalid value: ${serdeUnexpected(bytes[badIndex])}, expected u8`,
    };
  }
  return null;
}

/**
 * Bind a `devices.pair` params object the way `warsha_remote::PairingData` does, or refuse it the
 * way serde refuses it.
 *
 * The four required fields are serde's required fields — `relay_url` is an `Option` and may be
 * absent or null — and the two key fields are `[u8; 32]` arrays. A pairing that binds answers the
 * daemon's `()`: `result: null`, never a device summary, because `pair_device` returns `Ok(())`
 * (`crates/warshad/src/lib.rs:1760-1779`) and the paired device shows up on the next
 * `devices.list`.
 */
function bindPairingData(source: Record<string, unknown>): StubOutcome {
  for (const field of ['device_id', 'static_public', 'pairing_secret', 'expires_at'] as const) {
    if (!(field in source)) return missingField(field);
  }
  for (const field of ['device_id', 'expires_at'] as const) {
    const value = source[field];
    if (typeof value !== 'string') {
      return {
        ok: false,
        code: -32602,
        message: `invalid type: ${serdeUnexpected(value)}, expected a formatted UUID string`,
      };
    }
  }
  const relay = source['relay_url'];
  if (relay !== undefined && relay !== null && typeof relay !== 'string') {
    return {
      ok: false,
      code: -32602,
      message: `invalid type: ${serdeUnexpected(relay)}, expected a string`,
    };
  }
  for (const field of ['static_public', 'pairing_secret'] as const) {
    const refusal = pairingBytesRefusal(source[field]);
    if (refusal !== null) return refusal;
  }
  return { ok: true, result: null };
}

/** What the stub answers for one call: a result, or an error the screen is meant to show. */
type StubOutcome = { ok: true; result: unknown } | { ok: false; code: number; message: string };

/** The wire shape `warsha_core::HarnessDefinition` serialises (`harness.get`/`harness.import`). */
function harnessRow(id: string): Record<string, unknown> {
  return {
    id,
    version: '1.0.0',
    name: id,
    description: '',
    stages: [
      {
        id: 'code',
        role: 'coder',
        name: 'Code',
        prompt_template: null,
        gate: null,
        auto_advance: false,
      },
    ],
    rules: {
      max_repair_iterations: 0,
      budget_cap_cents: null,
      allow_parallel_subagents: false,
      require_verification_receipt: false,
    },
    preset: false,
    active: false,
    created_at: CREATED_AT,
  };
}

/** The wire shape `warsha_core::SkillDefinition` serialises (`skills.import`/`skills.toggle`). */
function skillRow(id: string, enabled: boolean): Record<string, unknown> {
  return {
    id,
    name: id,
    description: '',
    source: 'imported',
    license: '',
    content: '',
    enabled,
    tags: [],
  };
}

/** The wire shape `warsha_core::PluginDefinition` serialises (`plugins.install`/`configure`/`toggle`). */
function pluginRow(id: string, enabled: boolean): Record<string, unknown> {
  return {
    id,
    name: id,
    description: '',
    transport: 'stdio',
    command: null,
    args: [],
    env: {},
    enabled,
    tools: [],
    source: 'installed',
  };
}

/** The wire shape `warsha_core::IntegrationStatus` serialises (`integrations.connect`/`disconnect`). */
function integrationRow(id: string, connected: boolean): Record<string, unknown> {
  return {
    id,
    name: id,
    connected,
    configured_at: connected ? CREATED_AT : null,
    details: null,
  };
}

/** The wire shape `warsha_pipeline::Routine` serialises (`routines.run_now`/`pause`/`resume`). */
function routineRow(id: string, state: 'running' | 'paused' | 'idle'): Record<string, unknown> {
  return {
    id,
    name: id,
    description: '',
    schedule: 'manual',
    state,
    last_run_unix: null,
  };
}

/** The wire shape `warsha_pipeline::LivePreview` serialises (`preview.start`/`preview.status`). */
function livePreviewRow(projectId: string, entry: StubPreview): Record<string, unknown> {
  return {
    project_id: projectId,
    process_id: entry.processId,
    command: entry.command,
    args: [...entry.args],
    status: entry.status,
    url: entry.url,
  };
}

/** The daemon's refusal for a project with no preview (`ProcessError::PreviewNotFound`). */
function previewNotFound(projectId: string): StubOutcome {
  return { ok: false, code: -32000, message: `no preview for project \`${projectId}\`` };
}

/** Rust's `Debug` rendering of `RunMode`, which every `RunModeError` message uses (`{mode:?}`). */
const RUN_MODE_LABELS = {
  local: 'Local',
  self_hosted: 'SelfHosted',
  hosted: 'Hosted',
} as const;

/** `is_loopback_host` (`crates/warsha-pipeline/src/run_modes.rs:281-284`). */
function isLoopbackHost(host: string): boolean {
  const trimmed = host.trim().toLowerCase();
  return trimmed === '127.0.0.1' || trimmed === 'localhost';
}

/** `is_host_name` (`crates/warsha-pipeline/src/run_modes.rs:290-293`): one non-blank token. */
function isHostName(candidate: string): boolean {
  const entry = candidate.trim();
  return entry.length > 0 && !/[\s/]/.test(entry);
}

/**
 * Decode and validate a `runmode.set` config the way the daemon does, or return its refusal.
 *
 * The first half is serde's: `mode`, `bind_host` and `allowed_hosts` are required (`relay_url` is
 * an `Option`), a wrong variant or type is `-32602` in serde's own wording. The second half is
 * `RunModeConfig::validate()` (`crates/warsha-pipeline/src/run_modes.rs:185-244`), the one gate a
 * config passes before the daemon stores it, answered with the handler's `-32000` and the
 * `RunModeError` display text. A stub that answered defaults for a malformed config would let a
 * screen keep a setting a live daemon refuses.
 */
function bindRunModeConfig(value: unknown): { config: Record<string, unknown> } | { refusal: StubOutcome } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      refusal: {
        ok: false,
        code: -32602,
        message: `invalid type: ${serdeUnexpected(value)}, expected struct RunModeConfig`,
      },
    };
  }
  const source = value as Record<string, unknown>;
  for (const field of ['mode', 'bind_host', 'allowed_hosts'] as const) {
    if (!(field in source)) return { refusal: missingField(field) };
  }
  const mode = source['mode'];
  if (mode !== 'local' && mode !== 'self_hosted' && mode !== 'hosted') {
    return {
      refusal: {
        ok: false,
        code: -32602,
        message: `unknown variant \`${String(mode)}\`, expected one of \`local\`, \`self_hosted\`, \`hosted\``,
      },
    };
  }
  const bindHost = source['bind_host'];
  if (typeof bindHost !== 'string') {
    return {
      refusal: {
        ok: false,
        code: -32602,
        message: `invalid type: ${serdeUnexpected(bindHost)}, expected a string`,
      },
    };
  }
  const allowedHosts = source['allowed_hosts'];
  if (!Array.isArray(allowedHosts)) {
    return {
      refusal: {
        ok: false,
        code: -32602,
        message: `invalid type: ${serdeUnexpected(allowedHosts)}, expected a sequence`,
      },
    };
  }
  const hosts: string[] = [];
  for (const host of allowedHosts) {
    if (typeof host !== 'string') {
      return {
        refusal: {
          ok: false,
          code: -32602,
          message: `invalid type: ${serdeUnexpected(host)}, expected a string`,
        },
      };
    }
    hosts.push(host);
  }
  const relayRaw = source['relay_url'];
  if (relayRaw !== undefined && relayRaw !== null && typeof relayRaw !== 'string') {
    return {
      refusal: {
        ok: false,
        code: -32602,
        message: `invalid type: ${serdeUnexpected(relayRaw)}, expected a string`,
      },
    };
  }
  const relayUrl = typeof relayRaw === 'string' ? relayRaw : null;

  const label = RUN_MODE_LABELS[mode];
  const host = bindHost.trim();
  const refuse = (message: string): { refusal: StubOutcome } => ({
    refusal: { ok: false, code: -32000, message },
  });
  if (host.length === 0) return refuse(`${label} mode needs a bind host`);
  if (mode === 'local') {
    if (!isLoopbackHost(host)) return refuse(`${label} mode cannot bind ${host}`);
    if (hosts.length > 0) {
      return refuse(`${label} mode cannot carry an allowed-host list (${hosts.length} entries)`);
    }
    if (relayUrl !== null) return refuse(`${label} mode cannot carry a relay URL`);
  } else if (mode === 'self_hosted') {
    if (isLoopbackHost(host)) return refuse(`${label} mode cannot bind ${host}`);
    if (hosts.length === 0) return refuse(`${label} mode requires an allowed-host list`);
    for (const allowed of hosts) {
      if (!isHostName(allowed)) return refuse(`${JSON.stringify(allowed)} is not a host name`);
    }
  } else {
    if (!isLoopbackHost(host)) return refuse(`${label} mode cannot bind ${host}`);
    if (relayUrl === null || relayUrl.trim().length === 0) {
      return refuse(`${label} mode requires a relay URL`);
    }
  }
  return { config: { mode, bind_host: bindHost, allowed_hosts: hosts, relay_url: relayUrl } };
}

/**
 * What the stub answers per JSON-RPC method.
 *
 * `null` means "no stub for this method": that is the one outcome that lands in
 * `StubReport.unimplemented` and fails a case, and it is deliberately different from an error the
 * daemon is modelled as returning (a refused API key), which a screen is supposed to render.
 */
function rpcResult(method: RpcMethod, params: unknown, daemon: StubDaemon): StubOutcome | null {
  const override = daemon.fixtures[method];
  if (override !== undefined && (override.result !== undefined || override.error !== undefined)) {
    if (override.error !== undefined) return { ok: false, code: -32001, message: override.error };
    return { ok: true, result: override.result };
  }

  switch (method) {
    case 'projects.list':
      return { ok: true, result: PROJECTS };
    case 'runs.list': {
      const projectId = paramValue(params, 'project_id');
      return {
        ok: true,
        result: projectId === null ? RUNS : RUNS.filter((run) => run.projectId === projectId),
      };
    }
    case 'runs.get': {
      // `warshad` binds `run_id` (`crates/warshad/src/lib.rs:683`). A request keyed any other way —
      // the client's old `{ id }` was one — is not a run read the daemon can serve, so the stub
      // refuses it with the daemon's own `-32602` instead of falling back to `RUNS[0]` and letting a
      // screen photograph a run no live daemon ever handed over (#54).
      if (!paramEntry(params, 'run_id').found) return missingField('run_id');
      const id = paramValue(params, 'run_id');
      return { ok: true, result: RUNS.find((run) => run.id === id) ?? RUNS[0] };
    }
    // The client reads the run's events and formats its own log lines (`runs.logs` was never a
    // daemon method), so the stub answers the rows and not the text.
    case 'runs.events':
      return { ok: true, result: RUN_EVENTS };
    case 'runs.start':
      return { ok: true, result: RUNS[0] };
    // Run stream synchronisation and run control (WS3). The stub answers the
    // daemon's own wire shapes: `runs.subscribe` returns a `RunStreamSync`
    // (seq / gap flags / run / sequenced events), the run-control methods
    // return the daemon's snake_case-free `Run` summary rows, and
    // `runs.artifacts` returns `warsha_core::Artifact` rows.
    case 'runs.subscribe': {
      // Both params are `Option`s on the daemon, so neither is required; a
      // named but unparseable `since_seq` is the one refusal, mirroring the
      // daemon's own `-32602` for a mistyped bound argument.
      const runId = paramValue(params, 'run_id');
      const sinceEntry = paramEntry(params, 'since_seq');
      const sinceRaw = sinceEntry.value;
      let sinceSeq = 0;
      if (sinceRaw !== null && sinceRaw !== undefined) {
        const parsed = Number(sinceRaw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return { ok: false, code: -32602, message: "invalid value: 'since_seq', expected u64" };
        }
        sinceSeq = parsed;
      }
      const frames = RUN_EVENTS.map((event, index) => ({ ...event, seq: index + 1 })).filter(
        (frame) => frame.seq > sinceSeq && (runId === null || frame.run_id === runId)
      );
      const run = runId === null ? null : (RUNS.find((item) => item.id === runId) ?? RUNS[0]);
      return {
        ok: true,
        result: {
          seq: RUN_EVENTS.length,
          gap_detected: false,
          resync_required: false,
          dropped_count: 0,
          run,
          events: frames,
        },
      };
    }
    case 'runs.advance': {
      if (!paramEntry(params, 'run_id').found) return missingField('run_id');
      const id = paramValue(params, 'run_id');
      const run = RUNS.find((item) => item.id === id) ?? RUNS[0];
      return { ok: true, result: { ...run, status: 'awaiting_gate' } };
    }
    case 'runs.cancel': {
      if (!paramEntry(params, 'run_id').found) return missingField('run_id');
      const id = paramValue(params, 'run_id');
      const run = RUNS.find((item) => item.id === id) ?? RUNS[0];
      return { ok: true, result: { ...run, status: 'cancelled' } };
    }
    case 'runs.followup': {
      if (!paramEntry(params, 'run_id').found) return missingField('run_id');
      if (!paramEntry(params, 'prompt').found) return missingField('prompt');
      const id = paramValue(params, 'run_id');
      const run = RUNS.find((item) => item.id === id) ?? RUNS[0];
      return { ok: true, result: run };
    }
    case 'runs.artifacts': {
      if (!paramEntry(params, 'run_id').found) return missingField('run_id');
      return {
        ok: true,
        result: [
          {
            name: 'prd_spec',
            content: '# متجر ورشة — PRD\n\nDeterministic stub artifact for the e2e lane.',
            stage: 'prd_spec',
            role: 'pm',
            created_at: CREATED_AT,
            updated_at: CREATED_AT,
            version: 1,
          },
        ],
      };
    }
    case 'projects.get': {
      // `get_project(&self, id)` really is named `id` (`crates/warshad/src/lib.rs:677`), so this one
      // is the checked-and-correct case; it still refuses a request that never carried it rather
      // than answering with a project the caller did not ask for.
      if (!paramEntry(params, 'id').found) return missingField('id');
      const id = paramValue(params, 'id');
      return { ok: true, result: PROJECTS.find((project) => project.id === id) ?? PROJECTS[0] };
    }
    case 'projects.create': {
      // The daemon requires all three fields and refuses with -32602 naming the first missing one
      // (measured live, DECISIONS.md 2026-11-03); a stub that answered a one-field create would let
      // the first-run flow pass while no real daemon could ever take it.
      const missing = ['name', 'description', 'language'].find((key) => paramValue(params, key) === null);
      if (missing !== undefined) {
        return { ok: false, code: -32602, message: `missing field '${missing}'` };
      }
      const name = paramValue(params, 'name') ?? '';
      return {
        ok: true,
        result: { id: 'proj-created', name, createdAt: CREATED_AT, updatedAt: CREATED_AT },
      };
    }
    case 'gates.list':
      return { ok: true, result: GATES };
    case 'gates.approve':
    case 'gates.reject':
    case 'gates.changes':
      return { ok: true, result: null };
    case 'providers.list':
      return { ok: true, result: daemon.providers };
    case 'providers.add': {
      const name = paramValue(params, 'name');
      const key = paramValue(params, 'key');
      if (name !== null && key !== null) daemon.addedKeys.set(name, key);
      return {
        ok: true,
        result: { name: name ?? '', kind: paramValue(params, 'kind') ?? '', enabled: true },
      };
    }
    case 'providers.test': {
      const name = paramValue(params, 'name');
      if (name !== null && daemon.addedKeys.get(name) === REJECTED_KEY) {
        // The daemon's own wording for a key it refused. The wizard shows it as data, and this is
        // the call the `onboarding-test-failed` case exists for.
        return { ok: false, code: -32001, message: `provider ${name} refused the API key` };
      }
      return { ok: true, result: null };
    }
    case 'providers.check_models': {
      // `warsha_providers::ModelCatalogDiff` with an empty local catalog: no new rows to reconcile
      // against, so the merged catalog is whatever the provider reported — and this stub reports
      // nothing, because a visual case must not depend on a provider's live list.
      const name = paramValue(params, 'name');
      return {
        ok: true,
        result: {
          provider: name ?? '',
          new_models: [],
          retained_count: 0,
          total_count: 0,
          updated_catalog: [],
        },
      };
    }
    case 'providers.remove':
    case 'budget.set':
    case 'roles.set':
    case 'devices.revoke':
      return { ok: true, result: null };
    case 'budget.show':
      return { ok: true, result: BUDGET };
    case 'roles.list':
      return { ok: true, result: ROLE_ROUTINGS };
    case 'devices.list':
      return { ok: true, result: DEVICES };
    case 'devices.pair-start':
      return {
        ok: true,
        result: {
          pairing: {
            device_id: 'dev-phone-1',
            static_public: Array.from({ length: 32 }, (_, i) => i),
            relay_url: null,
            pairing_secret: Array.from({ length: 32 }, (_, i) => 255 - i),
            expires_at: new Date(Date.now() + 600_000).toISOString(),
          },
          server_origin: 'http://127.0.0.1:8766',
          pairing_link:
            'http://127.0.0.1:8766/?server=http%3A%2F%2F127.0.0.1%3A8766&token=dGVzdC10b2tlbg',
          qr_code_png:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          loopback_only: true,
        },
      };
    case 'devices.pair': {
      // `pair_device(&self, pairing_data)` (`crates/warshad/src/lib.rs:781`) binds the whole
      // `warsha_remote::PairingData` struct (`crates/warsha-remote/src/lib.rs:112-118`), and a
      // live daemon is measured answering both halves of that (#54, #58): a request without the
      // key is -32602 `missing field 'pairing_data'`, and a QR *string* under the right key is
      // -32602 `invalid type: string …, expected struct PairingData`. The client now sends the
      // struct, so the stub binds it field by field the way serde does and refuses a malformed
      // pairing in the daemon's own shape — the pin is `crates/warshad/tests/devices_pair.rs`.
      const pairing = paramEntry(params, 'pairing_data');
      if (!pairing.found) return missingField('pairing_data');
      const raw = pairing.value;
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return {
          ok: false,
          code: -32602,
          message: `invalid type: ${serdeUnexpected(raw)}, expected struct PairingData`,
        };
      }
      return bindPairingData(raw as Record<string, unknown>);
    }
    case 'health':
      return { ok: true, result: { status: 'ok', version: '0.2.0' } };
    // Wave 2 lists SimpleMode reads on mount (`models.list` for the composer catalogue,
    // `harness.list` for the active harness). Both decode through `wave2List`
    // (`packages/client/src/index.ts`), which accepts any array — so the stub answers
    // the empty catalogue, and a case that needs rows overrides via fixtures.
    case 'harness.list':
    case 'models.list':
    // The Wave 2 catalogue and tree reads the advanced composer and the settings family make on
    // mount: `skills.list`, `plugins.list`, `integrations.list` and `files.tree`. All four decode
    // through `wave2List` (`packages/client/src/index.ts`), which accepts any array, so the stub
    // answers the empty catalogue and a case that needs rows overrides via fixtures.
    case 'skills.list':
    case 'plugins.list':
    case 'integrations.list':
    case 'files.tree':
      return { ok: true, result: [] };
    case 'agent.state':
      return {
        ok: true,
        result: {
          mode: 'plan',
          approvals: [
            { from: 'plan', to: 'agent', approved_by: 'dev-laptop', approved_at: 1764939300 },
          ],
          todos: [
            { id: 'todo-1', description: 'توصيف المتطلبات', status: 'done' },
            { id: 'todo-2', description: 'بناء الواجهة', status: 'in_progress' },
            { id: 'todo-3', description: 'المراجعة النهائية', status: 'pending' },
          ],
          model_wired: true,
        },
      };
    case 'agent.turn':
      return {
        ok: true,
        result: {
          mode: 'plan',
          mentions: [],
          command: null,
          response: 'تم تجهيز الخطة، وهي بانتظار موافقتك للمتابعة.',
          todos: [{ id: 'todo-1', description: 'توصيف المتطلبات', status: 'done' }],
          tools: [{ tool: 'read_file', success: true, output: 'src/App.tsx' }],
        },
      };
    case 'agent.approve_mode':
    case 'agent.plan_mode':
      return {
        ok: true,
        result: { from: 'plan', to: 'agent', approved_by: 'dev-laptop', approved_at: 1764939300 },
      };
    case 'postlaunch.crashes':
      return {
        ok: true,
        result: {
          crashes: [
            {
              id: 'crash-9f3a',
              run_id: 'run-code',
              message: 'تعطلت المعاينة بعد تحميل الحزمة، ولم تُحفظ المراجعة',
              stack_trace: '    at BenchPreview.render (src/components/LivePreview.tsx:118:9)',
              occurred_at: 1764939300,
              sent: false,
            },
            {
              id: 'crash-4b71',
              run_id: 'run-gate-a',
              message: 'WebSocket closed while the run was waiting on a gate',
              stack_trace: null,
              occurred_at: 1764935700,
              sent: true,
            },
          ],
        },
      };
    case 'postlaunch.reviews':
      return {
        ok: true,
        result: {
          reviews: [
            {
              id: 'rev-1',
              store: 'play',
              rating: 5,
              body: 'أفضل أداة متابعة للعمل، عربية من البداية إلى النهاية',
              author: 'Maha',
              received_at: 1764939300,
            },
            {
              id: 'rev-2',
              store: 'ios',
              rating: 3,
              body: 'Works well, but I would like a darker theme for night shifts.',
              author: 'Omar',
              received_at: 1764935700,
            },
          ],
        },
      };
    case 'backend.export':
      return { ok: true, result: { path: '/tmp/warsha/backend-kit' } };
    case 'handoff.create':
      return { ok: true, result: { path: '/tmp/warsha/handoff.zip' } };
    case 'handoff.apply':
      return { ok: true, result: { summary: '{"files":3,"conflicts":0}' } };
    // Wave 2 reads and writes plus the wiring batch (PLAN.md M16/M19/M20). These stubs exist to keep
    // W9 honest (every client method has a stub) and to model the daemon's own answers: reads list
    // `[]` or answer `null`, and the mutations echo a minimal valid row built from the request.
    //
    // The screens that dial them DO exist and reach them through user interaction — SettingsScreen
    // (integrations connect/disconnect/test), HarnessesSettings (select/import), SkillsSettings
    // (toggle/import), PluginsSettings (toggle/configure/install), ModelsSettings (add/remove),
    // AdvancedMode (`files.read`) and SimpleMode (`selectHarness`) — but every call site is an event
    // handler and no e2e case presses those controls, so the captures do not reach these cases.
    // Wave B must cover those interactions explicitly; their answers are here already.
    //
    // Every required bound argument is checked like the daemon checks it, so a call that would fail
    // live (`-32602 missing field`) fails here instead of passing, and the two calls whose failure
    // the daemon models — a preview that does not exist and an invalid run-mode config — answer its
    // own refusal rather than a convenient default.
    //
    // `harness.*` (`warsha_core::HarnessDefinition`; `crates/warshad/src/lib.rs` get_harness/import_harness).
    case 'harness.get': {
      if (!paramEntry(params, 'id').found) return missingField('id');
      return { ok: true, result: harnessRow(paramValue(params, 'id') ?? '') };
    }
    case 'harness.import': {
      if (!paramEntry(params, 'content').found) return missingField('content');
      return { ok: true, result: harnessRow('harness-imported') };
    }
    case 'harness.select':
      if (!paramEntry(params, 'harness_id').found) return missingField('harness_id');
      return { ok: true, result: null };
    case 'harness.delete':
      if (!paramEntry(params, 'id').found) return missingField('id');
      return { ok: true, result: null };
    // `skills.*` (`warsha_core::SkillDefinition`; lib.rs import_skill/toggle_skill/delete_skill).
    case 'skills.import':
      if (!paramEntry(params, 'url_or_content').found) return missingField('url_or_content');
      return { ok: true, result: skillRow('skill-imported', true) };
    case 'skills.toggle': {
      if (!paramEntry(params, 'id').found) return missingField('id');
      // `enabled: bool` is a required bound argument (`lib.rs` toggle_skill), so serde refuses an
      // omitted or non-boolean value before the handler runs.
      const enabled = paramEntry(params, 'enabled');
      if (!enabled.found) return missingField('enabled');
      if (typeof enabled.value !== 'boolean') {
        return {
          ok: false,
          code: -32602,
          message: `invalid type: ${serdeUnexpected(enabled.value)}, expected a boolean`,
        };
      }
      return { ok: true, result: skillRow(paramValue(params, 'id') ?? '', enabled.value) };
    }
    case 'skills.delete':
      if (!paramEntry(params, 'id').found) return missingField('id');
      return { ok: true, result: null };
    // `plugins.*` (`warsha_core::PluginDefinition`; lib.rs install_plugin/configure_plugin/...).
    case 'plugins.install':
      if (!paramEntry(params, 'manifest_json_or_url').found) return missingField('manifest_json_or_url');
      return { ok: true, result: pluginRow('plugin-installed', true) };
    case 'plugins.toggle': {
      if (!paramEntry(params, 'id').found) return missingField('id');
      // Same required `enabled: bool` as `skills.toggle` (`lib.rs` toggle_plugin).
      const enabled = paramEntry(params, 'enabled');
      if (!enabled.found) return missingField('enabled');
      if (typeof enabled.value !== 'boolean') {
        return {
          ok: false,
          code: -32602,
          message: `invalid type: ${serdeUnexpected(enabled.value)}, expected a boolean`,
        };
      }
      return { ok: true, result: pluginRow(paramValue(params, 'id') ?? '', enabled.value) };
    }
    case 'plugins.configure':
      if (!paramEntry(params, 'id').found) return missingField('id');
      if (!paramEntry(params, 'env').found) return missingField('env');
      return { ok: true, result: pluginRow(paramValue(params, 'id') ?? '', true) };
    case 'plugins.remove':
      if (!paramEntry(params, 'id').found) return missingField('id');
      return { ok: true, result: null };
    // `models.*` (`warsha_core::CustomModelRecord`; lib.rs add_custom_model/remove_custom_model).
    case 'models.add': {
      const missing = ['provider', 'model_id'].find((field) => !paramEntry(params, field).found);
      if (missing !== undefined) return missingField(missing);
      const windowEntry = paramEntry(params, 'context_window');
      return {
        ok: true,
        result: {
          provider: paramValue(params, 'provider') ?? '',
          model_id: paramValue(params, 'model_id') ?? '',
          display_name: paramValue(params, 'display_name'),
          context_window: typeof windowEntry.value === 'number' ? windowEntry.value : null,
          enabled: true,
        },
      };
    }
    case 'models.remove':
      if (!paramEntry(params, 'provider').found) return missingField('provider');
      if (!paramEntry(params, 'model_id').found) return missingField('model_id');
      return { ok: true, result: null };
    // `integrations.*` (`warsha_core::IntegrationStatus`; lib.rs connect/disconnect/test).
    case 'integrations.connect': {
      if (!paramEntry(params, 'id').found) return missingField('id');
      if (!paramEntry(params, 'config').found) return missingField('config');
      return { ok: true, result: integrationRow(paramValue(params, 'id') ?? '', true) };
    }
    case 'integrations.disconnect':
      if (!paramEntry(params, 'id').found) return missingField('id');
      return { ok: true, result: integrationRow(paramValue(params, 'id') ?? '', false) };
    case 'integrations.test': {
      if (!paramEntry(params, 'id').found) return missingField('id');
      const id = paramValue(params, 'id') ?? '';
      return {
        ok: true,
        result: {
          status: 'unconfigured',
          message: `\`${id}\` is missing an access token: integrations.connect writes the configuration, and no live request is made from here`,
        },
      };
    }
    // `files.read` (`warsha_core::FileContent`; lib.rs read_project_file).
    case 'files.read':
      if (!paramEntry(params, 'project_id').found) return missingField('project_id');
      if (!paramEntry(params, 'path').found) return missingField('path');
      return { ok: true, result: { path: paramValue(params, 'path') ?? '', content: '', mime_type: 'text/plain' } };
    // `routines.*` (`warsha_pipeline::Routine`; lib.rs list/get/run_now/pause/resume). The registry
    // starts empty, so the two reads answer `[]`/`null`; each mutation echoes the row it acted on —
    // the state the daemon's runner would have moved it to (`run_now` → `running`, `pause` →
    // `paused`, `resume` → `idle`) — rather than inventing a routine the case never registered.
    case 'routines.list':
      return { ok: true, result: [] };
    case 'routines.get':
      if (!paramEntry(params, 'id').found) return missingField('id');
      return { ok: true, result: null };
    case 'routines.run_now':
    case 'routines.pause':
    case 'routines.resume': {
      if (!paramEntry(params, 'id').found) return missingField('id');
      const state = method === 'routines.run_now' ? 'running' : method === 'routines.pause' ? 'paused' : 'idle';
      return { ok: true, result: routineRow(paramValue(params, 'id') ?? '', state) };
    }
    // `backend.get`/`backend.set` (`warsha_pipeline::BackendKit`; lib.rs get_backend/set_backend).
    case 'backend.get':
      if (!paramEntry(params, 'run_id').found) return missingField('run_id');
      return { ok: true, result: null };
    case 'backend.set':
      if (!paramEntry(params, 'run_id').found) return missingField('run_id');
      if (!paramEntry(params, 'kit').found) return missingField('kit');
      return { ok: true, result: null };
    // `preview.*` (`warsha_pipeline::LivePreview`; lib.rs start/stop/status). The manager keeps one
    // entry per project (`LivePreviewManager::preview_entry`, `process_spawn.rs:834-843`): `status`
    // and `stop` REFUSE a project with none (`-32000 no preview for project \`p\``), and a stopped
    // preview keeps its entry so `status` still reports it as stopped. The stub keeps the same
    // per-daemon map; it never observes a live process, so a started preview stays `starting`
    // until `preview.stop` moves it to `stopped`.
    case 'preview.start': {
      if (!paramEntry(params, 'project_id').found) return missingField('project_id');
      if (!paramEntry(params, 'command').found) return missingField('command');
      const project = (paramValue(params, 'project_id') ?? '').trim();
      if (project.length === 0) {
        return { ok: false, code: -32000, message: 'empty project id: a preview needs a project' };
      }
      const existing = daemon.previews.get(project);
      if (existing !== undefined && existing.status !== 'stopped') {
        return {
          ok: false,
          code: -32000,
          message: `project \`${project}\` already has a running preview`,
        };
      }
      // The daemon splits with `split_whitespace` (`LivePreviewManager::split_command`), not a shell.
      const [program = '', ...args] = (paramValue(params, 'command') ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (program.length === 0) {
        return { ok: false, code: -32000, message: 'empty command: a process needs a program to run' };
      }
      const entry: StubPreview = {
        processId: `proc-${project}`,
        command: program,
        args,
        status: 'starting',
        url: null,
      };
      daemon.previews.set(project, entry);
      return { ok: true, result: livePreviewRow(project, entry) };
    }
    case 'preview.status': {
      if (!paramEntry(params, 'project_id').found) return missingField('project_id');
      const project = (paramValue(params, 'project_id') ?? '').trim();
      const entry = daemon.previews.get(project);
      if (entry === undefined) return previewNotFound(project);
      return { ok: true, result: livePreviewRow(project, entry) };
    }
    case 'preview.stop': {
      if (!paramEntry(params, 'project_id').found) return missingField('project_id');
      const project = (paramValue(params, 'project_id') ?? '').trim();
      const entry = daemon.previews.get(project);
      if (entry === undefined) return previewNotFound(project);
      entry.status = 'stopped';
      return { ok: true, result: null };
    }
    // `runmode.*` (`warsha_pipeline::RunModeConfig`; lib.rs list/set). A fresh daemon stores no
    // mode, so the list is empty; `set` refuses what serde or `validate()` refuses and echoes the
    // config only when the daemon would have stored it.
    case 'runmode.list':
      return { ok: true, result: [] };
    case 'runmode.set': {
      const config = paramEntry(params, 'config');
      if (!config.found) return missingField('config');
      const bound = bindRunModeConfig(config.value);
      if ('refusal' in bound) return bound.refusal;
      return { ok: true, result: bound.config };
    }
    // `preferences.*` (`warsha_pipeline::Preference`; lib.rs list/record). No preference is derived
    // until a signal is recorded, and the stub keeps no store, so both reads answer `[]`.
    case 'preferences.list':
      if (!paramEntry(params, 'project_id').found) return missingField('project_id');
      return { ok: true, result: [] };
    case 'preferences.record':
      if (!paramEntry(params, 'signal').found) return missingField('signal');
      return { ok: true, result: [] };
    default:
      return null;
  }
}

/** The page-side record the Tauri stub writes into, so a write survives the page boundary. */
interface StubWindow {
  __WARSHA_STUB__?: { configWrites: { key: string; value: string }[] };
}

/**
 * The `set_config` writes the page has made so far.
 *
 * `openScreen` returns a snapshot taken when the screen was ready; a flow that acts *after* that has to
 * read the page again, or it asserts on a record of the moment it opened rather than the moment it
 * pressed. The first-run flag and the saved mode travel this way and nowhere else.
 */
export function readConfigWrites(page: Page): Promise<{ key: string; value: string }[]> {
  return page.evaluate(
    () => (window as unknown as StubWindow).__WARSHA_STUB__?.configWrites ?? []
  );
}

/** The two elements every wizard step walks through, addressed by the testids they carry. */
function stepLocator(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]`);
}

/**
 * Drive the first-run wizard to `target`, the way the owner does it.
 *
 * Nothing here is a shortcut into a state the app could not reach: the shell opens onboarding
 * because `get_config` says so, each click advances one step, and the RPC calls the wizard makes on
 * the way are the ones the case's `rpc` list asserts. The stubbed daemon answers them.
 */
async function driveWizard(page: Page, target: WizardDrive): Promise<void> {
  await stepLocator(page, 'onboarding-language').waitFor({ state: 'visible' });
  if (target === 'language') return;

  await stepLocator(page, 'onboarding-language-next').click();
  await stepLocator(page, 'onboarding-provider').waitFor({ state: 'visible' });
  if (target === 'provider') return;

  await page.locator('[data-testid="onboarding-provider-choices"] button').first().click();
  await stepLocator(page, 'onboarding-provider-next').click();
  await stepLocator(page, 'onboarding-key').waitFor({ state: 'visible' });
  if (target === 'key') return;

  await stepLocator(page, 'onboarding-key-input').fill(
    target === 'test-failed' ? REJECTED_KEY : ACCEPTED_KEY
  );
  await stepLocator(page, 'onboarding-connect').click();
  // The outcome, not the step: the test screen exists while the call is still in flight.
  const outcome = target === 'test-failed' ? 'refused' : 'passed';
  await page
    .locator(`[data-testid="onboarding-test"][data-status="${outcome}"]`)
    .waitFor({ state: 'visible' });
  if (target !== 'project' && target !== 'created') return;

  await stepLocator(page, 'onboarding-test-continue').click();
  await stepLocator(page, 'onboarding-project').waitFor({ state: 'visible' });
  if (target === 'project') return;

  await stepLocator(page, 'onboarding-project-input').fill(CREATED_PROJECT_NAME);
  await stepLocator(page, 'onboarding-project-create').click();
  // The wizard leaves the screen for the shell once the daemon has the project.
  await page.locator('.onboarding').waitFor({ state: 'detached' });
}

/**
 * The RPC surface both browser apps are tested against.
 *
 * Extracted from `openScreen` so `apps/remote/e2e/harness.ts` installs the *same* stub over the same
 * fixture table: the phone and the desktop read one daemon, and two stubs that can drift would let a
 * screen pass on the desktop and fail on the phone for a reason that is not in the product.
 *
 * @param page the page to intercept
 * @param daemon what the modelled daemon reports and has been told
 * @param report where what the stubs observed is recorded
 * @param token the bearer token the client is expected to send
 */
export async function installDaemonStub(
  page: Page,
  daemon: StubDaemon,
  report: StubReport,
  token = DAEMON_TOKEN
): Promise<void> {
  // The daemon answers JSON-RPC over HTTP; nothing listens on its port, and nothing has to.
  await page.route('**/rpc', async (route) => {
    const request = route.request();
    if (request.headers()['authorization'] !== `Bearer ${token}`) {
      report.unauthorized += 1;
    }

    let id: string | number = 0;
    let method = '';
    let params: unknown;
    try {
      const body = request.postDataJSON() as {
        id?: string | number;
        method?: string;
        params?: unknown;
      };
      id = body.id ?? 0;
      method = body.method ?? '';
      params = body.params;
    } catch {
      // A body that is not JSON is a client bug; the empty method name makes that obvious below.
    }

    report.rpcMethods.push(method);
    const behaviour = daemon.fixtures[method as RpcMethod];

    // "the daemon is not there" is a transport failure, not a JSON-RPC error: the client's own catch
    // path is what a screen then shows as offline.
    if (behaviour?.unreachable === true) {
      await route.abort('connectionrefused');
      return;
    }

    if (behaviour?.delayMs !== undefined) {
      await new Promise((resolve) => {
        setTimeout(resolve, behaviour.delayMs);
      });
    }

    const outcome = rpcResult(method as RpcMethod, params, daemon);
    if (outcome === null) report.unimplemented.push(method);

    await route.fulfill({
      status: outcome !== null && outcome.ok ? 200 : 500,
      contentType: 'application/json',
      body: JSON.stringify(
        outcome === null
          ? { jsonrpc: '2.0', id, error: { code: -32601, message: `no stub for ${method}` } }
          : outcome.ok
            ? { jsonrpc: '2.0', id, result: outcome.result }
            : { jsonrpc: '2.0', id, error: { code: outcome.code, message: outcome.message } }
      ),
    });
  });
}

/**
 * The `/events` surface, mocked.
 *
 * `open` keeps the socket alive and sends nothing, which is an idle daemon; `send` pushes the fixture
 * transcript, which is what makes a bench that folds lanes out of the feed (Simple, Advanced, the
 * phone's queue) worth photographing; `close` drops the connection, which is §7's "a dropped feed is
 * not a lost queue" — the only way a screen's reconnect path is reachable without a real daemon.
 */
export type EventStubMode = 'send' | 'open' | 'close' | 'refuse';

export async function installEventStub(
  page: Page,
  report: StubReport,
  mode: EventStubMode = 'send'
): Promise<void> {
  // 'refuse' installs nothing at all: the socket goes to a port where nothing listens, which is
  // exactly the daemon's feed being down.
  if (mode === 'refuse') return;
  await page.routeWebSocket(/\/events$/, (route) => {
    if (mode === 'close') {
      // After the current task: the client is still inside `new WebSocket(...)` when this handler
      // runs, and a close delivered before its `onclose` exists is a feed that never dropped.
      setTimeout(() => route.close({ code: 1006, reason: 'daemon dropped the feed' }), 400);
      return;
    }
    if (mode !== 'send') return;
    for (const frame of EVENT_FRAMES) {
      route.send(frame);
      report.eventsSent += 1;
    }
  });
}

/**
 * Open one screen in a deterministic browser state.
 *
 * @param page the page to drive
 * @param options what to open and how
 * @returns what the stubs observed
 */
export async function openScreen(page: Page, options: OpenScreenOptions): Promise<StubReport> {
  const report: StubReport = {
    rpcMethods: [],
    unauthorized: 0,
    unimplemented: [],
    configWrites: [],
    eventsSent: 0,
  };
  const screen = screenCase(options.screen);
  const scenario = scenarioById(options.scenario ?? 'default');
  const daemon: StubDaemon = {
    providers: options.providers ?? screen.providers ?? DAEMON_PROVIDERS,
    addedKeys: new Map<string, string>(),
    previews: new Map<string, StubPreview>(),
    fixtures: { ...scenario.fixtures, ...options.fixtures },
  };

  await page.setViewportSize({ width: options.viewport.width, height: options.viewport.height });
  // `colorScheme` is pinned too, so a `system` preference could never disagree with the case.
  await page.emulateMedia({ colorScheme: options.theme, reducedMotion: 'reduce' });
  // Before anything the app can run, so the first `new Date()` it reads is already the fixed instant.
  await page.clock.setFixedTime(FIXED_NOW);

  await installDaemonStub(page, daemon, report);
  await installEventStub(page, report, options.events ?? 'send');

  // Fonts are the one remote dependency of these pages. They are refused so a capture never depends on
  // the network, and so the families the token stack names first have to come from the capture host —
  // which is what `auditUsedFonts` then proves. The app bundle carries no font bytes.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());

  const search = options.search ?? screen.search ?? `?screen=${options.screen}`;
  // The stubbed shell answers the three daemon keys like `src-tauri/src/lib.rs` does — the app
  // carries no defaults of its own — then the case's own preferences on top.
  const config = {
    ...DAEMON_CONFIG,
    onboarding_complete: 'true',
    app_mode: 'simple',
    ...(screen.config ?? {}),
    ...(options.config ?? {}),
  };

  await page.addInitScript(
    ({ locale, theme, merged }: { locale: string; theme: string; merged: Record<string, string> }) => {
      // The two preferences the app reads at start-up, under the keys it uses.
      window.localStorage.setItem('warsha.theme', theme);
      window.localStorage.setItem('warsha.locale', locale);

      // `@tauri-apps/api/core`'s `invoke` is a thin wrapper over `__TAURI_INTERNALS__.invoke`, so
      // defining that object before the bundle runs is enough for `get_config` — no Tauri build,
      // no window, no Rust. The other members are stubbed because the module calls them on load.
      //
      // `set_config` lands in a page-side record as well as resolving: the first-run flag is written
      // there and nowhere else, so a flow check has to be able to read it back.
      const stubWindow = window as unknown as StubWindow & { __TAURI_INTERNALS__?: unknown };
      stubWindow.__WARSHA_STUB__ = { configWrites: [] };
      stubWindow.__TAURI_INTERNALS__ = {
        invoke: (command: string, args?: { key?: string; value?: string }) => {
          if (command === 'get_config') return Promise.resolve(merged[args?.key ?? ''] ?? '');
          if (command === 'set_config') {
            stubWindow.__WARSHA_STUB__?.configWrites.push({
              key: args?.key ?? '',
              value: args?.value ?? '',
            });
            return Promise.resolve(undefined);
          }
          return Promise.reject(new Error(`unexpected tauri command: ${command}`));
        },
        transformCallback: () => 1,
        unregisterCallback: () => undefined,
        convertFileSrc: (path: string) => path,
      };
    },
    { locale: options.locale, theme: options.theme, merged: config }
  );

  await page.goto(`${options.origin ?? ''}/${search}`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: NO_MOTION_CSS });

  const drive = options.drive ?? screen.drive;
  if (drive !== undefined) {
    await driveWizard(page, drive);
  }

  // A driven case is ready when the step it drove to is on screen. The exception is a finished first
  // run: the wizard has left the screen, so what has to be visible is the shell it left for.
  const ready = options.ready ?? screen.ready ?? (drive === 'created' ? '.simple-mode' : screen.root);
  if (ready !== undefined) {
    await page.locator(ready).first().waitFor({ state: 'visible' });
  }

  // The async start-up (onboarding flag, saved mode, projects) has to be finished before the audit:
  // the RPCs are answered instantly, so "nothing in flight" is reached here. A `pending` case IS the
  // loading state, which is the one thing that must not be waited out.
  if (scenario.settle === 'settled') {
    await page.waitForLoadState('networkidle');
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await settleScroll(page);

  report.configWrites = await page.evaluate(
    () => (window as unknown as StubWindow).__WARSHA_STUB__?.configWrites ?? []
  );

  return report;
}

/** The §7 states, as what the stubbed daemon has to do to produce them. */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'default',
    note: 'a daemon that has been used: two projects, four runs, one gate waiting, one approved',
    fixtures: {},
    settle: 'settled',
  },
  {
    id: 'empty',
    note: 'a daemon with nothing in it — every list answers empty, so each empty state is the screen\'s own',
    fixtures: {
      'projects.list': { result: [] },
      'runs.list': { result: [] },
      'gates.list': { result: [] },
      'providers.list': { result: [] },
      'roles.list': { result: [] },
      'devices.list': { result: [] },
      'postlaunch.crashes': { result: { crashes: [] } },
      'postlaunch.reviews': { result: { reviews: [] } },
    },
    settle: 'settled',
  },
  {
    id: 'loading',
    note: 'a daemon that has not answered yet — skeletons and the role="status" line, not an invented state',
    fixtures: {
      'projects.list': { delayMs: 30_000 },
      'runs.list': { delayMs: 30_000 },
      'gates.list': { delayMs: 30_000 },
      'budget.show': { delayMs: 30_000 },
      'providers.list': { delayMs: 30_000 },
      'roles.list': { delayMs: 30_000 },
      'devices.list': { delayMs: 30_000 },
      'postlaunch.crashes': { delayMs: 30_000 },
      'postlaunch.reviews': { delayMs: 30_000 },
      health: { delayMs: 30_000 },
    },
    settle: 'pending',
  },
  {
    id: 'screen-loading',
    // The shell's own start-up answers, so the screen mounts; only the list *that screen* reads is
    // still in flight. This is the difference between "the app is loading" and "this plate is loading",
    // and §7 asks for the second one to have its own words and skeleton.
    note: 'the screen is up and its own list has not answered yet — the per-plate loading state',
    fixtures: {
      'postlaunch.crashes': { delayMs: 30_000 },
      'postlaunch.reviews': { delayMs: 30_000 },
      'roles.list': { delayMs: 30_000 },
      'devices.list': { delayMs: 30_000 },
      'providers.list': { delayMs: 30_000 },
      'budget.show': { delayMs: 30_000 },
    },
    settle: 'pending',
  },
  {
    id: 'error',
    note: 'a daemon that refuses — §7: the error names the problem and the next action beside it',
    fixtures: {
      'runs.list': { error: 'project proj-ui has no runs yet' },
      'gates.list': { error: 'run run-code is not accepting gate decisions' },
      'budget.show': { error: 'budget for proj-ui is not recorded' },
      'roles.list': { error: 'routing table is locked while a run is writing' },
      'devices.list': { error: 'device registry refused: pairing token expired' },
      'providers.list': { error: 'provider registry read failed: database is locked' },
      'postlaunch.crashes': { error: 'post-launch store unread' },
      'postlaunch.reviews': { error: 'store API returned 503' },
    },
    settle: 'settled',
  },
  {
    id: 'offline',
    note: 'no daemon at all — the transport fails, the strip says offline, queued work is not implied lost',
    fixtures: {
      'projects.list': { unreachable: true },
      'runs.list': { unreachable: true },
      'gates.list': { unreachable: true },
      'budget.show': { unreachable: true },
      'providers.list': { unreachable: true },
      'roles.list': { unreachable: true },
      'devices.list': { unreachable: true },
      'postlaunch.crashes': { unreachable: true },
      'postlaunch.reviews': { unreachable: true },
      health: { unreachable: true },
    },
    settle: 'settled',
  },
  {
    id: 'permission',
    note: 'two gates waiting on the owner at once — the lit lamp is the queue (§1)',
    fixtures: {
      'gates.list': {
        result: [
          { stage: 'gate_a', state: { state: 'pending' } },
          { stage: 'gate_c', state: { state: 'pending' } },
          {
            stage: 'gate_b',
            state: {
              state: 'changes_requested',
              by: 'dev-phone',
              at: '2026-10-05T09:20:00.000Z',
              notes: 'أعد مراجعة حساب التكاليف قبل الاعتماد',
            },
          },
        ],
      },
    },
    settle: 'settled',
  },
  {
    id: 'success',
    note: 'nothing waiting: both gates decided, budget well under its ceiling, providers answering',
    fixtures: {
      'gates.list': {
        result: [
          {
            stage: 'gate_a',
            state: { state: 'approved', by: 'dev-laptop', at: '2026-10-05T08:10:00.000Z' },
          },
          {
            stage: 'gate_b',
            state: { state: 'approved', by: 'dev-phone', at: '2026-10-05T09:30:00.000Z' },
          },
        ],
      },
      'budget.show': {
        result: { project_id: 'proj-ui', budget_cents: 1200, spent_cents: 210, remaining_cents: 990 },
      },
    },
    settle: 'settled',
  },
  {
    id: 'parked',
    note: 'the run is stopped at one gate while the daemon reports all four pending — one lit plate, three names (§1)',
    // The state the parked reading was written for and no baseline showed: `run-gate-a` stands at `gate_a`,
    // `gates.list` answers four pending stages, and exactly one of them is why the run is not moving. The
    // queue's whole presentation depends on that one fact, so the fixture states it — and the shell selects
    // it by both rules at once: the desktop takes `projects[0]` then `runs[0]`, the phone takes the newest
    // project and its newest run (`apps/remote/src/bench.tsx`, `newestBy`), so the project list is narrowed
    // to one and the run carries the newest `updatedAt` in its project.
    fixtures: {
      'projects.list': { result: [PROJECTS[1]] },
      'runs.list': {
        result: [
          {
            id: 'run-gate-a',
            projectId: 'proj-store',
            stage: 'gate_a',
            status: 'awaiting_gate',
            startedAt: RUN_STARTED,
            updatedAt: '2026-10-05T09:50:00.000Z',
          },
        ],
      },
      'gates.list': { result: GATES_ALL_PENDING },
    },
    settle: 'settled',
  },
  {
    id: 'no-ceiling',
    note: 'a project that has spent money and never named a ceiling — `budget.show` answers its `Option` as null',
    // `bench.no_ceiling` ("no ceiling reported" / "لم يُبلَّغ عن سقف") shipped with five surfaces and zero
    // pixels: every other scenario answers `budget.show` with a 1200-cent ceiling, and the error, delay and
    // unreachable cases all land on the `budget === null` branch rather than the `!hasCeiling` one
    // (critique round 3, G4). `warshad` keeps `budget_cents` as an `Option`
    // (`crates/warshad/src/lib.rs:1045-1050`) and `@warsha/client` folds a null ceiling to `0` at the edge
    // (`packages/client/src/index.ts`, `centsToUsd`), which is the only no-ceiling signal a screen can get —
    // so the fixture answers the spend (437¢, a reading) without the cap (a word), on a settled daemon.
    fixtures: {
      'budget.show': {
        result: { project_id: 'proj-ui', budget_cents: null, spent_cents: 437, remaining_cents: null },
      },
    },
    settle: 'settled',
  },
  {
    id: 'dense',
    note: 'the §11 stress — the longest Arabic strings and the mixed-direction identifiers an owner can type',
    fixtures: {
      'projects.list': {
        result: [
          {
            id: 'proj-ui',
            name: 'لوحة متابعة الطلبات لمصنع الأثاث المكتبي مع ربط المخزون ونظام الدفع الإلكتروني',
            createdAt: '2026-10-01T08:00:00.000Z',
            updatedAt: '2026-10-02T09:30:00.000Z',
          },
          {
            id: 'proj-store',
            name: 'أطلس-7b1c — release/v2.4 (cargo test) للمراجعة النهائية',
            createdAt: '2026-10-03T08:00:00.000Z',
            updatedAt: '2026-10-04T09:30:00.000Z',
          },
        ],
      },
      'gates.list': {
        result: [
          {
            stage: 'gate_a',
            state: {
              state: 'pending',
              summary:
                'تحتاج مراجعة الجودة والأمان إلى توقيعك قبل النشر إلى المتجر الإلكتروني، لأن الميزانية تجاوزت الحد المسموح به لهذا الشهر',
            },
          },
        ],
      },
      'providers.list': {
        result: [
          {
            name: 'مزود الاحتياط المحلي',
            kind: 'ollama',
            enabled: true,
            api_base: 'http://192.168.1.20:11434/v1/chat/completions',
          },
        ],
      },
      'postlaunch.reviews': {
        result: {
          reviews: [
            {
              id: 'rev-long',
              store: 'play',
              rating: 4,
              body: 'أستخدم التطبيق لمتابعة أعمال الورشة منذ إصداره الأول وهو ممتاز، لكنني أتمنى إضافة تقارير مفصلة عن التكاليف لكل مشروع مع إمكانية تصديرها إلى جدول بيانات مباشرة من الهاتف دون الحاجة إلى اتصال بالإنترنت',
              author: 'عبدالرحمن',
              received_at: 1764939300,
            },
          ],
        },
      },
      'postlaunch.crashes': {
        result: {
          crashes: [
            {
              id: 'crash-bidi',
              run_id: 'run-code',
              message:
                'فشل تحميل المعاينة عند المسار src/components/LivePreview.tsx:118 بينما كان الأمر cargo test --workspace يعمل',
              stack_trace: 'thread main panicked at src/main.rs:42',
              occurred_at: 1764939300,
              sent: false,
            },
          ],
        },
      },
    },
    settle: 'settled',
  },
];

/** One scenario by id, with a message that says how many there are. */
export function scenarioById(id: ScenarioId): Scenario {
  const found = SCENARIOS.find((scenario) => scenario.id === id);
  if (found === undefined) {
    throw new Error(`no scenario is named "${id}" (there are ${SCENARIOS.length})`);
  }
  return found;
}
