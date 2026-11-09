import React from 'react';

import BenchPage from '../pages/bench';
import HomePage from '../pages/home';
import InboxPage from '../pages/inbox';
import OnboardingPage from '../pages/onboarding';
import ProjectPage from '../pages/project';
import ProjectsPage from '../pages/projects';
import SettingsPage from '../pages/settings';

export type RouteArea =
  | 'onboarding'
  | 'home'
  | 'projects'
  | 'project'
  | 'bench'
  | 'inbox'
  | 'settings';

export interface RouteDefinition {
  path: string;
  area: RouteArea;
  component: React.ComponentType;
  paramNames: string[];
  regex: RegExp;
}

export function compileRoute(path: string, area: RouteArea, component: React.ComponentType): RouteDefinition {
  const paramNames: string[] = [];
  const regexPattern = path
    .replace(/:([a-zA-Z0-9_]+)/g, (_, paramName: string) => {
      paramNames.push(paramName);
      return '([^/]+)';
    })
    .replace(/\//g, '\\/');

  return {
    path,
    area,
    component,
    paramNames,
    regex: new RegExp(`^${regexPattern}$`),
  };
}

export const ROUTES: readonly RouteDefinition[] = [
  compileRoute('/onboarding', 'onboarding', OnboardingPage),
  compileRoute('/', 'home', HomePage),
  compileRoute('/projects', 'projects', ProjectsPage),
  compileRoute('/p/:projectId', 'project', ProjectPage),
  compileRoute('/p/:projectId/r/:runId/:tab', 'bench', BenchPage),
  compileRoute('/inbox', 'inbox', InboxPage),
  compileRoute('/settings/:section', 'settings', SettingsPage),
];
