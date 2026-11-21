import type { ActionDef } from '../types';

export const ACTIONS: readonly ActionDef[] = [
  {
    id: 'factory.stop.all',
    labelKey: 'factory.stopAll',
    effect: 'rpc',
    rpc: ['runs.cancel'],
  },
  {
    id: 'factory.view.toggle',
    labelKey: 'factory.listView',
    effect: 'state',
  },
  {
    id: 'factory.retry',
    labelKey: 'common.retry',
    effect: 'state',
  },
  {
    id: 'factory.agent.view',
    labelKey: 'factory.panel.title',
    effect: 'nav',
    route: '/p/:projectId/code',
  },
];
