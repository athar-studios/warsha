// The settings entry point on the phone (docs/design/REDESIGN.md §4's tab strip, §5's `settings` plate).
//
// §5 gives the desktop six settings screens behind one horizontally scrollable `role="tablist"`. The
// phone owns three of them — what this device looks like, what session it holds, and what this app is —
// and says so rather than pretending to be the desktop (`remote.settings_intro`). The strip is the same
// `Tabs` compound with the same roving tabindex (§9): one tab in the Tab order, the arrows moving between
// the rest, manual activation so a tab that would fetch something is only fetched when the owner presses
// it.
//
// Two of §7's states live here for real: the **permission** state (no session → the pairing plate, with
// the token's promise written out) and the **success** state (a healthy daemon reading: lamp, word, and
// the mono version beside it — no confetti, no modal).
import { t, useDirection, useLocale, useLocaleControl, type Locale } from '@warsha/i18n';
import {
  Banner,
  Box,
  Button,
  Lamp,
  Ledger,
  Panel,
  Segmented,
  Skeleton,
  Tabs,
  Text,
  colorVar,
  fontSize,
  fontWeight,
  space,
  tabPanelProps,
} from '@warsha/ui';
import React, { useCallback, useState } from 'react';

import { useRemote } from '../bench';
import { Machine, ScreenTitle } from '../chrome';
import { shortId } from '../format';
import { PairingPlate } from '../pairing';
import {
  THEME_PREFERENCES,
  useTheme,
  type ThemePreference,
} from '../theme';

/** The three screens the phone answers for. */
const SETTINGS_TABS = ['preferences', 'session', 'about'] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

const LOCALES: readonly Locale[] = ['ar', 'en'];

export function SettingsScreen() {
  const dir = useDirection();
  const locale = useLocale();
  const { setLocale } = useLocaleControl();
  const { preference, setPreference } = useTheme();
  const {
    session,
    connection,
    daemonVersion,
    unpair,
    reloadAll,
    devices,
    devicesState,
    revokePairedDevice,
  } = useRemote();

  const [tab, setTab] = useState<SettingsTab>('preferences');
  const [confirming, setConfirming] = useState(false);
  const [ended, setEnded] = useState(false);

  const tabKey = (name: SettingsTab): string =>
    name === 'preferences' ? 'settings.preferences' : name === 'session' ? 'remote.session_title' : 'remote.settings.tab_about';

  const panelId = `settings-panel-${tab}`;

  const endSession = useCallback(() => {
    unpair();
    setConfirming(false);
    setEnded(true);
  }, [unpair]);

  const themeHint = (choice: ThemePreference): string => t(`theme.hint.${choice}`, {}, locale);

  return (
    <div dir={dir} className="remote-screen" data-testid="remote-screen-settings">
      <Box dir={dir} className="remote-title">
        <ScreenTitle>{t('nav.settings', {}, locale)}</ScreenTitle>
        <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs') }}>
          {t('remote.settings_intro', {}, locale)}
        </Text>
      </Box>

      <Tabs label={t('settings.tabs', {}, locale)} className="remote-tabs">
        {SETTINGS_TABS.map((name) => (
          <Tabs.Tab
            key={name}
            selected={tab === name}
            onSelect={() => setTab(name)}
            panelId={`settings-panel-${name}`}
          >
            {t(tabKey(name), {}, locale)}
          </Tabs.Tab>
        ))}
      </Tabs>

      <div {...tabPanelProps(panelId)} dir={dir} className="remote-panel-body">
        {ended && session === null && (
          <span role="status" aria-live="polite" data-testid="remote-session-ended">
            {t('remote.session_ended', {}, locale)}
          </span>
        )}

        {tab === 'preferences' && (
          <Panel title={t('settings.preferences', {}, locale)} label={t('settings.preferences', {}, locale)}>
            <Box dir={dir} style={{ display: 'grid', gap: space(4) }}>
              <Box dir={dir} style={{ display: 'grid', gap: space(2) }}>
                <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                  {t('settings.language', {}, locale)}
                </Text>
                <Segmented
                  label={t('settings.language', {}, locale)}
                  size="sm"
                  value={locale}
                  onChange={(next) => setLocale(next === 'en' ? 'en' : 'ar')}
                  options={LOCALES.map((value) => ({
                    value,
                    label: t(value === 'ar' ? 'onboarding.lang_ar' : 'onboarding.lang_en', {}, locale),
                    glyph: value === 'ar' ? 'AR' : 'EN',
                  }))}
                />
                <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs') }}>
                  {t('settings.language_hint', {}, locale)}
                </Text>
              </Box>

              <Box dir={dir} style={{ display: 'grid', gap: space(2) }}>
                <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                  {t('theme.group', {}, locale)}
                </Text>
                <Segmented
                  label={t('theme.group', {}, locale)}
                  size="sm"
                  value={preference}
                  onChange={(next) =>
                    setPreference(next === 'light' || next === 'dark' ? next : 'system')
                  }
                  options={THEME_PREFERENCES.map((value) => ({
                    value,
                    label: t(`theme.${value}`, {}, locale),
                    glyph: value === 'light' ? '☀' : value === 'dark' ? '☾' : '◐',
                  }))}
                />
                {/* The hint is the chosen one's own sentence, so the plate explains the state it shows (§7). */}
                <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs') }}>
                  {themeHint(preference)}
                </Text>
              </Box>

              <Ledger label={t('settings.preferences', {}, locale)}>
                <Ledger.Row meta={<Machine>{locale}</Machine>}>
                  <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                    {t('settings.current_locale', { locale }, locale)}
                  </Text>
                </Ledger.Row>
                <Ledger.Row meta={<Machine>{preference}</Machine>}>
                  <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                    {`${t('remote.settings_device', {}, locale)} · ${t('theme.group', {}, locale)}`}
                  </Text>
                </Ledger.Row>
              </Ledger>
            </Box>
          </Panel>
        )}

        {tab === 'session' &&
          (session === null ? (
            <PairingPlate title={t('remote.session_title', {}, locale)} />
          ) : (
            <>
              <Panel title={t('remote.session_title', {}, locale)} label={t('remote.session_title', {}, locale)}>
                <Box dir={dir} style={{ display: 'grid', gap: space(3) }}>
                  <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: space(2), flexWrap: 'wrap', minInlineSize: 0 }}>
                    <Lamp state={connection === 'online' ? 'ok' : connection === 'offline' ? 'fail' : 'working'} size="sm">
                      {connection === 'online'
                        ? t('bench.daemon_online', {}, locale)
                        : connection === 'offline'
                          ? t('bench.daemon_offline', {}, locale)
                          : t('remote.daemon_checking', {}, locale)}
                    </Lamp>
                    <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs') }}>
                      {t('remote.session_paired', {}, locale)}
                    </Text>
                  </Box>

                  <Ledger label={t('remote.session_title', {}, locale)}>
                    <Ledger.Row meta={<Machine title={session.baseUrl}>{session.baseUrl}</Machine>}>
                      <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                        {t('remote.session_endpoint', {}, locale)}
                      </Text>
                    </Ledger.Row>
                    <Ledger.Row
                      meta={
                        daemonVersion === null ? (
                          <Machine>{t('bench.not_reported', {}, locale)}</Machine>
                        ) : (
                          <Machine title={daemonVersion}>{daemonVersion}</Machine>
                        )
                      }
                    >
                      <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                        {t('remote.daemon_version', {}, locale)}
                      </Text>
                    </Ledger.Row>
                  </Ledger>

                  <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs') }}>
                    {t('remote.session_token_note', {}, locale)}
                  </Text>

                  {/* The companion's one boundary, said where the owner looks for settings: this phone
                      holds a session, never model keys — there is no key field on any remote screen. */}
                  <div dir={dir} data-testid="remote-no-llm-keys-notice">
                    <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs') }}>
                      {t('remote.no_llm_keys', {}, locale)}
                    </Text>
                  </div>

                  <Box dir={dir} style={{ display: 'flex', gap: space(2), flexWrap: 'wrap', rowGap: space(2) }}>
                    <Button variant="secondary" dir={dir} onClick={reloadAll} data-testid="remote-session-reconnect">
                      {t('simple.stream_retry', {}, locale)}
                    </Button>

                    {/**
                     * Ending a session is destructive, so it is one button that has to be pressed twice —
                     * and the second press keeps the owner's focus exactly where it already is (§9: no
                     * `window.confirm`, which leaves the keyboard outside the app). Escape steps back.
                     */}
                    <Button
                      variant={confirming ? 'primary' : 'ghost'}
                      dir={dir}
                      aria-describedby={confirming ? 'remote-session-end-hint' : undefined}
                      data-testid="remote-session-end"
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' && confirming) {
                          event.preventDefault();
                          setConfirming(false);
                        }
                      }}
                      onClick={() => {
                        if (confirming) {
                          endSession();
                          return;
                        }
                        setConfirming(true);
                      }}
                    >
                      {t(confirming ? 'remote.session_end_confirm' : 'remote.session_end', {}, locale)}
                    </Button>

                    {confirming && (
                      <span
                        id="remote-session-end-hint"
                        style={{
                          color: colorVar('text'),
                          fontSize: fontSize('xs'),
                          minInlineSize: 0,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {`${t('remote.session_end_hint', {}, locale)} ${t('common.escape_hint', {}, locale)}`}
                      </span>
                    )}
                  </Box>
                </Box>
              </Panel>

              {/* The devices paired to this daemon, read from `devices.list` — capability-gated: a
                  daemon that does not answer the name leaves `devicesState` at `idle` and this plate
                  unrendered, rather than an empty list claiming nothing is paired (§7). */}
              {(devicesState !== 'idle' || devices.length > 0) && (
                <Panel title={t('devices.title', {}, locale)} label={t('devices.title', {}, locale)}>
                  <div dir={dir} data-testid="remote-devices-list">
                    {devicesState === 'loading' ? (
                      <Skeleton label={t('devices.loading', {}, locale)} variant="row" lines={2} />
                    ) : devices.length === 0 ? (
                      <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                        {t('devices.no_devices', {}, locale)}
                      </Text>
                    ) : (
                      <Ledger label={t('devices.title', {}, locale)}>
                        {devices.map((device) => (
                          <Ledger.Row key={device.id} meta={<Machine title={device.id}>{shortId(device.id, 10)}</Machine>}>
                            <Box dir={dir} style={{ display: 'grid', gap: space(1), minInlineSize: 0 }}>
                              <Text size="sm" dir={dir} style={{ color: colorVar('text'), fontWeight: fontWeight('bold') }}>
                                {device.name}
                              </Text>
                              {/* The row's own device ends its session from the session plate's
                                  two-press button, not from here — no control to revoke yourself. */}
                              {!device.isCurrent && revokePairedDevice !== null && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  dir={dir}
                                  data-testid={`remote-device-revoke-${device.id}`}
                                  onClick={() => {
                                    void revokePairedDevice(device.id);
                                  }}
                                >
                                  {t('settings.devices_revoke', {}, locale)}
                                </Button>
                              )}
                            </Box>
                          </Ledger.Row>
                        ))}
                      </Ledger>
                    )}
                  </div>
                </Panel>
              )}
            </>
          ))}

        {tab === 'about' && (
          <Panel title={t('remote.about_title', {}, locale)} label={t('remote.about_title', {}, locale)} prose>
            <Box dir={dir} style={{ display: 'grid', gap: space(3) }}>
              <Text size="md" dir={dir} style={{ color: colorVar('text'), lineHeight: 'var(--warsha-line-height-relaxed)' }}>
                {t('remote.about_desc', {}, locale)}
              </Text>

              {/* The same boundary on the about plate: what this app is includes what it never holds. */}
              <div dir={dir} data-testid="remote-no-llm-keys-notice">
                <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                  {t('remote.no_llm_keys', {}, locale)}
                </Text>
              </div>

              <Box dir={dir} className="remote-copy">
                <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
                  {`${t('app.name', {}, locale)} — ${t('app.tagline', {}, locale)}`}
                </Text>
              </Box>

              {connection === 'offline' && <Banner tone="offline">{t('bench.daemon_unreachable', {}, locale)}</Banner>}
            </Box>
          </Panel>
        )}
      </div>
    </div>
  );
}
