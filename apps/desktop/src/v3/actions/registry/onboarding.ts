import type { ActionDef } from '../types';

export const ACTIONS: readonly ActionDef[] = [
  {
    id: 'onboarding.language.pick',
    labelKey: 'onboarding.action_language_pick',
    effect: 'state',
  },
  {
    id: 'onboarding.provider.pick',
    labelKey: 'onboarding.action_provider_pick',
    effect: 'state',
  },
  {
    id: 'onboarding.provider.save-test',
    labelKey: 'onboarding.save_test',
    effect: 'rpc',
    rpc: ['providers.add', 'providers.test'],
  },
  {
    id: 'onboarding.models.fetch',
    labelKey: 'onboarding.fetch_models',
    effect: 'rpc',
    rpc: ['providers.check_models'],
  },
  {
    id: 'onboarding.model.use',
    labelKey: 'onboarding.use_model',
    effect: 'rpc',
    rpc: ['models.add', 'roles.set'],
  },
  {
    id: 'onboarding.back',
    labelKey: 'onboarding.back',
    effect: 'state',
  },
  {
    id: 'onboarding.next',
    labelKey: 'onboarding.next',
    effect: 'state',
  },
  {
    id: 'onboarding.start',
    labelKey: 'onboarding.start_idea',
    effect: 'rpc',
    rpc: ['projects.create', 'runs.start'],
    route: '/p/:id',
  },
  {
    id: 'onboarding.later',
    labelKey: 'onboarding.later',
    effect: 'nav',
    route: '/',
  },
  {
    id: 'onboarding.retry',
    labelKey: 'onboarding.error_retry',
    effect: 'rpc',
    rpc: ['providers.list'],
  },
];
