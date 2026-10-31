import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  createClient,
  type ProjectId,
  type ProjectSummary,
  type RunId,
  type WarshaClient,
} from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ProjectsBoard } from './ProjectsBoard';

function createMockClient(projects: ProjectSummary[] = []): WarshaClient {
  const client = createClient('http://127.0.0.1:8766', 'test-token');
  client.listProjects = vi.fn(async () => projects);
  client.listRuns = vi.fn(async () => []);
  client.createProject = vi.fn(async (name: string) => ({
    id: 'proj-new' as ProjectId,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  client.startRun = vi.fn(async () => ({
    id: 'run-new' as RunId,
    projectId: 'proj-new' as ProjectId,
    stage: 'idea' as const,
    status: 'running' as const,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  return client;
}

describe('ProjectsBoard', () => {
  it('renders empty state when there are no projects', async () => {
    const client = createMockClient([]);
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <ProjectsBoard client={client} />
      </LocaleProvider>
    );

    const emptyTitle = await screen.findByText(t('projects.empty_title', {}, 'ar'));
    expect(emptyTitle).toBeInTheDocument();
    expect(screen.getByText(t('projects.empty_desc', {}, 'ar'))).toBeInTheDocument();
    expect(screen.getByTestId('projects-empty-new-btn')).toBeInTheDocument();
  });

  it('opens modal when clicking new project from empty state', async () => {
    const client = createMockClient([]);
    render(
      <LocaleProvider initialLocale="ar" storage={null}>
        <ProjectsBoard client={client} />
      </LocaleProvider>
    );

    const newBtn = await screen.findByTestId('projects-empty-new-btn');
    fireEvent.click(newBtn);

    expect(screen.getByText(t('projects.new_modal_title', {}, 'ar'))).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(t('projects.name_placeholder', {}, 'ar'))
    ).toBeInTheDocument();
  });
});
