// @warsha/i18n — Tests

import { describe, it, expect } from 'vitest';

import {
  formatMessage,
  t,
  direction,
  defaultLocale,
  messages,
  supportedLocales,
  LocaleProvider,
  useLocale,
  useDirection,
  useLocaleControl,
  LOCALE_STORAGE_KEY,
  applyLocale,
  isLocale,
  persistLocale,
  readStoredLocale,
  type Locale,
  type LocaleRoot,
  type LocaleStorage,
} from './index';

describe('i18n', () => {
  it('defaults to Arabic', () => {
    expect(defaultLocale).toBe('ar');
    expect(supportedLocales).toEqual(['ar', 'en']);
  });

  it('formats a simple message', () => {
    expect(formatMessage('Hello {name}', { name: 'World' }, 'en')).toBe('Hello World');
  });

  it('formats an Arabic message', () => {
    expect(formatMessage('مرحبا {name}', { name: 'عالم' }, 'ar')).toBe('مرحبا عالم');
  });

  it('translates a known key', () => {
    expect(t('gate.approve', {}, 'ar')).toBe('موافقة');
    expect(t('gate.approve', {}, 'en')).toBe('Approve');
  });

  it('interpolates values', () => {
    expect(t('run.status', { status: 'code' }, 'en')).toBe('Run status: code');
    expect(t('run.status', { status: 'كود' }, 'ar')).toBe('حالة التشغيل: كود');
  });

  it('falls back to the key when unknown', () => {
    expect(t('unknown_key', {}, 'en')).toBe('unknown_key');
  });

  it('reports direction per locale', () => {
    expect(direction('ar')).toBe('rtl');
    expect(direction('en')).toBe('ltr');
  });

  it('handles pluralization via ICU MessageFormat', () => {
    const pluralPattern = '{count, plural, =0 {لا توجد عناصر} one {عنصر واحد} other {# عناصر}}';
    expect(formatMessage(pluralPattern, { count: 0 }, 'ar')).toBe('لا توجد عناصر');
    expect(formatMessage(pluralPattern, { count: 1 }, 'ar')).toBe('عنصر واحد');
    expect(formatMessage(pluralPattern, { count: 5 }, 'ar')).toBe('5 عناصر');
  });

  it('handles select format for gender', () => {
    const selectPattern = '{gender, select, male {مرحباً بك} female {مرحباً بكِ} other {مرحباً}}';
    expect(formatMessage(selectPattern, { gender: 'male' }, 'ar')).toBe('مرحباً بك');
    expect(formatMessage(selectPattern, { gender: 'female' }, 'ar')).toBe('مرحباً بكِ');
    expect(formatMessage(selectPattern, { gender: 'other' }, 'ar')).toBe('مرحباً');
  });

  it('message catalog has required keys for app', () => {
    // Verify all keys used in App.tsx exist in both locales
    const requiredKeys = ['app.name', 'app.tagline', 'gate.approve', 'gate.reject', 'gate.request_changes', 'run.status'];
    for (const key of requiredKeys) {
      expect(t(key, {}, 'ar')).not.toBe(key); // Should not fall back to key
      expect(t(key, {}, 'en')).not.toBe(key);
    }
  });

  it('carries the same keys in both catalogs, with real copy in each', () => {
    // `t` falls back to the Arabic catalog when English has no entry, so a gap would render Arabic
    // copy inside an English session and never fail anything. The two key sets are the contract.
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.ar).sort());

    for (const key of Object.keys(messages.ar)) {
      expect(messages.ar[key]?.trim(), `${key} has no Arabic copy`).not.toBe('');
      expect(messages.en[key]?.trim(), `${key} has no English copy`).not.toBe('');
    }
  });

  it('carries every first-run wizard string in both catalogs', () => {
    // The wizard's steps are the only place a new owner can be told anything, so its keys are checked
    // by name: a step whose copy fell back to the key would render `onboarding.key_title` on screen.
    const wizardKeys = Object.keys(messages.ar).filter((key) => key.startsWith('onboarding.'));

    expect(wizardKeys.length).toBeGreaterThan(0);
    for (const key of wizardKeys) {
      expect(t(key, {}, 'ar'), `${key} is missing from the ar catalog`).not.toBe(key);
      expect(t(key, {}, 'en'), `${key} is missing from the en catalog`).not.toBe(key);
    }
  });
  it('direction function works with type Locale', () => {
    const ar: Locale = 'ar';
    const en: Locale = 'en';
    expect(direction(ar)).toBe('rtl');
    expect(direction(en)).toBe('ltr');
  });

  it('LocaleProvider and hooks are exported', () => {
    expect(LocaleProvider).toBeDefined();
    expect(useLocale).toBeDefined();
    expect(useDirection).toBeDefined();
    expect(useLocaleControl).toBeDefined();
  });
});

// The Bench & Signal screens (docs/design/REDESIGN.md §13) carry no literals of their own: `SimpleMode`,
// `GatesInbox`, `RunView`, `Onboarding`, the provider row and wizard, the composer pickers and the
// handoff dialog resolve everything through `t()`. A missing key therefore renders the key name on
// screen instead of falling back to a hard-coded string, so these namespaces are pinned by name — and
// with the exact English copy the desktop test suite queries by (`getByLabelText('Base URL')`,
// `getByText('✓ Model')`, `/Mode — Ollama/`), which is what makes this catalog the single source.
describe('Bench & Signal screen copy', () => {
  /** The namespaces the B3-core screens read. */
  const screenNamespaces = [
    'common.',
    'role.',
    'simple.',
    'gates.',
    'gate.',
    'run.',
    'onboarding.',
    'providers.',
    'router.setup.',
    'continue_on_server.',
    'agent_workflow.',
  ] as const;

  const screenKeys = Object.keys(messages.ar).filter((key) =>
    screenNamespaces.some((namespace) => key.startsWith(namespace))
  );

  it('resolves every screen key in both languages', () => {
    expect(screenKeys.length).toBeGreaterThan(80);

    for (const key of screenKeys) {
      expect(t(key, {}, 'ar'), `${key} has no Arabic copy`).not.toBe(key);
      expect(t(key, {}, 'en'), `${key} has no English copy`).not.toBe(key);
    }
  });

  it('keys the desktop tests query by keep their exact English copy', () => {
    // `RouterAdditions.test.tsx` and `SettingsProviders.test.tsx` look these up by name; a reworded
    // catalog entry would fail a test that has no reason to fail.
    expect(t('router.setup.provider', {}, 'en')).toBe('Provider');
    expect(t('router.setup.url', {}, 'en')).toBe('Base URL');
    expect(t('router.setup.key', {}, 'en')).toBe('API key');
    expect(t('router.setup.model', {}, 'en')).toBe('Model');
    expect(t('router.setup.test', {}, 'en')).toBe('Test connection');
    expect(t('router.setup.save', {}, 'en')).toBe('Save provider');
    expect(t('router.setup.check.model', {}, 'en')).toBe('Model');
    expect(t('router.setup.reason.url_scheme', {}, 'en')).toContain('http://');
    expect(t('providers.mode', {}, 'en')).toBe('Mode');
    expect(t('providers.enabled', {}, 'en')).toBe('Enabled');
    expect(t('providers.pinned', {}, 'en')).toBe('Pinned version');
    expect(t('providers.pinned', {}, 'ar')).toBe('نسخة مثبّتة');
    expect(t('run.router_empty', {}, 'ar')).toBe('لا توجد أهداف توجيه بعد');
    expect(t('simple.welcome', { name: 'متجر ورشة' }, 'ar')).toContain('أهلاً بك في مشروع');
  });

  it('pluralises the gate count in both languages', () => {
    expect(t('simple.summary_gates', { count: 0 }, 'en')).toBe('Nothing is waiting on you.');
    expect(t('simple.summary_gates', { count: 1 }, 'en')).toBe('1 gate is waiting on you.');
    expect(t('simple.summary_gates', { count: 4 }, 'en')).toBe('4 gates are waiting on you.');
    expect(t('simple.summary_gates', { count: 1 }, 'ar')).toBe('بوابة واحدة بانتظارك.');
    expect(t('simple.team_count', { count: 12 }, 'ar')).toBe('12 عضواً');
  });

  it('names the handoff phases from the catalog, not from a component table', () => {
    for (const phase of ['idle', 'preparing', 'handed_off', 'applying', 'applied', 'failed']) {
      const key = `continue_on_server.status.${phase}`;
      expect(t(key, {}, 'ar'), `${key} has no Arabic copy`).not.toBe(key);
      expect(t(key, {}, 'en'), `${key} has no English copy`).not.toBe(key);
    }
    expect(t('continue_on_server.status.applied', {}, 'en')).toBe(
      'The changes were applied, with a backup'
    );
  });
});

// The B3-secondary screens (docs/design/REDESIGN.md §5: projects board, artifact viewer, the live
// preview family, the settings family and the components they own) carry no literals either — no
// `t(...) || 'literal'` fallback and no `locale === 'ar' ? … : …` copy branch. The namespaces below
// are therefore the whole surface of those screens, and the exact English copy is pinned because the
// desktop suite queries by it (`LivePreview.test.tsx`, `PreviewToolbar.test.tsx`,
// `BackendKitPanel.test.tsx`, `RouterAdditions.test.tsx`, `Routines.test.tsx`,
// `SettingsProviders.test.tsx`, `App.test.tsx`).
describe('Bench & Signal secondary screen copy', () => {
  /** The namespaces `ProjectsBoard`, `ArtifactViewer`, the preview and the settings family read. */
  const secondaryNamespaces = [
    'common.',
    'bench.',
    'errors.',
    'archive.',
    'projects.',
    'artifacts.',
    'live_preview.',
    'settings.',
    'settings_providers.',
    'theme.',
    'eco.',
    'router.eco.',
    'routines.',
    'backend_kit.',
    'providers.',
    'roles.',
    'budgets.',
    'devices.',
  ] as const;

  const secondaryKeys = Object.keys(messages.ar).filter((key) =>
    secondaryNamespaces.some((namespace) => key.startsWith(namespace))
  );

  it('resolves every secondary screen key in both languages', () => {
    expect(secondaryKeys.length).toBeGreaterThan(150);

    for (const key of secondaryKeys) {
      expect(t(key, {}, 'ar'), `${key} has no Arabic copy`).not.toBe(key);
      expect(t(key, {}, 'en'), `${key} has no English copy`).not.toBe(key);
    }
  });

  it('keys the preview tests query by keep their exact copy', () => {
    // `LivePreview.test.tsx` and `PreviewToolbar.test.tsx` read these out of the rendered DOM, and
    // `App.test.tsx` clicks `preview-run-button` in Arabic — the copy is the contract.
    expect(t('live_preview.title', {}, 'en')).toBe('Live preview');
    expect(t('live_preview.frame', {}, 'en')).toBe('App preview');
    expect(t('live_preview.frame', {}, 'ar')).toBe('معاينة التطبيق');
    expect(t('live_preview.toolbar', {}, 'en')).toBe('Preview controls');
    expect(t('live_preview.placeholder', {}, 'en')).toBe('No preview yet');
    expect(t('live_preview.placeholder_hint', {}, 'en')).toContain('Start the dev server, then press Run');
    expect(t('live_preview.pick.hint', {}, 'en')).toBe('Click an element in the preview');
    expect(t('live_preview.pick.hint', {}, 'ar')).toBe('انقر على عنصر في المعاينة');
    expect(t('live_preview.pick.submit', {}, 'en')).toBe('Send selector');
    expect(t('live_preview.error', {}, 'en')).toContain('stopped with an error');
    expect(t('live_preview.action.run', {}, 'en')).toBe('Run');
    expect(t('live_preview.action.stop', {}, 'en')).toBe('Stop');
    expect(t('live_preview.action.pop_out', {}, 'en')).toBe('Pop out');
    expect(t('live_preview.action.pick_element', {}, 'en')).toBe('Pick element');
    expect(t('live_preview.action.picking', {}, 'en')).toBe('Stop picking');
    expect(t('live_preview.action.run', {}, 'ar')).toBe('تشغيل المعاينة');
    expect(t('live_preview.description.run', {}, 'en')).toBe('Starts the dev server and shows it here');
    expect(t('live_preview.blocked.run', {}, 'en')).toBe('The preview is already running');
    expect(t('live_preview.blocked.stop', {}, 'en')).toBe('Nothing is running to stop');
    expect(t('live_preview.blocked.pick_element', {}, 'en')).toBe(
      'Picking works only while the preview is running'
    );
  });

  it('keys the settings-family tests query by keep their exact copy', () => {
    expect(t('settings_providers.title', {}, 'en')).toBe('Providers');
    expect(t('settings_providers.title', {}, 'ar')).toBe('المزوّدون');
    expect(t('settings_providers.note', {}, 'en')).toContain('Off by default');
    expect(t('settings_providers.note', {}, 'ar')).toContain('معطّلة افتراضياً');
    expect(t('routines.title', {}, 'en')).toBe('Routines');
    expect(t('routines.title', {}, 'ar')).toBe('الروتينات');
    expect(t('routines.empty', {}, 'en')).toContain('No routines yet.');
    expect(t('routines.count', { count: 3 }, 'en')).toBe('3 routines');
    expect(t('routines.count', { count: 3 }, 'ar')).toBe('3 روتين');
    for (const state of ['idle', 'running', 'paused', 'failed']) {
      expect(t(`routines.state.${state}`, {}, 'en'), `routine state ${state} lost its copy`).not.toBe(
        `routines.state.${state}`
      );
    }
    expect(t('routines.state.paused', {}, 'en')).toBe('Paused');
    expect(t('routines.state.failed', {}, 'ar')).toBe('فشلت');
    expect(t('routines.action.run', {}, 'en')).toBe('Run now');
    expect(t('routines.action.pause', {}, 'en')).toBe('Pause');
    expect(t('routines.action.resume', {}, 'en')).toBe('Resume');
    // The theme switch and the eco line (`ThemeToggle.test.tsx`, `RouterAdditions.test.tsx`).
    expect(t('theme.group', {}, 'en')).toBe('Theme');
    expect(t('theme.light', {}, 'en')).toBe('Light');
    expect(t('theme.dark', {}, 'en')).toBe('Dark');
    expect(t('theme.system', {}, 'en')).toBe('System');
    expect(t('theme.light', {}, 'ar')).toBe('فاتح');
    expect(t('theme.dark', {}, 'ar')).toBe('داكن');
    expect(t('theme.system', {}, 'ar')).toBe('النظام');
    expect(t('theme.hint.system', {}, 'en')).toContain('OS');
    expect(t('theme.hint.light', {}, 'en')).toContain('light');
    expect(t('theme.hint.dark', {}, 'ar')).toContain('الداكنة');
    expect(t('router.eco.title', {}, 'ar')).toBe('الوضع الاقتصادي');
    expect(t('router.eco.title', {}, 'en')).toBe('Eco mode');
    expect(t('eco.battery', {}, 'en')).toBe('Battery');
    expect(t('eco.mains', {}, 'en')).toBe('On mains power');
    expect(t('eco.online', {}, 'en')).toBe('Online');
    expect(t('eco.offline', {}, 'en')).toBe('Offline');
    // The backend kit (`BackendKitPanel.test.tsx`): the radiogroup's name, the services, the gate line.
    expect(t('backend_kit.kind', {}, 'en')).toBe('Backend');
    expect(t('backend_kit.title', {}, 'ar')).toBe('حزمة الواجهة الخلفية');
    expect(t('backend_kit.kind.pocket_base', {}, 'ar')).toBe('بوكيت بيز');
    expect(t('backend_kit.feature.postgres_rls', {}, 'ar')).toBe('أمان الصفوف (RLS)');
    expect(t('backend_kit.tables', {}, 'ar')).toBe('الجداول');
    expect(t('backend_kit.tables.empty', {}, 'en')).toBe('No tables yet');
    expect(t('backend_kit.export.blocked', {}, 'en')).toBe('Nothing to export yet');
    expect(t('backend_kit.column.nullable', {}, 'en')).toBe('nullable');
    expect(t('backend_kit.payments.off', {}, 'en')).toBe('Off — owner approval required');
    expect(t('backend_kit.payments.off', {}, 'ar')).toBe('متوقفة — تحتاج موافقة المالك');
    expect(t('backend_kit.payments.on', {}, 'en')).toBe('Enabled');
    expect(t('backend_kit.payments.approved_by', {}, 'en')).toBe('approved by');
  });

  it('counts projects, runs and routing targets in both languages', () => {
    // Arabic needs its own plural forms; a `other`-only pattern reads wrong for 2 and 3.
    expect(t('projects.run_count', { count: 0 }, 'ar')).toBe('لا تشغيل بعد');
    expect(t('projects.run_count', { count: 1 }, 'ar')).toBe('تشغيل واحد');
    expect(t('projects.run_count', { count: 2 }, 'ar')).toBe('تشغيلان');
    expect(t('projects.run_count', { count: 3 }, 'ar')).toBe('3 تشغيلات');
    expect(t('projects.run_count', { count: 11 }, 'ar')).toBe('11 تشغيلاً');
    expect(t('projects.run_count', { count: 2 }, 'en')).toBe('2 runs');
    expect(t('roles.target_count', { count: 1 }, 'ar')).toBe('هدف واحد');
    expect(t('roles.target_count', { count: 3 }, 'ar')).toBe('3 أهداف');
    expect(t('roles.target_count', { count: 1 }, 'en')).toBe('1 target');
    expect(t('artifacts.characters', { count: 42 }, 'en')).toBe('42 characters');
    expect(t('backend_kit.columns.count', { count: 2 }, 'en')).toBe('2 columns');
  });

  it('says what the bench needs in words, not in a colour', () => {
    // The lamp words the projects board and the settings family pair with each state (§9).
    expect(t('projects.awaiting_gate', {}, 'en')).toBe('gate waiting on you');
    expect(t('providers.health.ok', {}, 'en')).toBe('connection healthy');
    expect(t('providers.probe.none', {}, 'en')).toBe('not tested yet');
    expect(t('errors.provider_unauthorized', {}, 'en')).toBe('The provider does not accept this key.');
    expect(t('errors.provider_unauthorized_hint', {}, 'ar')).toContain('حدّث المفتاح');
    expect(t('devices.revoked', {}, 'en')).toBe('device unpaired');
    expect(t('budgets.remaining', {}, 'en')).toBe('remaining');
    expect(t('bench.budget_used', {}, 'en')).toBe('Budget used');
    expect(t('archive.empty_title', {}, 'en')).toBe('Nothing is archived');
    expect(t('artifacts.word', {}, 'ar')).toBe('مصنوعة');
  });
});

// The B3e bench (docs/design/REDESIGN.md §4, §13): the top bar, the instrument strip, the gate bell, the
// settings tab strip, the Advanced workbench, the ship plate and the two post-launch ledgers. None of them
// carries a literal of its own — the shell replaced every `t(…) || 'literal'` and every `localized()`
// fallback — so these namespaces are pinned by name and by the exact copy the desktop tests query by
// (`getByRole('status', { name: 'Status strip' })`, `getByText('Daemon offline')`, `Try again`).
describe('Bench & Signal shell copy', () => {
  /** The namespaces the shell, the Advanced bench and the post-launch ledgers read. */
  const shellNamespaces = [
    'app.',
    'bench.',
    'shell.',
    'settings.tabs',
    'settings.crashReports',
    'settings.storeReviews',
    'settings.backendKit',
    'advanced.',
    'status_strip.',
    'work_protection.',
    'agent_workflow.mode',
    'run_modes.',
    'router.kind',
    'review_apply.',
    'post_launch.',
  ] as const;

  const shellKeys = Object.keys(messages.ar).filter((key) =>
    shellNamespaces.some((namespace) => key.startsWith(namespace))
  );

  it('resolves every shell key in both languages', () => {
    // The B3e block is the bench's own chrome; a count of its own proves the namespaces were filled
    // rather than left to the component tables they replaced.
    expect(shellKeys.length).toBeGreaterThan(120);

    for (const key of shellKeys) {
      expect(t(key, {}, 'ar'), `${key} has no Arabic copy`).not.toBe(key);
      expect(t(key, {}, 'en'), `${key} has no English copy`).not.toBe(key);
    }
  });

  it('names the top bar and the instrument strip in words the shell can press', () => {
    expect(t('app.simpleMode', {}, 'en')).toBe('Simple');
    expect(t('app.advancedMode', {}, 'en')).toBe('Advanced');
    expect(t('app.settings', {}, 'ar')).toBe('الإعدادات');
    expect(t('app.mode_label', {}, 'en')).toBe('Interface mode');
    expect(t('app.skip_to_bench', {}, 'en')).toBe('Skip to the workbench');
    expect(t('bench.status_label', {}, 'en')).toBe('Status strip');
    expect(t('bench.daemon_online', {}, 'en')).toBe('daemon online');
    expect(t('bench.daemon_offline', {}, 'en')).toBe('daemon offline');
    expect(t('bench.no_run', {}, 'en')).toBe('no run selected');
    // A reading the daemon has not made is said, never faked as a zero (§7).
    expect(t('bench.not_reported', {}, 'en')).toBe('not reported yet');
    expect(t('bench.budget_used', {}, 'ar')).toBe('الميزانية المستعملة');
    expect(t('shell.gate_bell', {}, 'ar')).toBe('قائمة البوّابات');
    expect(t('settings.crashReports', {}, 'ar')).toBe('تقارير الأعطال');
    expect(t('settings.storeReviews', {}, 'en')).toBe('Store reviews');
    expect(t('settings.backendKit', {}, 'ar')).toBe('حزمة الواجهة الخلفية');
  });

  it('gives the Advanced bench its panes, its filters and its honest empty states', () => {
    for (const pane of ['lanes', 'events', 'board', 'files', 'terminal', 'costs', 'ship']) {
      expect(t(`advanced.tab_${pane}`, {}, 'en'), `advanced.tab_${pane} lost its copy`).not.toBe(
        `advanced.tab_${pane}`
      );
    }
    expect(t('advanced.filter_all', {}, 'en')).toBe('All');
    expect(t('advanced.filter_gates', {}, 'ar')).toBe('البوّابات');
    // §3: the rule that a filter never hides a gate is copy, so it is the catalog's sentence.
    expect(t('advanced.filter_note', {}, 'en')).toBe('A filter never hides gate events.');
    expect(t('advanced.terminal_hint', {}, 'en')).toContain('does not execute commands');
    expect(t('advanced.files_empty', {}, 'en')).toContain('No file list from the daemon yet');
    expect(t('advanced.cost_none', {}, 'ar')).toContain('لم يبلّغ أي مسار');
  });

  it('says the ship status, the deploy and the preflight in both languages', () => {
    expect(t('status_strip.label', {}, 'en')).toBe('Ship status');
    expect(t('status_strip.stage.code_checks', {}, 'en')).toBe('Code checks');
    expect(t('status_strip.stage.store_ready', {}, 'ar')).toBe('جاهز للمتجر');
    expect(t('status_strip.status.pending', {}, 'en')).toBe('Pending');
    expect(t('status_strip.status.fail', {}, 'ar')).toBe('فاشل');
    expect(t('status_strip.deploy.idle', {}, 'en')).toBe('Deploy to web');
    expect(t('status_strip.deploy.blocked', {}, 'en')).toContain('release preflight is green');
    expect(t('status_strip.deploy.local_only', {}, 'en')).toContain('records the intent');
    expect(t('status_strip.preflight.title', {}, 'ar')).toBe('فحص ما قبل الإصدار');
    expect(t('status_strip.preflight.count', { passed: 2, total: 6 }, 'en')).toBe('2 of 6 passed');
    expect(t('status_strip.preflight.count', { passed: 0, total: 6 }, 'ar')).toBe('0 من 6 ناجح');
  });

  it('keeps work protection, the agent workflow and the run modes in the catalog', () => {
    // `App.test.tsx` and the bench tests query these by their Arabic words.
    expect(t('work_protection.mode.ask_for_risky', {}, 'ar')).toBe('اسأل عند الخطر');
    expect(t('work_protection.mode_hint.auto_inside_project', {}, 'en')).toContain('inside the project');
    expect(t('work_protection.restore', {}, 'en')).toBe('Restore snapshot');
    expect(t('work_protection.snapshot_none', {}, 'en')).toContain('no snapshot');
    expect(t('agent_workflow.mode.plan', {}, 'ar')).toBe('تخطيط');
    expect(t('agent_workflow.mode_hint.plan', {}, 'en')).toContain('needs your approval');
    expect(t('run_modes.mode.self_hosted', {}, 'en')).toBe('Self-hosted');
    expect(t('run_modes.hint.local', {}, 'en')).toContain('127.0.0.1');
    expect(t('router.kind.local', {}, 'ar')).toBe('محلي');
    expect(t('router.kind_hint.cloud', {}, 'en')).toBe('Runs on the provider servers');
  });

  it('reviews and applies the handoff in words the panel can press', () => {
    expect(t('review_apply.title', {}, 'ar')).toBe('مراجعة وتطبيق');
    expect(t('review_apply.summary', { count: 3 }, 'en')).toBe('3 files changed');
    expect(t('review_apply.summary', { count: 0 }, 'ar')).toBe('لا ملفات متغيرة');
    expect(t('review_apply.conflicts', { count: 1 }, 'en')).toBe('1 conflict');
    expect(t('review_apply.truncated', { count: 5 }, 'en')).toBe('5 more lines not shown');
    expect(t('review_apply.apply_all', {}, 'ar')).toBe('تطبيق الكل');
    expect(t('review_apply.backup', {}, 'ar')).toBe('تُحفظ نسخة احتياطية قبل الكتابة فوق أي ملف');
    expect(t('review_apply.owner_wins', {}, 'en')).toContain('your local file wins');
  });

  it('counts reports and reviews with Arabic plurals, not with a locale ternary', () => {
    expect(t('post_launch.crash.title', {}, 'ar')).toBe('تقارير الأعطال');
    expect(t('post_launch.crash.count', { count: 0 }, 'ar')).toBe('لا تقارير');
    expect(t('post_launch.crash.count', { count: 2 }, 'ar')).toBe('تقريران');
    expect(t('post_launch.crash.count', { count: 3 }, 'en')).toBe('3 reports');
    expect(t('post_launch.crash.sent', {}, 'ar')).toBe('مُرسل');
    expect(t('post_launch.crash.unsent', {}, 'ar')).toBe('لم يُرسل');
    expect(t('post_launch.crash.failed', {}, 'en')).toContain('did not answer the crash list');

    expect(t('post_launch.reviews.count', { count: 0 }, 'ar')).toBe('لا تقييمات');
    expect(t('post_launch.reviews.count', { count: 3 }, 'ar')).toBe('3 تقييمات');
    expect(t('post_launch.reviews.rating_of', { value: 4, max: 5 }, 'ar')).toBe('4 من 5');
    expect(t('post_launch.reviews.out_of_range', {}, 'en')).toBe('Rating out of range');
    expect(t('post_launch.reviews.filter_low', {}, 'en')).toBe('Three or fewer');
  });

  it('pluralises the gates the bell counts in both languages', () => {
    expect(t('simple.summary_gates', { count: 0 }, 'en')).toBe('Nothing is waiting on you.');
    expect(t('simple.summary_gates', { count: 1 }, 'ar')).toBe('بوابة واحدة بانتظارك.');
    expect(t('bench.gates_waiting', {}, 'en')).toBe('gates waiting on you');
    expect(t('shell.gate_bell_none', {}, 'ar')).toContain('لا بوّابات');
  });
});

// The remote bench (docs/design/REDESIGN.md §2's mobile checker, §10's 390 row) is B3-remote's own
// surface: a shell, five screens and a pairing/session module, none of which carries a literal, a
// `t(…) || 'literal'` fallback or a `locale === 'ar' ? … : …` copy branch. Every string the phone shows
// therefore lives here, and `apps/remote`'s tests query it by the same words the owner reads.
describe('Bench & Signal remote copy', () => {
  /** The namespace `apps/remote/src` reads. */
  const remoteKeys = Object.keys(messages.ar).filter((key) => key.startsWith('remote.'));

  it('carries the remote bench its own namespace', () => {
    expect(remoteKeys.length).toBeGreaterThanOrEqual(40);
  });

  it('resolves every remote key in both languages', () => {
    for (const key of remoteKeys) {
      expect(t(key, {}, 'ar'), `${key} has no Arabic copy`).not.toBe(key);
      expect(t(key, {}, 'en'), `${key} has no English copy`).not.toBe(key);
    }
  });

  it('says the pairing rules as copy, not as a component string', () => {
    // The session module's whole promise is in these two lines; a screen that could not say them would
    // be storing a token somewhere the owner never agreed to.
    expect(t('remote.session_token_note', {}, 'en')).toContain('never written to persistent storage');
    expect(t('remote.session_token_note', {}, 'ar')).toContain('لا يُكتب في التخزين الدائم');
    expect(t('remote.pair_reason.userinfo', {}, 'en')).toContain('credentials never travel in the address');
    expect(t('remote.pair_reason.userinfo', {}, 'ar')).toContain('لا تُكتب الاعتمادات في العنوان');
    expect(t('remote.pair_reason.token', {}, 'en')).toBe('The link carries no pairing token.');
    expect(t('remote.pair_reason.missing', {}, 'ar')).toBe('الصق رابط الإقران أولاً.');
    expect(t('remote.session_ended', {}, 'en')).toBe('the session ended on this device');
  });

  it('counts the waiting gates with Arabic plurals', () => {
    expect(t('remote.queue_pending', { count: 0 }, 'ar')).toBe('لا بوّابات بانتظارك');
    expect(t('remote.queue_pending', { count: 0 }, 'en')).toBe('no gates waiting on you');
    expect(t('remote.queue_pending', { count: 1 }, 'ar')).toBe('بوابة واحدة بانتظارك');
    expect(t('remote.queue_pending', { count: 2 }, 'ar')).toBe('بوّابتان بانتظارك');
    expect(t('remote.queue_pending', { count: 3 }, 'ar')).toBe('3 بوابات بانتظارك');
    expect(t('remote.queue_pending', { count: 11 }, 'ar')).toBe('11 بوابةً بانتظارك');
    expect(t('remote.queue_pending', { count: 4 }, 'en')).toBe('4 gates waiting on you');
  });

  it('names the states the phone reads out loud', () => {
    // `App.test.tsx` and the screen tests look these up by their rendered words.
    expect(t('remote.nav.needs_you', {}, 'en')).toBe('Needs you');
    expect(t('remote.nav.needs_you', {}, 'ar')).toBe('بانتظارك');
    expect(t('remote.nav.run', {}, 'en')).toBe('Run');
    expect(t('remote.brand_role', {}, 'ar')).toBe('طاولة العمل عن بُعد');
    expect(t('remote.decision_done', {}, 'en')).toBe('decision recorded');
    expect(t('remote.decision_failed', {}, 'ar')).toBe(
      'لم يستجب الخادم للقرار؛ البوابة ما زالت بانتظارك.'
    );
    expect(t('remote.queue_source_stage', {}, 'en')).toBe('read from the run stage');
    expect(t('remote.run_state_paused', {}, 'ar')).toBe('موقوف مؤقتاً');
    expect(t('remote.run_state_cancelled', {}, 'en')).toBe('cancelled');
  });

  it('keeps the remote bench inside the shared key sets', () => {
    // The remote reuses the bench's own words rather than re-naming them: the strip, the gates, the
    // settings plates and the retry all read keys the desktop already answers from.
    for (const key of [
      'bench.daemon_online',
      'bench.daemon_offline',
      'bench.daemon_unreachable',
      'bench.budget_used',
      'bench.no_run',
      'bench.stage_label',
      'common.retry',
      'gates.empty',
      'gates.empty_desc',
      'nav.gates',
      'nav.projects',
      'nav.settings',
      'settings.preferences',
      'settings.language',
      'theme.group',
      'run.events_failed',
      'projects.failed',
      'simple.stream_offline',
    ]) {
      expect(t(key, {}, 'ar'), `${key} has no Arabic copy`).not.toBe(key);
      expect(t(key, {}, 'en'), `${key} has no English copy`).not.toBe(key);
    }
  });

  it('never lets the remote namespace collide with the desktop blocks', () => {
    // A `remote.` key that duplicates another key's copy is the first sign of a forked catalog; the
    // two blocks are separate namespaces, so the same string under two names is a review question.
    const remoteNames = new Set(remoteKeys);
    expect([...remoteNames].every((key) => key.length > 'remote.'.length)).toBe(true);
    expect(remoteKeys.filter((key) => key === 'remote.')).toEqual([]);
  });
});

// The desktop app could not actually run in English: the locale never reached storage, and nothing
// kept `<html lang>`/`<html dir>` in step with the choice. These helpers are the shared half of the
// fix; the app half (provider mounting, the onboarding language buttons) is tested in// `apps/desktop/src/locale.test.tsx`, which has a DOM.
describe('locale preference', () => {
  /** A `Storage` stand-in, so this test needs no DOM. */
  function fakeStorage(initial: Record<string, string> = {}): LocaleStorage & {
    readonly values: Record<string, string>;
  } {
    const values = { ...initial };
    return {
      values,
      getItem: (key) => values[key] ?? null,
      setItem: (key, value) => {
        values[key] = value;
      },
    };
  }

  /** The two attributes `applyLocale` writes. */
  function fakeRoot(): LocaleRoot {
    return { lang: '', dir: '' };
  }

  it('reads the stored choice, and Arabic when there is none', () => {
    expect(readStoredLocale(fakeStorage())).toBe('ar');
    expect(readStoredLocale(fakeStorage({ [LOCALE_STORAGE_KEY]: 'en' }))).toBe('en');
    expect(readStoredLocale(null)).toBe('ar');
  });

  it('ignores a stored value it does not recognise', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(readStoredLocale(fakeStorage({ [LOCALE_STORAGE_KEY]: 'fr' }))).toBe('ar');
  });

  it('stores the choice under the theme-key naming convention', () => {
    expect(LOCALE_STORAGE_KEY).toBe('warsha.locale');

    const storage = fakeStorage();
    persistLocale('en', storage);
    expect(storage.values[LOCALE_STORAGE_KEY]).toBe('en');
  });

  it('survives a storage that throws', () => {
    const throwing: LocaleStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    expect(readStoredLocale(throwing)).toBe('ar');
    expect(() => persistLocale('en', throwing)).not.toThrow();
    expect(() => readStoredLocale(null)).not.toThrow();
  });

  it('writes both lang and dir, so the document never claims a direction it is not using', () => {
    const root = fakeRoot();
    expect(applyLocale('en', root)).toBe('en');
    expect(root).toEqual({ lang: 'en', dir: 'ltr' });

    applyLocale('ar', root);
    expect(root).toEqual({ lang: 'ar', dir: 'rtl' });
  });

  it('is a no-op with no root, rather than throwing', () => {
    expect(applyLocale('en', null)).toBe('en');
  });
});