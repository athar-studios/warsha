// Tests for the skills ledger (Wave 2): the daemon rows, the toggle that adopts the daemon's answer,
// the prompt disclosure, the SKILL.md import assembled as front matter + body, and the bundled
// twelve shown when the daemon does not answer.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type SkillDefinition, type WarshaClient } from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SkillsSettings } from './SkillsSettings';

const ar = (key: string) => t(key, {}, 'ar');
const en = (key: string) => t(key, {}, 'en');

const BRAINSTORMING: SkillDefinition = {
  id: 'brainstorming',
  name: 'Brainstorming',
  description: 'Refine rough ideas into a validated design.',
  source: 'github.com/obra/superpowers',
  license: 'MIT',
  content: '# Brainstorming\n\nAsk one question at a time.',
  enabled: true,
  tags: ['planning', 'design'],
};

const WEBAPP_TESTING: SkillDefinition = {
  id: 'webapp-testing',
  name: 'Webapp Testing',
  description: '',
  source: 'github.com/anthropics/skills',
  license: 'Apache-2.0',
  content: '',
  enabled: false,
  tags: [],
};

function clientStub(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const client = {} as WarshaClient;
  client.listSkills = vi.fn(async () => [BRAINSTORMING, WEBAPP_TESTING]);
  client.toggleSkill = vi.fn(async (id: string, enabled: boolean): Promise<SkillDefinition> => ({
    ...BRAINSTORMING,
    id,
    enabled,
  }));
  client.importSkill = vi.fn(async (urlOrContent: string, name?: string): Promise<SkillDefinition> => ({
    id: (name ?? 'imported').toLowerCase().replace(/\s+/g, '-'),
    name: name ?? 'Imported',
    description: '',
    source: 'imported',
    license: 'MIT',
    content: urlOrContent,
    enabled: true,
    tags: [],
  }));
  return Object.assign(client, overrides);
}

function renderScreen(client: WarshaClient = clientStub(), locale: 'ar' | 'en' = 'ar') {
  return render(
    <LocaleProvider initialLocale={locale} storage={null}>
      <SkillsSettings client={client} />
    </LocaleProvider>
  );
}

describe('SkillsSettings', () => {
  it('rules the daemon skills with their provenance in machine letters', async () => {
    renderScreen();

    const ledger = await screen.findByRole('list', { name: ar('skills.bundled') });
    const rows = within(ledger).getAllByRole('listitem');
    expect(rows).toHaveLength(2);

    expect(within(rows[0] as HTMLElement).getByText('Brainstorming')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('brainstorming')).toHaveAttribute('dir', 'ltr');
    // source and license are the machine's own words; the screen only labels them (§11).
    expect(within(rows[0] as HTMLElement).getByText(`${ar('skills.source')}: github.com/obra/superpowers`)).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText(`${ar('skills.license')}: MIT`)).toBeInTheDocument();

    // The disabled row says so in words; the enabled one carries the lit lamp.
    expect(within(rows[1] as HTMLElement).getByText(ar('skills.disabled'))).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getAllByText(ar('skills.enabled')).length).toBeGreaterThan(0);
  });

  it('toggles a skill through the daemon and adopts the answer', async () => {
    const client = clientStub();
    renderScreen(client);

    const toggle = await screen.findByTestId('skill-toggle-webapp-testing');
    expect(toggle).toHaveAccessibleName(`${ar('skills.toggle')} — Webapp Testing`);
    fireEvent.click(toggle);

    await waitFor(() => expect(client.toggleSkill).toHaveBeenCalledWith('webapp-testing', true));
    // The toggled row now reports the daemon's returned shape (enabled, with its lamp).
    const ledger = screen.getByRole('list', { name: ar('skills.bundled') });
    const rows = within(ledger).getAllByRole('listitem');
    expect(within(rows[1] as HTMLElement).getAllByText(ar('skills.enabled')).length).toBeGreaterThan(0);
  });

  it('shows and hides the prompt body per skill', async () => {
    renderScreen();

    const show = await screen.findByTestId('skill-content-brainstorming');
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('skill-prompt-brainstorming')).toBeNull();

    fireEvent.click(show);
    expect(show).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('skill-prompt-brainstorming')).toHaveTextContent('Ask one question at a time.');
    expect(screen.getByTestId('skill-prompt-brainstorming')).toHaveAttribute('dir', 'ltr');

    fireEvent.click(screen.getByTestId('skill-content-brainstorming'));
    expect(screen.queryByTestId('skill-prompt-brainstorming')).toBeNull();

    // A skill with no content offers no disclosure at all (§7: nothing to show).
    expect(screen.queryByTestId('skill-content-webapp-testing')).toBeNull();
  });

  it('assembles a SKILL.md import and writes it to the daemon', async () => {
    const client = clientStub();
    renderScreen(client);

    fireEvent.click(await screen.findByTestId('skills-import-open'));
    const panel = screen.getByRole('region', { name: ar('skills.import_title') });
    fireEvent.change(within(panel).getByRole('textbox', { name: ar('skills.import_name') }), {
      target: { value: 'Release Captain' },
    });
    fireEvent.change(within(panel).getByRole('textbox', { name: ar('skills.import_description') }), {
      target: { value: 'Drives the release stage.' },
    });
    fireEvent.change(within(panel).getByRole('textbox', { name: ar('skills.import_content') }), {
      target: { value: '# Release Captain\n\nShip once the receipts land.' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: ar('skills.import_submit') }));

    await waitFor(() => expect(client.importSkill).toHaveBeenCalledTimes(1));
    const [markdown, name] = vi.mocked(client.importSkill).mock.calls[0] as [string, string];
    expect(name).toBe('Release Captain');
    expect(markdown).toContain('---\nname: Release Captain\ndescription: Drives the release stage.\n---');
    expect(markdown).toContain('# Release Captain');

    expect(await screen.findByText(t('skills.import_done', { name: 'Release Captain' }, 'ar'))).toBeInTheDocument();
    const ledger = screen.getByRole('list', { name: ar('skills.bundled') });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(3);
  });

  it('says when the daemon does not answer and still lists the bundled twelve', async () => {
    const client = clientStub({ listSkills: vi.fn(async () => { throw new Error('offline'); }) });
    renderScreen(client);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(ar('skills.failed'));

    const ledger = screen.getByRole('list', { name: ar('skills.bundled') });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(12);
    expect(within(ledger).getByText('Dispatching Parallel Agents')).toBeInTheDocument();
    expect(within(ledger).getByText('Skill Creator')).toBeInTheDocument();
  });

  it('reads its words in English too', async () => {
    renderScreen(clientStub(), 'en');

    expect(await screen.findByText(en('skills.title'))).toBeInTheDocument();
    const ledger = screen.getByRole('list', { name: en('skills.bundled') });
    expect(within(ledger).getByText(en('skills.disabled'))).toBeInTheDocument();
  });
});
