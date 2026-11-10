import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { matchRoute, normalizePath, RouteOutlet, RouterProvider, useNavigate, useRoute } from './index';

describe('hash router', () => {
  it('normalizes hashes and pathnames', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('#')).toBe('/');
    expect(normalizePath('#/onboarding')).toBe('/onboarding');
    expect(normalizePath('/projects/')).toBe('/projects');
    expect(normalizePath('#/p/proj-1?query=1')).toBe('/p/proj-1');
  });

  it('matches static routes', () => {
    const onboarding = matchRoute('/onboarding');
    expect(onboarding?.route.area).toBe('onboarding');

    const home = matchRoute('/');
    expect(home?.route.area).toBe('home');

    const projects = matchRoute('/projects');
    expect(projects?.route.area).toBe('projects');

    const inbox = matchRoute('/inbox');
    expect(inbox?.route.area).toBe('inbox');
  });

  it('matches parameterized routes and extracts params', () => {
    const project = matchRoute('/p/my-project');
    expect(project?.route.area).toBe('project');
    expect(project?.params).toEqual({ projectId: 'my-project' });

    const bench = matchRoute('/p/proj-42/r/run-99/files');
    expect(bench?.route.area).toBe('bench');
    expect(bench?.params).toEqual({
      projectId: 'proj-42',
      runId: 'run-99',
      tab: 'files',
    });

    const settings = matchRoute('/settings/models');
    expect(settings?.route.area).toBe('settings');
    expect(settings?.params).toEqual({ section: 'models' });
  });

  it('renders matching route in RouterProvider and updates on navigate', () => {
    function RouteInspector(): React.ReactElement {
      const { pathname, params, area } = useRoute();
      const navigate = useNavigate();
      return (
        <div>
          <span data-testid="path">{pathname}</span>
          <span data-testid="area">{area}</span>
          <span data-testid="proj">{params.projectId ?? 'none'}</span>
          <button data-action="test.go" onClick={() => navigate('/p/new-id')}>
            navigate
          </button>
        </div>
      );
    }

    render(
      <RouterProvider initialPath="/projects">
        <RouteInspector />
      </RouterProvider>
    );

    expect(screen.getByTestId('path').textContent).toBe('/projects');
    expect(screen.getByTestId('area').textContent).toBe('projects');

    act(() => {
      screen.getByText('navigate').click();
    });

    expect(screen.getByTestId('path').textContent).toBe('/p/new-id');
    expect(screen.getByTestId('area').textContent).toBe('project');
    expect(screen.getByTestId('proj').textContent).toBe('new-id');
  });

  it('renders RouteOutlet component for the active route', () => {
    render(
      <RouterProvider initialPath="/onboarding">
        <RouteOutlet />
      </RouterProvider>
    );

    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Onboarding|التهيئة الأولى/);
  });
});
