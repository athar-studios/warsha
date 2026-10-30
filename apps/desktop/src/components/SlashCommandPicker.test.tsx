// Tests for the slash command picker (PLAN.md M18).
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  filterSlashCommands,
  type SlashCommandItem,
  SlashCommandPicker,
} from './SlashCommandPicker';

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

const commands: SlashCommandItem[] = [
  { name: '/review', description: 'Review the current diff' },
  { name: '/deploy', description: 'Draft a release' },
  { name: '/refactor', description: 'Refactor the selection' },
];

describe('SlashCommandPicker', () => {
  it('lists the commands with their descriptions, sorted by name', () => {
    renderIn('en', <SlashCommandPicker commands={commands} onSelect={() => undefined} />);

    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('data-command'));
    expect(names).toEqual(['/deploy', '/refactor', '/review']);
    expect(screen.getByText('Draft a release')).toBeInTheDocument();
  });

  it('narrows the list to what was typed after the /', () => {
    renderIn(
      'en',
      <SlashCommandPicker commands={commands} query="/re" onSelect={() => undefined} />
    );

    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('data-command'));
    expect(names).toEqual(['/refactor', '/review']);
    expect(screen.getByTestId('slash-command-picker')).toHaveAttribute('data-query', '/re');
  });

  it('calls back with the command name', () => {
    const onSelect = vi.fn();
    renderIn('en', <SlashCommandPicker commands={commands} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /deploy/i }));

    expect(onSelect).toHaveBeenCalledWith('/deploy');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('says so when nothing matches', () => {
    renderIn(
      'en',
      <SlashCommandPicker commands={commands} query="zzz" onSelect={() => undefined} />
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByTestId('slash-command-picker-empty')).toHaveTextContent(
      'No matching command'
    );
  });

  it('follows the locale and keeps the command name left to right', () => {
    renderIn('ar', <SlashCommandPicker commands={commands} onSelect={() => undefined} />);

    expect(screen.getByTestId('slash-command-picker')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('slash-command-picker')).toHaveAttribute('aria-label', 'أوامر جاهزة');
    expect(screen.getByText('/review')).toHaveAttribute('dir', 'ltr');
  });

  it('filters case-insensitively and accepts a missing slash', () => {
    expect(filterSlashCommands(commands, '').map((command) => command.name)).toEqual([
      '/deploy',
      '/refactor',
      '/review',
    ]);
    expect(filterSlashCommands(commands, 'RE').map((command) => command.name)).toEqual([
      '/refactor',
      '/review',
    ]);
    expect(filterSlashCommands(commands, '/de').map((command) => command.name)).toEqual([
      '/deploy',
    ]);
    expect(filterSlashCommands(commands, 'zzz')).toEqual([]);
    // The caller's name comes back unchanged, slash or no slash.
    expect(
      filterSlashCommands([{ name: 'deploy', description: 'Draft a release' }], '/de')
    ).toEqual([{ name: 'deploy', description: 'Draft a release' }]);
  });
});
