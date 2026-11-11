import type { ActionDef } from '../types';

export const ACTIONS: readonly ActionDef[] = [
  {
    id: 'projects.open',
    labelKey: 'projects.open',
    effect: 'nav',
    route: '/p/:id',
  },
  {
    id: 'projects.new',
    labelKey: 'projects.new',
    effect: 'nav',
    route: '/',
  },
  {
    id: 'projects.search',
    labelKey: 'projects.search',
    effect: 'state',
  },
  {
    id: 'projects.sort',
    labelKey: 'projects.sort',
    effect: 'state',
  },
  {
    id: 'projects.retry',
    labelKey: 'projects.retry',
    effect: 'rpc',
    rpc: ['projects.list'],
  },
];
