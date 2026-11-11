import type { ActionDef } from '../types';

export const ACTIONS: readonly ActionDef[] = [
  {
    id: 'home.start',
    labelKey: 'home.start',
    effect: 'rpc',
    rpc: ['projects.create', 'budget.set', 'runs.start'],
    route: '/p/:id',
  },
  {
    id: 'home.example.use',
    labelKey: 'home.example_use',
    effect: 'state',
  },
  {
    id: 'home.defaults.open',
    labelKey: 'home.defaults_open',
    effect: 'state',
  },
  {
    id: 'home.defaults.budget.save',
    labelKey: 'home.defaults_budget_save',
    effect: 'rpc',
    rpc: ['preferences.record'],
  },
  {
    id: 'home.defaults.models.open',
    labelKey: 'home.defaults_models_open',
    effect: 'nav',
    route: '/settings/models',
  },
  {
    id: 'home.inbox.review',
    labelKey: 'home.inbox_review',
    effect: 'nav',
    route: '/inbox',
  },
  {
    id: 'home.project.open',
    labelKey: 'home.project_open',
    effect: 'nav',
    route: '/p/:id',
  },
  {
    id: 'home.projects.all',
    labelKey: 'home.projects_all',
    effect: 'nav',
    route: '/projects',
  },
  {
    id: 'home.provider.add',
    labelKey: 'home.provider_add',
    effect: 'nav',
    route: '/onboarding',
  },
  {
    id: 'home.retry',
    labelKey: 'home.retry',
    effect: 'rpc',
    rpc: ['projects.list'],
  },
];
