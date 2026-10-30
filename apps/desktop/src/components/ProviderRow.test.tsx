// Tests for the Settings → Providers row (PLAN.md M8b).
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import { describe, expect, it, vi } from 'vitest';

import { ProviderRow, providerModes, type ProviderEntry } from './ProviderRow';

const provider: ProviderEntry = {
  name: 'Claude Code',
  mode: 'notify',
  pinnedVersion: '1.2.3',
  enabled: true,
};

function renderRow(overrides: Partial<ProviderEntry> = {}, locale: 'ar' | 'en' = 'en') {
  const onModeChange = vi.fn();
  const onToggle = vi.fn();
  const onPinVersion = vi.fn();
  const onTest = vi.fn();

  render(
    <LocaleProvider initialLocale={locale}>
      <ul>
        <ProviderRow
          {...provider}
          {...overrides}
          onModeChange={onModeChange}
          onToggle={onToggle}
          onPinVersion={onPinVersion}
          onTest={onTest}
        />
      </ul>
    </LocaleProvider>
  );

  return { onModeChange, onToggle, onPinVersion, onTest };
}

describe('ProviderRow', () => {
  it('shows the provider name, its mode, the pin and the test button', () => {
    renderRow();

    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Mode/ })).toHaveValue('notify');
    expect(screen.getByRole('textbox', { name: /Pinned version/ })).toHaveValue('1.2.3');
    expect(screen.getByRole('checkbox', { name: /Enabled/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument();
  });

  it('offers exactly off, notify and auto in the mode selector', () => {
    renderRow();

    const options = screen
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);

    expect(options).toEqual([...providerModes]);
  });

  it('reports a mode change', () => {
    const { onModeChange } = renderRow();

    fireEvent.change(screen.getByRole('combobox', { name: /Mode/ }), { target: { value: 'auto' } });

    expect(onModeChange).toHaveBeenCalledWith('auto');
  });

  it('reports the enabled toggle', () => {
    const { onToggle } = renderRow();

    fireEvent.click(screen.getByRole('checkbox', { name: /Enabled/ }));

    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('reports a typed pinned version', () => {
    const { onPinVersion } = renderRow();

    fireEvent.change(screen.getByRole('textbox', { name: /Pinned version/ }), {
      target: { value: '2.0.0' },
    });

    expect(onPinVersion).toHaveBeenCalledWith('2.0.0');
  });

  it('calls onTest when "Test connection" is pressed', () => {
    const { onTest } = renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it('localizes the row and keeps the pin left-to-right under Arabic', () => {
    renderRow({ name: 'Codex CLI', mode: 'off', pinnedVersion: '', enabled: false }, 'ar');

    const row = screen.getByTestId('provider-row-Codex CLI');
    expect(row).toHaveAttribute('dir', 'rtl');
    expect(row).toHaveAttribute('data-enabled', 'false');
    expect(screen.getByRole('combobox', { name: /الوضع/ })).toHaveValue('off');
    expect(screen.getByRole('textbox', { name: /نسخة مثبّتة/ })).toHaveAttribute('dir', 'ltr');
  });
});
