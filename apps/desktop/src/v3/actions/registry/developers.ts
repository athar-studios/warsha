import type { ActionDef } from '../types';

export const ACTIONS: readonly ActionDef[] = [
  { id: 'developers.list.refresh', labelKey: 'developers.list.refresh', effect: 'rpc', rpc: ['sessions.list'] },
  { id: 'developers.detail.nav', labelKey: 'developers.detail.nav', effect: 'nav' },
  {
    id: 'developers.session.stop',
    labelKey: 'developers.session.stop',
    effect: 'rpc',
    rpc: ['sessions.stop'],
  },
  {
    id: 'developers.receipt.export',
    labelKey: 'developers.export.receipt',
    effect: 'state',
  },
  {
    id: 'developers.session.view',
    labelKey: 'developers.detail.view',
    effect: 'nav',
  },
];
