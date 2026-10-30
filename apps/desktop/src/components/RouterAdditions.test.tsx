// Tests for the router-addition UI components (PLAN.md M14b):
// the local/cloud badge, the Eco mode toggle and the provider setup wizard.
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EcoModeToggle } from './EcoModeToggle';
import { LocalCloudBadge } from './LocalCloudBadge';
import { ProviderSetupWizard, testConnection } from './ProviderSetupWizard';

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

describe('LocalCloudBadge', () => {
  it('renders Local for a local target', () => {
    renderIn('en', <LocalCloudBadge kind="local" />);

    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('Local')).toHaveAttribute('data-kind', 'local');
  });

  it('renders Cloud for a cloud target', () => {
    renderIn('en', <LocalCloudBadge kind="cloud" />);

    expect(screen.getByText('Cloud')).toBeInTheDocument();
    expect(screen.getByText('Cloud')).toHaveAttribute('data-kind', 'cloud');
  });

  it('names the target and the model in the accessible label', () => {
    renderIn('en', <LocalCloudBadge kind="local" targetName="ollama" model="qwen2.5:3b" />);

    const badge = screen.getByText('Local');
    expect(badge).toHaveAttribute('title', 'Runs on this device — ollama · qwen2.5:3b');
    expect(badge.getAttribute('aria-label')).toContain('qwen2.5:3b');
  });

  it('follows the locale', () => {
    renderIn('ar', <LocalCloudBadge kind="cloud" />);

    expect(screen.getByText('سحابي')).toBeInTheDocument();
  });
});

describe('EcoModeToggle', () => {
  it('turns on when clicked while off', () => {
    const onChange = vi.fn();
    renderIn(
      'en',
      <EcoModeToggle
        enabled={false}
        onBattery
        batteryPct={15}
        networkOk
        onChange={onChange}
      />
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('turns off when clicked while on', () => {
    const onChange = vi.fn();
    renderIn(
      'en',
      <EcoModeToggle
        enabled
        onBattery={false}
        batteryPct={100}
        networkOk
        onChange={onChange}
      />
    );

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Eco mode: On')).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('shows the battery and network status it decides on', () => {
    renderIn(
      'en',
      <EcoModeToggle
        enabled
        onBattery
        batteryPct={12.4}
        networkOk={false}
        onChange={() => undefined}
        reason="offline, so routing to a local target"
      />
    );

    expect(screen.getByTestId('eco-status')).toHaveTextContent('Battery 12% · Offline');
  });

  it('shows mains power when not on battery', () => {
    renderIn(
      'en',
      <EcoModeToggle
        enabled={false}
        onBattery={false}
        batteryPct={80}
        networkOk
        onChange={() => undefined}
      />
    );

    expect(screen.getByTestId('eco-status')).toHaveTextContent('On mains power · Online');
  });
});

describe('testConnection', () => {
  it('passes all three checks for valid input', () => {
    const result = testConnection({
      provider: 'open_router',
      url: 'https://openrouter.ai/api/v1',
      key: 'sk-or-test',
      model: 'openai/gpt-4o-mini',
    });

    expect(result).toEqual({
      url_ok: true,
      key_ok: true,
      model_ok: true,
      url_reason: null,
      key_reason: null,
      model_reason: null,
    });
  });

  it('reports a bad URL without failing the key or the model', () => {
    const result = testConnection({
      provider: 'custom',
      url: 'openrouter.ai/api/v1',
      key: 'sk-or-test',
      model: 'gpt-4o-mini',
    });

    expect(result.url_ok).toBe(false);
    expect(result.key_ok).toBe(true);
    expect(result.model_ok).toBe(true);
    expect(result.url_reason).toContain('http://');
  });

  it('reports an empty key and an empty model separately', () => {
    const result = testConnection({
      provider: 'deep_seek',
      url: 'https://api.deepseek.com/v1',
      key: '',
      model: '',
    });

    expect(result.url_ok).toBe(true);
    expect(result.key_ok).toBe(false);
    expect(result.model_ok).toBe(false);
    expect(result.key_reason).toContain('API key');
    expect(result.model_reason).toContain('model');
  });
});

describe('ProviderSetupWizard', () => {
  it('prefills the default URL and follows the provider picker', () => {
    renderIn('en', <ProviderSetupWizard />);

    const url = screen.getByLabelText('Base URL');
    expect(url).toHaveValue('https://openrouter.ai/api/v1');

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'deep_seek' } });
    expect(url).toHaveValue('https://api.deepseek.com/v1');

    // Custom keeps whatever the owner typed; it has no default URL.
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'custom' } });
    expect(url).toHaveValue('https://api.deepseek.com/v1');
  });

  it('shows three checkmarks after a successful test', () => {
    const onTest = vi.fn();
    renderIn('en', <ProviderSetupWizard onTest={onTest} />);

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-or-test' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-4o-mini' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(screen.getByText('✓ URL')).toBeInTheDocument();
    expect(screen.getByText('✓ API key')).toBeInTheDocument();
    expect(screen.getByText('✓ Model')).toBeInTheDocument();
    expect(onTest).toHaveBeenCalledTimes(1);
    expect(onTest.mock.calls[0]?.[1]).toMatchObject({ url_ok: true, key_ok: true, model_ok: true });
  });

  it('shows a cross with the reason for the field that failed', () => {
    renderIn('en', <ProviderSetupWizard />);

    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'ftp://example.com' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-or-test' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-4o-mini' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(
      screen.getByText('✗ URL — The URL must start with http:// or https://.')
    ).toBeInTheDocument();
    expect(screen.getByText('✓ API key')).toBeInTheDocument();
    expect(screen.getByText('✓ Model')).toBeInTheDocument();
  });

  it('keeps Save disabled until all three checks pass', () => {
    const onSave = vi.fn();
    renderIn('en', <ProviderSetupWizard onSave={onSave} />);

    const save = screen.getByRole('button', { name: 'Save provider' });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-or-test' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-4o-mini' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(save).toBeEnabled();

    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({
      provider: 'open_router',
      url: 'https://openrouter.ai/api/v1',
      key: 'sk-or-test',
      model: 'gpt-4o-mini',
    });
  });
});
