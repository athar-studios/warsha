// The settings entry point on the phone, rebuilt on @warsha/ui/v3 per DESIGN_SYSTEM_V3.md.
import { t, useDirection, useLocale, useLocaleControl, type Locale } from '@warsha/i18n';
import {
  Banner,
  Button,
  Card,
  KeyValue,
  ListRow,
  Skeleton,
  StatusPill,
} from '@warsha/ui/v3';
import React, { useCallback, useRef, useState } from 'react';

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
  const tablistRef = useRef<HTMLDivElement>(null);

  const tabKey = (name: SettingsTab): string =>
    name === 'preferences' ? 'settings.preferences' : name === 'session' ? 'remote.session_title' : 'remote.settings.tab_about';

  const panelId = `settings-panel-${tab}`;

  const endSession = useCallback(() => {
    unpair();
    setConfirming(false);
    setEnded(true);
  }, [unpair]);

  const themeHint = (choice: ThemePreference): string => t(`theme.hint.${choice}`, {}, locale);

  const handleTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    const nextKey = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const prevKey = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    let targetIndex: number | null = null;
    if (event.key === nextKey) {
      targetIndex = (index + 1) % SETTINGS_TABS.length;
    } else if (event.key === prevKey) {
      targetIndex = (index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    } else if (event.key === 'Home') {
      targetIndex = 0;
    } else if (event.key === 'End') {
      targetIndex = SETTINGS_TABS.length - 1;
    }
    if (targetIndex !== null) {
      event.preventDefault();
      const buttons = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      buttons?.[targetIndex]?.focus();
    }
  };

  return (
    <div dir={dir} className="remote-screen" data-testid="remote-screen-settings">
      <div dir={dir} className="remote-title">
        <ScreenTitle>{t('nav.settings', {}, locale)}</ScreenTitle>
        <p style={{ margin: 0, color: 'var(--w-text-muted)', fontSize: 'var(--w-font-size-xs)' }}>
          {t('remote.settings_intro', {}, locale)}
        </p>
      </div>

      <div
        ref={tablistRef}
        role="tablist"
        aria-label={t('settings.tabs', {}, locale)}
        dir={dir}
        className="remote-tabs"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--w-space-2)',
          overflowX: 'auto',
          padding: 'var(--w-space-1)',
          backgroundColor: 'var(--w-sunken)',
        }}
      >
        {SETTINGS_TABS.map((name, index) => {
          const selected = tab === name;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              id={`settings-tab-${name}`}
              aria-selected={selected}
              aria-controls={`settings-panel-${name}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(name)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className="warsha-control"
              style={{
                flex: '0 0 auto',
                minBlockSize: 'var(--w-control-height)',
                paddingInline: 'var(--w-space-3)',
                paddingBlock: 'var(--w-space-2)',
                border: 'none',
                borderRadius: 'var(--w-radius-sm)',
                backgroundColor: selected ? 'var(--w-surface)' : 'transparent',
                color: selected ? 'var(--w-text)' : 'var(--w-text-muted)',
                fontFamily: 'var(--w-font-sans)',
                fontSize: 'var(--w-font-size-sm)',
                fontWeight: selected ? 'var(--w-font-weight-semibold)' : 'var(--w-font-weight-medium)',
                boxShadow: selected ? 'var(--w-shadow-1)' : 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t(tabKey(name), {}, locale)}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`settings-tab-${tab}`}
        tabIndex={0}
        dir={dir}
        className="remote-panel-body"
      >
        {ended && session === null && (
          <span role="status" aria-live="polite" data-testid="remote-session-ended">
            {t('remote.session_ended', {}, locale)}
          </span>
        )}

        {tab === 'preferences' && (
          <Card title={t('settings.preferences', {}, locale)}>
            <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-4)' }}>
              <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-2)' }}>
                <span style={{ fontSize: 'var(--w-font-size-sm)', color: 'var(--w-text)' }}>
                  {t('settings.language', {}, locale)}
                </span>
                <div
                  role="group"
                  aria-label={t('settings.language', {}, locale)}
                  dir={dir}
                  style={{
                    display: 'inline-flex',
                    flexWrap: 'wrap',
                    gap: 'var(--w-space-1)',
                    padding: 'var(--w-space-1)',
                    backgroundColor: 'var(--w-sunken)',
                    borderRadius: 'var(--w-radius-sm)',
                    justifySelf: 'start',
                  }}
                >
                  {LOCALES.map((value) => {
                    const pressed = locale === value;
                    return (
                      <Button
                        key={value}
                        type="button"
                        variant={pressed ? 'secondary' : 'ghost'}
                        size="sm"
                        dir={dir}
                        aria-pressed={pressed}
                        onClick={() => setLocale(value === 'en' ? 'en' : 'ar')}
                        style={{
                          border: 'none',
                          backgroundColor: pressed ? 'var(--w-surface)' : 'transparent',
                          boxShadow: pressed ? 'var(--w-shadow-1)' : 'none',
                        }}
                      >
                        {t(value === 'ar' ? 'onboarding.lang_ar' : 'onboarding.lang_en', {}, locale)}
                      </Button>
                    );
                  })}
                </div>
                <span style={{ fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}>
                  {t('settings.language_hint', {}, locale)}
                </span>
              </div>

              <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-2)' }}>
                <span style={{ fontSize: 'var(--w-font-size-sm)', color: 'var(--w-text)' }}>
                  {t('theme.group', {}, locale)}
                </span>
                <div
                  role="group"
                  aria-label={t('theme.group', {}, locale)}
                  dir={dir}
                  style={{
                    display: 'inline-flex',
                    flexWrap: 'wrap',
                    gap: 'var(--w-space-1)',
                    padding: 'var(--w-space-1)',
                    backgroundColor: 'var(--w-sunken)',
                    borderRadius: 'var(--w-radius-sm)',
                    justifySelf: 'start',
                  }}
                >
                  {THEME_PREFERENCES.map((value) => {
                    const pressed = preference === value;
                    return (
                      <Button
                        key={value}
                        type="button"
                        variant={pressed ? 'secondary' : 'ghost'}
                        size="sm"
                        dir={dir}
                        aria-pressed={pressed}
                        onClick={() => setPreference(value === 'light' || value === 'dark' ? value : 'system')}
                        style={{
                          border: 'none',
                          backgroundColor: pressed ? 'var(--w-surface)' : 'transparent',
                          boxShadow: pressed ? 'var(--w-shadow-1)' : 'none',
                        }}
                      >
                        {t(`theme.${value}`, {}, locale)}
                      </Button>
                    );
                  })}
                </div>
                <span style={{ fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}>
                  {themeHint(preference)}
                </span>
              </div>

              <div style={{ display: 'grid' }}>
                <KeyValue
                  label={t('settings.current_locale', { locale }, locale)}
                  value={<Machine>{locale}</Machine>}
                />
                <KeyValue
                  label={`${t('remote.settings_device', {}, locale)} · ${t('theme.group', {}, locale)}`}
                  value={<Machine>{preference}</Machine>}
                />
              </div>
            </div>
          </Card>
        )}

        {tab === 'session' &&
          (session === null ? (
            <PairingPlate title={t('remote.session_title', {}, locale)} />
          ) : (
            <>
              <Card title={t('remote.session_title', {}, locale)}>
                <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-3)' }}>
                  <div
                    dir={dir}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--w-space-2)',
                      flexWrap: 'wrap',
                      minInlineSize: 0,
                    }}
                  >
                    <StatusPill
                      status={
                        connection === 'online'
                          ? 'done'
                          : connection === 'offline'
                            ? 'failed'
                            : 'running'
                      }
                      label={
                        connection === 'online'
                          ? t('bench.daemon_online', {}, locale)
                          : connection === 'offline'
                            ? t('bench.daemon_offline', {}, locale)
                            : t('remote.daemon_checking', {}, locale)
                      }
                    />
                    <span style={{ fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}>
                      {t('remote.session_paired', {}, locale)}
                    </span>
                  </div>

                  <div style={{ display: 'grid' }}>
                    <KeyValue
                      label={t('remote.session_endpoint', {}, locale)}
                      value={<Machine title={session.baseUrl}>{session.baseUrl}</Machine>}
                    />
                    <KeyValue
                      label={t('remote.daemon_version', {}, locale)}
                      value={
                        daemonVersion === null ? (
                          <Machine>{t('bench.not_reported', {}, locale)}</Machine>
                        ) : (
                          <Machine title={daemonVersion}>{daemonVersion}</Machine>
                        )
                      }
                    />
                  </div>

                  <p style={{ margin: 0, fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}>
                    {t('remote.session_token_note', {}, locale)}
                  </p>

                  <div dir={dir} data-testid="remote-no-llm-keys-notice">
                    <p style={{ margin: 0, fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}>
                      {t('remote.no_llm_keys', {}, locale)}
                    </p>
                  </div>

                  <div dir={dir} style={{ display: 'flex', gap: 'var(--w-space-2)', flexWrap: 'wrap', rowGap: 'var(--w-space-2)' }}>
                    <Button variant="secondary" dir={dir} onClick={reloadAll} data-testid="remote-session-reconnect">
                      {t('simple.stream_retry', {}, locale)}
                    </Button>

                    <Button
                      variant={confirming ? 'danger' : 'ghost'}
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
                          color: 'var(--w-text)',
                          fontSize: 'var(--w-font-size-xs)',
                          minInlineSize: 0,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {`${t('remote.session_end_hint', {}, locale)} ${t('common.escape_hint', {}, locale)}`}
                      </span>
                    )}
                  </div>
                </div>
              </Card>

              {(devicesState !== 'idle' || devices.length > 0) && (
                <Card title={t('devices.title', {}, locale)}>
                  <div dir={dir} data-testid="remote-devices-list">
                    {devicesState === 'loading' ? (
                      <Skeleton variant="rectangular" />
                    ) : devices.length === 0 ? (
                      <p style={{ margin: 0, color: 'var(--w-text)', fontSize: 'var(--w-font-size-sm)' }}>
                        {t('devices.no_devices', {}, locale)}
                      </p>
                    ) : (
                      <div style={{ display: 'grid' }}>
                        {devices.map((device) => (
                          <ListRow
                            key={device.id}
                            title={device.name}
                            meta={<Machine title={device.id}>{shortId(device.id, 10)}</Machine>}
                            actions={
                              !device.isCurrent && revokePairedDevice !== null ? (
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
                              ) : undefined
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </>
          ))}

        {tab === 'about' && (
          <Card title={t('remote.about_title', {}, locale)}>
            <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-3)' }}>
              <p
                dir={dir}
                style={{
                  margin: 0,
                  color: 'var(--w-text)',
                  fontSize: 'var(--w-font-size-md)',
                  lineHeight: 'var(--w-line-height-md)',
                }}
              >
                {t('remote.about_desc', {}, locale)}
              </p>

              <div dir={dir} data-testid="remote-no-llm-keys-notice">
                <p style={{ margin: 0, color: 'var(--w-text)', fontSize: 'var(--w-font-size-sm)' }}>
                  {t('remote.no_llm_keys', {}, locale)}
                </p>
              </div>

              <div dir={dir} className="remote-copy">
                <p style={{ margin: 0, color: 'var(--w-text)', fontSize: 'var(--w-font-size-sm)' }}>
                  {`${t('app.name', {}, locale)} — ${t('app.tagline', {}, locale)}`}
                </p>
              </div>

              {connection === 'offline' && <Banner variant="attention">{t('bench.daemon_unreachable', {}, locale)}</Banner>}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
