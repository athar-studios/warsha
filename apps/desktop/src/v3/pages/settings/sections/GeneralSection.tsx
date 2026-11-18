// apps/desktop/src/v3/pages/settings/sections/GeneralSection.tsx
import { invoke } from '@tauri-apps/api/core';
/* eslint-disable import/no-unresolved */
import { type Locale, useLocale, useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  ListRow,
  SettingsSection,
  Skeleton,
  TextField,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';
import { type AppMode, useDensity } from '../../../app/DensityContext';
import { type ThemeMode, useTheme } from '../../../app/ThemeContext';
import { readSoundCuesEnabled, writeSoundCuesEnabled } from '../../../app/soundCues';
import { detectModelContext } from '../../../webmcp/modelContext';
import { readWebMcpEnabled, subscribeWebMcpEnabled, writeWebMcpEnabled } from '../../../webmcp/setting';

const DEFAULT_BUDGET_STORAGE_KEY = 'warsha.default_budget_usd';

function readStoredBudgetFallback(): string {
  if (typeof window === 'undefined') return '10';
  try {
    const val = window.localStorage.getItem(DEFAULT_BUDGET_STORAGE_KEY);
    if (val && Number.isFinite(Number(val)) && Number(val) > 0) {
      return val;
    }
  } catch {
    // Ignore storage access errors
  }
  return '10';
}

export function GeneralSection(): React.ReactElement {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();
  const { mode, setMode } = useDensity();
  const client = useClient();
  const { setReady } = useDataReady();

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState<string>(() => readStoredBudgetFallback());
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetSaved, setBudgetSaved] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  // R-UI-3 D2-c: device-scoped localStorage, exactly like the theme and the mode. It is not written to the
  // preferences RPC, which stores decaying taste signals — a boolean there would silently decay to off (W11).
  const [soundCuesEnabled, setSoundCuesEnabled] = useState<boolean>(() => readSoundCuesEnabled());
  const soundCuesLabelId = React.useId();
  // X9a (R-EXT-5): the browser-assistant switch. Same device-scoped storage shape as the cue switch — `'on'` or
  // absent, no preferences write — and the same in-tab subscription, so the row follows its own click.
  const [webMcpEnabled, setWebMcpEnabled] = useState<boolean>(() => readWebMcpEnabled());
  const webMcpLabelId = React.useId();

  useEffect(() => subscribeWebMcpEnabled(setWebMcpEnabled), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setReady(false);
    setLoadFailed(false);
    setLoadError(null);

    if (!client) {
      setLoading(false);
      setReady(true);
      return;
    }

    client
      .listPreferences('global')
      .then((prefs) => {
        if (!active) return;
        const found = prefs.find((p) => p.key === 'default_budget_usd');
        if (found && Number.isFinite(found.score) && found.score > 0) {
          setBudgetInput(String(found.score));
        }
        setLoading(false);
        setReady(true);
      })
      .catch((err) => {
        if (!active) return;
        setLoadFailed(true);
        setLoadError(err instanceof Error ? err.message : null);
        setLoading(false);
        setReady(true);
      });

    return () => {
      active = false;
    };
  }, [client, reloadNonce, setReady]);

  const saveBudgetAction = useAction('settings.budget-default.save', async () => {
    const parsed = Number(budgetInput.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setBudgetError(t('settings.general.budget.invalid'));
      return;
    }
    setBudgetError(null);
    setBudgetSaved(false);

    if (client) {
      await client.recordPreference({
        id: `budget-default-${Date.now()}`,
        projectId: 'global',
        ownerId: 'owner',
        kind: 'edit',
        target: 'default_budget_usd',
        weight: parsed,
        recordedAt: Math.floor(Date.now() / 1000),
      });
    }

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(DEFAULT_BUDGET_STORAGE_KEY, String(parsed));
      } catch {
        // Ignore storage errors
      }
    }
    setBudgetSaved(true);
  });

  const handleLanguageChange = (nextLocale: Locale): void => {
    setLocale(nextLocale);
  };

  const handleThemeChange = (nextTheme: ThemeMode): void => {
    setTheme(nextTheme);
  };

  const handleSoundCuesChange = (nextEnabled: boolean): void => {
    setSoundCuesEnabled(nextEnabled);
    writeSoundCuesEnabled(nextEnabled);
  };

  const handleWebMcpChange = (nextEnabled: boolean): void => {
    setWebMcpEnabled(nextEnabled);
    writeWebMcpEnabled(nextEnabled);
  };

  const handleModeChange = (nextMode: AppMode): void => {
    setMode(nextMode);
    invoke('set_config', { key: 'app_mode', value: nextMode }).catch(() => {
      // Non-Tauri environments ignore set_config failures
    });
  };

  if (loading) {
    return (
      <SettingsSection
        title={t('settings.section.general')}
        description={t('settings.section.general.desc')}
        scope={<span className="v3-settings-scope">{t('settings.scope.device')}</span>}
      >
        <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title={t('settings.section.general')}
      description={t('settings.section.general.desc')}
      scope={<span className="v3-settings-scope">{t('settings.scope.device')}</span>}
      data-testid="settings-section-general"
    >
      {loadFailed && (
        <div style={{ padding: 'var(--w-space-4)' }}>
          <Banner variant="danger">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--w-space-3)', flexWrap: 'wrap' }}>
              <span>{loadError ?? t('common.error')}</span>
              <Button
                size="sm"
                variant="secondary"
                data-action="settings.error.retry"
                onClick={() => setReloadNonce((n) => n + 1)}
              >
                {t('common.retry')}
              </Button>
            </div>
          </Banner>
        </div>
      )}

      {budgetSaved && (
        <div style={{ padding: 'var(--w-space-4)', paddingBlockEnd: 0 }}>
          <Banner variant="success">{t('settings.general.budget.saved')}</Banner>
        </div>
      )}

      <ListRow
        title={t('settings.general.language')}
        actions={
          <div
            role="radiogroup"
            aria-label={t('settings.general.language')}
            className="v3-settings-segmented-group"
          >
            <button
              type="button"
              role="radio"
              aria-checked={locale === 'ar'}
              data-action="settings.language.set"
              data-value="ar"
              className="v3-settings-segmented-item"
              onClick={() => handleLanguageChange('ar')}
            >
              {t('settings.general.language.ar')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={locale === 'en'}
              data-action="settings.language.set"
              data-value="en"
              className="v3-settings-segmented-item"
              onClick={() => handleLanguageChange('en')}
            >
              {t('settings.general.language.en')}
            </button>
          </div>
        }
      />

      <ListRow
        title={t('settings.general.theme')}
        actions={
          <div
            role="radiogroup"
            aria-label={t('settings.general.theme')}
            className="v3-settings-segmented-group"
          >
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'light'}
              data-action="settings.theme.set"
              data-value="light"
              className="v3-settings-segmented-item"
              onClick={() => handleThemeChange('light')}
            >
              {t('settings.general.theme.light')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'dark'}
              data-action="settings.theme.set"
              data-value="dark"
              className="v3-settings-segmented-item"
              onClick={() => handleThemeChange('dark')}
            >
              {t('settings.general.theme.dark')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'system'}
              data-action="settings.theme.set"
              data-value="system"
              className="v3-settings-segmented-item"
              onClick={() => handleThemeChange('system')}
            >
              {t('settings.general.theme.system')}
            </button>
          </div>
        }
      />

      <ListRow
        title={t('settings.general.mode')}
        actions={
          <div
            role="radiogroup"
            aria-label={t('settings.general.mode')}
            className="v3-settings-segmented-group"
          >
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'simple'}
              data-action="settings.mode-default.set"
              data-value="simple"
              className="v3-settings-segmented-item"
              onClick={() => handleModeChange('simple')}
            >
              {t('settings.general.mode.simple')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'factory'}
              data-action="settings.mode-default.set"
              data-value="factory"
              className="v3-settings-segmented-item"
              onClick={() => handleModeChange('factory')}
            >
              {t('settings.general.mode.factory')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'developers'}
              data-action="settings.mode-default.set"
              data-value="advanced"
              className="v3-settings-segmented-item"
              onClick={() => handleModeChange('developers')}
            >
              {t('settings.general.mode.advanced')}
            </button>
          </div>
        }
      />

      {/* R-UI-3 D2-b/D2-d: one switch, off by default. The cue never replaces a signal: the Frame inbox badge
          and the run status chip stay exactly as they are. It is a hand-rolled `role="switch"` button for the same
          reason the two radiogroups above are hand-rolled: the action gate (A1/A4) reads the literal `data-action`
          off the interactive element, and the v3 `Switch` keeps its own button inside the composite. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--w-space-3)',
          paddingBlock: 'var(--w-space-3)',
          paddingInline: 'var(--w-space-4)',
          borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
        }}
      >
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-1)', minWidth: 0 }}
        >
          <span
            id={soundCuesLabelId}
            style={{
              fontSize: 'var(--w-font-size-md)',
              lineHeight: 'var(--w-line-height-md)',
              color: 'var(--w-text)',
            }}
          >
            {t('settings.general.sound')}
          </span>
          <span style={{ fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}>
            {t('settings.general.sound.desc')}
          </span>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={soundCuesEnabled}
          aria-labelledby={soundCuesLabelId}
          data-action="settings.sound-cues.set"
          data-testid="general-sound-cues"
          onClick={() => handleSoundCuesChange(!soundCuesEnabled)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
            inlineSize: 'var(--w-space-9)',
            blockSize: 'var(--w-space-6)',
            padding: 'var(--w-space-1)',
            borderRadius: 'var(--w-radius-full)',
            border: 'var(--w-border-width) solid var(--w-line-strong)',
            backgroundColor: soundCuesEnabled ? 'var(--w-primary)' : 'var(--w-sunken)',
            cursor: 'pointer',
            boxSizing: 'border-box',
            transition: 'background-color var(--w-dur-fast) var(--w-ease)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: soundCuesEnabled ? 'flex-end' : 'flex-start',
              inlineSize: '100%',
              blockSize: '100%',
            }}
          >
            <span
              style={{
                display: 'block',
                inlineSize: 'var(--w-space-4)',
                blockSize: 'var(--w-space-4)',
                borderRadius: 'var(--w-radius-full)',
                backgroundColor: soundCuesEnabled ? 'var(--w-on-primary)' : 'var(--w-text-muted)',
              }}
            />
          </span>
        </button>
      </div>

      {/* X9a (R-EXT-5): the browser-assistant switch. Same hand-rolled `role="switch"` pattern as the cue switch
          above, and the same reason for it: the action gate reads the literal `data-action` off the interactive
          element. Shown in advanced mode *or* whenever it is on — a live switch is never hidden — and it reports
          the one runtime fact the owner cannot see: whether this window has a browser assistant at all. */}
      {(mode === 'developers' || webMcpEnabled) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--w-space-3)',
            paddingBlock: 'var(--w-space-3)',
            paddingInline: 'var(--w-space-4)',
            borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
          }}
        >
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-1)', minWidth: 0 }}
          >
            <span
              id={webMcpLabelId}
              style={{
                fontSize: 'var(--w-font-size-md)',
                lineHeight: 'var(--w-line-height-md)',
                color: 'var(--w-text)',
              }}
            >
              {t('settings.general.webmcp')}
            </span>
            <span style={{ fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}>
              {t('settings.general.webmcp.desc')}
            </span>
            {webMcpEnabled && detectModelContext() === null && (
              <span
                data-testid="general-webmcp-unavailable"
                style={{ fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}
              >
                {t('settings.general.webmcp.unavailable')}
              </span>
            )}
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={webMcpEnabled}
            aria-labelledby={webMcpLabelId}
            data-action="settings.webmcp.set"
            data-testid="general-webmcp"
            onClick={() => {
              handleWebMcpChange(!webMcpEnabled);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              flexShrink: 0,
              inlineSize: 'var(--w-space-9)',
              blockSize: 'var(--w-space-6)',
              padding: 'var(--w-space-1)',
              borderRadius: 'var(--w-radius-full)',
              border: 'var(--w-border-width) solid var(--w-line-strong)',
              backgroundColor: webMcpEnabled ? 'var(--w-primary)' : 'var(--w-sunken)',
              cursor: 'pointer',
              boxSizing: 'border-box',
              transition: 'background-color var(--w-dur-fast) var(--w-ease)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: webMcpEnabled ? 'flex-end' : 'flex-start',
                inlineSize: '100%',
                blockSize: '100%',
              }}
            >
              <span
                style={{
                  display: 'block',
                  inlineSize: 'var(--w-space-4)',
                  blockSize: 'var(--w-space-4)',
                  borderRadius: 'var(--w-radius-full)',
                  backgroundColor: webMcpEnabled ? 'var(--w-on-primary)' : 'var(--w-text-muted)',
                }}
              />
            </span>
          </button>
        </div>
      )}

      <div
        style={{
          padding: 'var(--w-space-4)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: 'var(--w-space-3)',
        }}
      >
        <div className="v3-settings-budget-field">
          <TextField
            type="number"
            min="1"
            step="1"
            dir="ltr"
            prefix="$"
            label={t('settings.general.budget')}
            hint={t('settings.general.budget.hint')}
            error={budgetError ?? undefined}
            value={budgetInput}
            onChange={(e) => {
              setBudgetInput(e.target.value);
              setBudgetError(null);
              setBudgetSaved(false);
            }}
            data-testid="general-default-budget-input"
          />
        </div>
        <Button
          variant="primary"
          loading={saveBudgetAction.pending}
          data-action="settings.budget-default.save"
          onClick={() => {
            void saveBudgetAction.run();
          }}
        >
          {t('settings.general.budget.save')}
        </Button>
      </div>
    </SettingsSection>
  );
}
