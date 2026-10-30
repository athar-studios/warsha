// Tests for the Settings → Providers screen (PLAN.md M8b).
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsProviders } from './SettingsProviders';
import type { ProviderEntry, ProviderMode } from '../components/ProviderRow';

const providers: ProviderEntry[] = [
  { name: 'Claude Code', mode: 'notify', pinnedVersion: '1.2.3', enabled: true },
  { name: 'Ollama', mode: 'auto', enabled: true },
  { name: 'Codex CLI', mode: 'off', enabled: false },
];

function renderScreen(list: ProviderEntry[] = providers, locale: 'ar' | 'en' = 'en') {
  const onModeChange = vi.fn();
  const onToggle = vi.fn();
  const onPinVersion = vi.fn();

  render(
    <LocaleProvider initialLocale={locale}>
      <SettingsProviders
        providers={list}
        onModeChange={onModeChange}
        onToggle={onToggle}
        onPinVersion={onPinVersion}
      />
    </LocaleProvider>
  );

  return { onModeChange, onToggle, onPinVersion };
}

describe('SettingsProviders', () => {
  it('renders the header with the off-by-default note', () => {
    renderScreen();

    expect(screen.getByRole('heading', { name: 'Providers' })).toBeInTheDocument();
    expect(screen.getByTestId('settings-providers-note')).toHaveTextContent('Off by default');
  });

  it('renders one row per provider', () => {
    renderScreen();

    const list = screen.getByTestId('settings-providers-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByTestId('provider-row-Claude Code')).toHaveAttribute('data-mode', 'notify');
    expect(screen.getByTestId('provider-row-Codex CLI')).toHaveAttribute('data-enabled', 'false');
  });

  it('renders an empty state when no provider is configured', () => {
    renderScreen([]);

    expect(screen.getByTestId('settings-providers-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-providers-list')).toBeNull();
  });

  it('reports a mode change with the provider name', () => {
    const { onModeChange } = renderScreen();

    fireEvent.change(screen.getByRole('combobox', { name: /Mode — Ollama/ }), {
      target: { value: 'notify' },
    });

    expect(onModeChange).toHaveBeenCalledWith('Ollama', 'notify');
  });

  it('reports a toggle with the provider name', () => {
    const { onToggle } = renderScreen();

    fireEvent.click(screen.getByRole('checkbox', { name: /Enabled — Codex CLI/ }));

    expect(onToggle).toHaveBeenCalledWith('Codex CLI', true);
  });

  it('reports a pinned version with the provider name', () => {
    const { onPinVersion } = renderScreen();

    fireEvent.change(screen.getByRole('textbox', { name: /Pinned version — Claude Code/ }), {
      target: { value: '2.0.0' },
    });

    expect(onPinVersion).toHaveBeenCalledWith('Claude Code', '2.0.0');
  });

  it('follows the caller state, so a typed pin stays visible', () => {
    function Harness() {
      const [list, setList] = useState<ProviderEntry[]>(providers);
      const setPin = (name: string, version: string) =>
        setList((current) =>
          current.map((provider) =>
            provider.name === name ? { ...provider, pinnedVersion: version } : provider
          )
        );
      const setMode = (name: string, mode: ProviderMode) =>
        setList((current) =>
          current.map((provider) => (provider.name === name ? { ...provider, mode } : provider))
        );
      const setEnabled = (name: string, enabled: boolean) =>
        setList((current) =>
          current.map((provider) => (provider.name === name ? { ...provider, enabled } : provider))
        );

      return (
        <SettingsProviders
          providers={list}
          onModeChange={setMode}
          onToggle={setEnabled}
          onPinVersion={setPin}
        />
      );
    }

    render(
      <LocaleProvider initialLocale="en">
        <Harness />
      </LocaleProvider>
    );

    const pin = screen.getByRole('textbox', { name: /Pinned version — Ollama/ });
    fireEvent.change(pin, { target: { value: '0.4.1' } });
    expect(pin).toHaveValue('0.4.1');

    fireEvent.change(screen.getByRole('combobox', { name: /Mode — Codex CLI/ }), {
      target: { value: 'auto' },
    });
    expect(screen.getByTestId('provider-row-Codex CLI')).toHaveAttribute('data-mode', 'auto');
  });

  it('uses the Arabic header and direction under an Arabic locale', () => {
    renderScreen(providers, 'ar');

    expect(screen.getByTestId('settings-providers')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'المزوّدون' })).toBeInTheDocument();
    expect(screen.getByTestId('settings-providers-note')).toHaveTextContent('معطّلة افتراضياً');
  });
});
