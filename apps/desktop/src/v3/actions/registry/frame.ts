import type { ActionDef } from '../types';

export const ACTIONS: readonly ActionDef[] = [
  {
    id: 'frame.skip-to-main',
    labelKey: 'frame.skip_to_main',
    effect: 'nav',
    route: '#main',
  },
  {
    id: 'frame.project.open',
    labelKey: 'frame.project_switcher_label',
    effect: 'state',
  },
  {
    id: 'frame.project.switch',
    labelKey: 'frame.project_switcher_label',
    effect: 'nav',
    route: '/p/:id',
  },
  {
    id: 'frame.project.new',
    labelKey: 'frame.new_project',
    effect: 'nav',
    route: '/',
  },
  {
    id: 'frame.mode.simple',
    labelKey: 'frame.mode_simple',
    effect: 'state',
  },
  {
    id: 'frame.mode.advanced',
    labelKey: 'frame.mode_advanced',
    effect: 'state',
  },
  {
    id: 'frame.inbox.open',
    labelKey: 'frame.inbox_label',
    effect: 'nav',
    route: '/inbox',
  },
  {
    id: 'frame.settings.open',
    labelKey: 'frame.settings_label',
    effect: 'nav',
    route: '/settings/general',
  },
  {
    id: 'frame.daemon.retry',
    labelKey: 'common.retry',
    effect: 'rpc',
    rpc: ['health'],
  },
];
