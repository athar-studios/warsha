// Settings — the owner's preferences plate (PLAN.md M8, redrawn for Bench & Signal in B3-secondary).
//
// REDESIGN §5 gives this screen "language segmented control, theme segmented control (owner choice), eco
// mode switch; subscriptions ledger" on two plates. What it had was two columns of rounded rows built from
// `t('…') || 'literal'` fallbacks and a routines list that duplicated the Routines screen — so the same
// setting read differently depending on which screen the owner reached first.
//
// The bench shape:
//
//   * two plates fastened by hairlines, each with its own ruled head (§1.1);
//   * one choice per row, and each row's control is the same component the rest of the app uses:
//     `Segmented` for the language, `ThemeToggle` for the theme, `EcoModeToggle` for eco mode. Settings and
//     the top bar cannot drift apart because they are literally the same switch (requirement: coherence);
//   * the subscriptions are a ledger, and the lamp is lit only where the owner is actually needed — a
//     subscription that is not connected is the owner's to connect (§1);
//   * no routine list here: routines live on their own tab, and a copy of them here would be a second
//     source of truth for the same registry (§3's disclosure ladder adds detail, it never duplicates).
//
// Every word is `@warsha/i18n`: the fallbacks, the `locale === 'ar' ? routine.ar : routine.en` branches and
// the `{ ar, en }` fixture tables are gone.
import { type IntegrationConfig, type IntegrationStatus, type ProjectSummary, type WarshaClient } from '@warsha/client';
import { isLocale, t, useDirection, useLocale, useLocaleControl } from '@warsha/i18n';
import { Box, Button, Chip, Field, Lamp, Ledger, Panel, Segmented, Text, fieldControl, SettingsScopeSentence } from '@warsha/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { EcoModeToggle } from '../components/EcoModeToggle';
import { ThemeToggle } from '../components/ThemeToggle';
import { useTheme } from '../theme';

interface SettingsScreenProps {
  client: WarshaClient;
  onBack?: () => void;
  project?: ProjectSummary | null;
}

/** One third-party connection the daemon knows about (`subscriptions.list` is the seam). */
interface Subscription {
  id: string;
  /** A service's own name is a proper noun: it never gets translated (§11). */
  name: string;
  connected: boolean;
}

const SUBSCRIPTIONS: Subscription[] = [
  { id: 'github', name: 'GitHub', connected: true },
  { id: 'openai', name: 'OpenAI', connected: true },
  { id: 'anthropic', name: 'Anthropic', connected: true },
  { id: 'slack', name: 'Slack', connected: false },
];

export function SettingsScreen({ client, onBack, project }: SettingsScreenProps) {
  const dir = useDirection();
  const locale = useLocale();
  const { setLocale } = useLocaleControl();
  const { preference, setPreference } = useTheme();

  const [subscriptions, setSubscriptions] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SUBSCRIPTIONS.map((subscription) => [subscription.id, subscription.connected]))
  );
  // TODO(M20 wiring): eco mode lives in `warsha-pipeline`'s `EcoMode`; the daemon has no settings RPC for
  // it yet, so the switch reports intent and the battery/network readings are the caller's own.
  const [ecoEnabled, setEcoEnabled] = useState(false);
  const [onBattery] = useState(false);
  const [batteryPct] = useState(100);
  const [networkOk] = useState(true);
  const [intent, setIntent] = useState<string | null>(null);

  // Live connectors (Wave 2): when the daemon answers `integrations.list`, this ledger shows the real
  // integration statuses and its buttons write `integrations.connect/disconnect/test`. A client without
  // the method, or a daemon that does not answer, keeps the local ledger below (§7: the fallback is the
  // reading the owner still gets, not a broken screen).
  const [integrations, setIntegrations] = useState<IntegrationStatus[] | null>(null);
  const [connectFor, setConnectFor] = useState<string | null>(null);
  const [draft, setDraft] = useState({ token: '', webhookUrl: '', botToken: '' });
  const [working, setWorking] = useState(false);

  const label = useCallback((key: string, values?: Record<string, string | number>) => t(key, values ?? {}, locale), [locale]);

  useEffect(() => {
    if (typeof client.listIntegrations !== 'function') return;
    let cancelled = false;
    client
      .listIntegrations()
      .then((rows) => {
        if (!cancelled) setIntegrations(rows);
      })
      .catch(() => {
        if (!cancelled) setIntegrations(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const toggleSubscription = (subscription: Subscription) => {
    const next = !subscriptions[subscription.id];
    setSubscriptions((previous) => ({ ...previous, [subscription.id]: next }));
    // §7: a control that cannot write yet says so, in the same words, rather than pretending.
    setIntent(`${subscription.name} — ${label('common.local_only')}`);
  };

  const openConnect = (id: string) => {
    setConnectFor((current) => (current === id ? null : id));
    setDraft({ token: '', webhookUrl: '', botToken: '' });
  };

  const submitConnect = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (integrations === null || connectFor === null) return;
    const integration = integrations.find((row) => row.id === connectFor);
    if (integration === undefined) return;
    const config: IntegrationConfig =
      integration.id === 'slack'
        ? {
            ...(draft.webhookUrl.trim() === '' ? {} : { webhookUrl: draft.webhookUrl.trim() }),
            ...(draft.botToken.trim() === '' ? {} : { botToken: draft.botToken.trim() }),
          }
        : { token: draft.token };
    setWorking(true);
    try {
      const updated = await client.connectIntegration(integration.id, config);
      setIntegrations((previous) => (previous ?? []).map((row) => (row.id === updated.id ? updated : row)));
      setConnectFor(null);
      setIntent(label('connectors.connect_done', { name: integration.name }));
    } catch {
      setIntent(label('connectors.connect_failed'));
    } finally {
      // secrets ride the write once: the draft is cleared whether the daemon answered or not, and no
      // value the owner typed is ever rendered back (AGENTS.md).
      setDraft({ token: '', webhookUrl: '', botToken: '' });
      setWorking(false);
    }
  };

  const disconnectLive = async (integration: IntegrationStatus) => {
    setIntent(null);
    try {
      const updated = await client.disconnectIntegration(integration.id);
      setIntegrations((previous) => (previous ?? []).map((row) => (row.id === updated.id ? updated : row)));
      setIntent(`${integration.name} — ${label('common.disconnect')}`);
    } catch {
      setIntent(label('connectors.disconnect_failed'));
    }
  };

  const testLive = async (integration: IntegrationStatus) => {
    setIntent(null);
    try {
      const result = await client.testIntegration(integration.id);
      // the daemon's own status and message are machine data; only the sentence around them is catalog.
      setIntent(label('connectors.test_result', { status: result.status, message: result.message }));
    } catch {
      setIntent(label('connectors.test_failed'));
    }
  };

  return (
    <Box
      dir={dir}
      className="settings-screen"
      style={{
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-6)',
        maxInlineSize: '900px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-4)',
        minInlineSize: 0,
      }}
    >
      <header dir={dir} style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-3)', flexWrap: 'wrap' }}>
        {onBack && (
          <Button variant="ghost" size="sm" dir={dir} onClick={onBack}>
            {label('common.back')}
          </Button>
        )}
        <h1
          dir={dir}
          style={{
            margin: 0,
            fontSize: 'var(--warsha-font-size-xl)',
            fontWeight: 'var(--warsha-font-weight-bold)',
            color: 'var(--warsha-color-text)',
            minInlineSize: 0,
          }}
        >
          {label('nav.settings')}
        </h1>
      </header>

      {/* Settings scope sentence (t3code pattern): shows whether these settings apply globally or to a specific project */}
      <Box dir={dir} style={{ paddingInline: 'var(--warsha-space-4)', paddingBlock: 'var(--warsha-space-2)' }}>
        <SettingsScopeSentence project={project} dir={dir} />
      </Box>

      {/* ------------------------------------------------------------------ the preferences plate */}
      <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-4)' }}>
        <section
          dir={dir}
          aria-label={label('settings.preferences')}
          style={{
            backgroundColor: 'var(--warsha-color-surface)',
            border: '1px solid var(--warsha-bench-rule)',
            borderRadius: 'var(--warsha-radius-md)',
            minInlineSize: 0,
          }}
        >
          <h2
            dir={dir}
            style={{
              margin: 0,
              paddingInline: 'var(--warsha-space-4)',
              paddingBlock: 'var(--warsha-space-3)',
              borderBlockEnd: '1px solid var(--warsha-bench-rule)',
              fontSize: 'var(--warsha-font-size-sm)',
              fontWeight: 'var(--warsha-font-weight-semibold)',
              color: 'var(--warsha-color-text)',
            }}
          >
            {label('settings.preferences')}
          </h2>

          {/* One row per choice: the label leads, the control answers, the hint says what it costs. */}
          <PreferenceRow
            groupLabel={label('settings.language')}
            hint={label('settings.language_hint')}
            control={
              <Segmented
                label={label('settings.language')}
                size="sm"
                value={locale}
                // The guard is the cast: `Segmented` hands back a string, and only the two locales this
                // package accepts are ever written.
                onChange={(next) => {
                  if (isLocale(next)) setLocale(next);
                }}
                options={[
                  { value: 'ar', label: label('onboarding.lang_ar'), glyph: 'AR' },
                  { value: 'en', label: label('onboarding.lang_en'), glyph: 'EN' },
                ]}
              />
            }
          />

          <PreferenceRow
            groupLabel={label('theme.group')}
            hint={label('settings.theme_hint')}
            control={<ThemeToggle preference={preference} onChange={setPreference} />}
          />

          <PreferenceRow
            groupLabel={label('router.eco.title')}
            hint={label('router.eco.hint')}
            control={
              <EcoModeToggle
                enabled={ecoEnabled}
                onBattery={onBattery}
                batteryPct={batteryPct}
                networkOk={networkOk}
                onChange={setEcoEnabled}
              />
            }
          />
        </section>

        {/* --------------------------------------------------------------- the connectors ledger */}
        <Panel
          title={integrations === null ? label('settings.subscriptions') : label('connectors.title')}
          label={integrations === null ? label('settings.subscriptions') : label('connectors.title')}
          recessed
          style={{ border: '1px solid var(--warsha-bench-rule)', borderRadius: 'var(--warsha-radius-md)' }}
        >
          {integrations === null ? (
          <Ledger
            label={label('settings.subscriptions')}
            style={{ borderBlockStart: 'none' }}
          >
            {SUBSCRIPTIONS.map((subscription) => {
              const connected = subscriptions[subscription.id] === true;
              return (
                <Ledger.Row
                  key={subscription.id}
                  meta={
                    // The service names itself in its own letters, isolated LTR inside an Arabic line (§11).
                    <Chip label={subscription.name}>
                      <span dir="ltr" translate="no" style={{ fontFamily: 'var(--warsha-font-mono)' }}>
                        {subscription.name}
                      </span>
                    </Chip>
                  }
                  actions={
                    <Button
                      variant={connected ? 'ghost' : 'secondary'}
                      size="sm"
                      dir={dir}
                      onClick={() => toggleSubscription(subscription)}
                    >
                      {label(connected ? 'common.disconnect' : 'common.connect')}
                    </Button>
                  }
                >
                  {/* A lit lamp is the owner's queue: an unconnected subscription is theirs to connect (§1). */}
                  {connected ? (
                    <Lamp state="ok" size="sm">
                      {label('settings.subscription.connected')}
                    </Lamp>
                  ) : (
                    <Lamp state="waiting" size="sm">
                      {label('settings.subscription.disconnected')}
                    </Lamp>
                  )}
                </Ledger.Row>
              );
            })}
          </Ledger>
          ) : (
            <>
              {/* The description answers "what is this ledger?" — it is prose, not a row, so it sits
                  beside the list instead of inside it (axe `aria-required-children`: a `ul` may only
                  hold `li`), and an empty catalogue draws no list at all rather than an empty one. */}
              <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)', paddingInline: 'var(--warsha-space-4)', paddingBlockStart: 'var(--warsha-space-2)' }}>
                {label('connectors.desc')}
              </Text>
              {integrations.length > 0 && (
                <Ledger label={label('connectors.title')} style={{ borderBlockStart: 'none' }}>
                  {integrations.map((integration) => {
                    const formOpen = connectFor === integration.id;
                    const isSlack = integration.id === 'slack';
                    const canSubmit = isSlack
                      ? draft.webhookUrl.trim() !== '' || draft.botToken.trim() !== ''
                      : draft.token.trim() !== '';
                    return (
                      <Ledger.Row
                        key={integration.id}
                        meta={
                          // The service names itself in its own letters, isolated LTR inside an Arabic line (§11).
                          <Chip label={integration.name}>
                            <span dir="ltr" translate="no" style={{ fontFamily: 'var(--warsha-font-mono)' }}>
                              {integration.name}
                            </span>
                          </Chip>
                        }
                        actions={
                          integration.connected ? (
                            <Box dir={dir} style={{ display: 'inline-flex', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
                              <Button
                                variant="ghost"
                                size="sm"
                                dir={dir}
                                data-testid={`connector-test-${integration.id}`}
                                onClick={() => void testLive(integration)}
                              >
                                {label('connectors.test')}
                              </Button>
                              <Button variant="ghost" size="sm" dir={dir} onClick={() => void disconnectLive(integration)}>
                                {label('common.disconnect')}
                              </Button>
                            </Box>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              dir={dir}
                              aria-expanded={formOpen}
                              data-testid={`connector-connect-${integration.id}`}
                              onClick={() => openConnect(integration.id)}
                            >
                              {label('common.connect')}
                            </Button>
                          )
                        }
                      >
                        {/* A lit lamp is the owner's queue: an unconnected service is theirs to connect (§1). */}
                        {integration.connected ? (
                          <Lamp state="ok" size="sm">
                            {label('settings.subscription.connected')}
                          </Lamp>
                        ) : (
                          <Lamp state="waiting" size="sm">
                            {label('settings.subscription.disconnected')}
                          </Lamp>
                        )}

                        {formOpen && (
                          <form
                            onSubmit={submitConnect}
                            data-testid={`connector-form-${integration.id}`}
                            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)', marginBlockStart: 'var(--warsha-space-2)', minInlineSize: 0 }}
                          >
                            {!isSlack && (
                              <Field
                                id={`connector-token-${integration.id}`}
                                label={integration.id === 'github' ? label('connectors.github_token') : label('providers.api_key')}
                                hint={integration.id === 'github' ? label('connectors.github_token_hint') : undefined}
                                required
                              >
                                <input
                                  {...fieldControl(
                                    `connector-token-${integration.id}`,
                                    integration.id === 'github' ? { hint: true, required: true } : { required: true }
                                  )}
                                  dir="ltr"
                                  type="password"
                                  autoComplete="off"
                                  value={draft.token}
                                  onChange={(event) => setDraft({ ...draft, token: event.target.value })}
                                />
                              </Field>
                            )}

                            {isSlack && (
                              <>
                                <Field id={`connector-webhook-${integration.id}`} label={label('connectors.slack_webhook')} hint={label('connectors.slack_either')}>
                                  <input
                                    {...fieldControl(`connector-webhook-${integration.id}`, { hint: true })}
                                    dir="ltr"
                                    type="password"
                                    autoComplete="off"
                                    value={draft.webhookUrl}
                                    onChange={(event) => setDraft({ ...draft, webhookUrl: event.target.value })}
                                  />
                                </Field>
                                <Field id={`connector-bot-${integration.id}`} label={label('connectors.slack_bot')}>
                                  <input
                                    {...fieldControl(`connector-bot-${integration.id}`)}
                                    dir="ltr"
                                    type="password"
                                    autoComplete="off"
                                    value={draft.botToken}
                                    onChange={(event) => setDraft({ ...draft, botToken: event.target.value })}
                                  />
                                </Field>
                              </>
                            )}

                            <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
                              {label('connectors.secret_note')}
                            </Text>

                            <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              <Button type="button" variant="secondary" size="sm" dir={dir} onClick={() => openConnect(integration.id)}>
                                {label('common.cancel')}
                              </Button>
                              <Button type="submit" variant="primary" size="sm" dir={dir} disabled={working || !canSubmit}>
                                {label('connectors.connect_submit')}
                              </Button>
                            </Box>
                          </form>
                        )}
                      </Ledger.Row>
                    );
                  })}
                </Ledger>
              )}
            </>
          )}

          {intent && (
            // §7: the switch says what it did — an intent the daemon has not been told yet, in words.
            <p
              role="status"
              aria-live="polite"
              dir={dir}
              style={{
                margin: 0,
                marginBlockStart: 'var(--warsha-space-2)',
                fontSize: 'var(--warsha-font-size-xs)',
                color: 'var(--warsha-color-text)',
              }}
            >
              {intent}
            </p>
          )}
        </Panel>
      </Box>
    </Box>
  );
}

/**
 * One preference: its name, its control, and the line that says what the choice does.
 *
 * The row is a `<div>` with a `role="group"`-named control inside it, not a `<fieldset>`: the controls
 * here are already grouped by the component that renders them (`Segmented`, `ThemeToggle`), and a second
 * group around a single control would be announced twice (§9).
 */
function PreferenceRow({
  groupLabel,
  hint,
  control,
}: {
  groupLabel: string;
  hint: string;
  control: React.ReactNode;
}) {
  const dir = useDirection();

  return (
    <div
      dir={dir}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--warsha-space-4)',
        flexWrap: 'wrap',
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-3)',
        borderBlockEnd: '1px solid var(--warsha-bench-rule)',
        minInlineSize: 0,
      }}
    >
      <span
        dir={dir}
        style={{
          fontSize: 'var(--warsha-font-size-sm)',
          fontWeight: 'var(--warsha-font-weight-medium)',
          color: 'var(--warsha-color-text)',
          flex: '1 1 12rem',
          minInlineSize: 0,
        }}
      >
        {groupLabel}
        <span
          dir={dir}
          style={{
            display: 'block',
            fontSize: 'var(--warsha-font-size-xs)',
            color: 'var(--warsha-color-text-muted)',
            lineHeight: 'var(--warsha-line-height-relaxed)',
            fontWeight: 'var(--warsha-font-weight-normal)',
          }}
        >
          {hint}
        </span>
      </span>
      {/*
       * The control may shrink to the plate; the plate may never grow to the control.
       *
       * B4 §7 #6 found this box written as `flex: 'none'`, which sizes it to its content's one-line
       * width and refuses every shrink. In Arabic the eco row's one line — the switch's own words plus
       * the mono battery/network reading — measures ~404px, wider than the 390px phone plate, so the
       * whole settings panel sat 14px outside the viewport with its focus ring cut at the screen edge
       * (`.bench { overflow: hidden }` hid the evidence from the overflow gate, not from the owner).
       * The controls here already know how to give way — `Segmented` and `EcoModeToggle` both wrap — and
       * this was the one constraint that never let them. Same rule B4 applied to `FIELD` and the rails.
       */}
      <span style={{ flex: '0 1 auto', minInlineSize: 0 }}>{control}</span>
    </div>
  );
}
