import type { ActionDef } from '../types';

export const ACTIONS: readonly ActionDef[] = [
  // Navigation & disclosure
  { id: 'settings.nav.open', labelKey: 'settings.nav.open', effect: 'nav' },
  { id: 'settings.advanced.toggle', labelKey: 'settings.nav.advanced_show', effect: 'state' },

  // General section
  { id: 'settings.language.set', labelKey: 'settings.general.language', effect: 'state' },
  { id: 'settings.theme.set', labelKey: 'settings.general.theme', effect: 'state' },
  { id: 'settings.mode-default.set', labelKey: 'settings.general.mode', effect: 'state' },
  {
    id: 'settings.budget-default.save',
    labelKey: 'settings.general.budget.save',
    effect: 'rpc',
    rpc: ['preferences.record'],
  },

  // Models & Providers section
  { id: 'settings.provider.add.open', labelKey: 'settings.providers.add', effect: 'state' },
  {
    id: 'settings.provider.add.save',
    labelKey: 'settings.providers.form.save',
    effect: 'rpc',
    rpc: ['providers.add'],
  },
  {
    id: 'settings.provider.test',
    labelKey: 'settings.providers.test',
    effect: 'rpc',
    rpc: ['providers.test'],
  },
  {
    id: 'settings.provider.models.fetch',
    labelKey: 'settings.providers.fetch_models',
    effect: 'rpc',
    rpc: ['providers.check_models'],
  },
  { id: 'settings.provider.remove.open', labelKey: 'settings.providers.remove', effect: 'state' },
  {
    id: 'settings.provider.remove.confirm',
    labelKey: 'settings.common.confirm_remove',
    effect: 'rpc',
    rpc: ['providers.remove'],
  },
  {
    id: 'settings.model.add',
    labelKey: 'settings.models.add',
    effect: 'rpc',
    rpc: ['models.add'],
  },
  { id: 'settings.model.remove.open', labelKey: 'settings.models.remove', effect: 'state' },
  {
    id: 'settings.model.remove.confirm',
    labelKey: 'settings.common.confirm_remove',
    effect: 'rpc',
    rpc: ['models.remove'],
  },
  {
    id: 'settings.role.route.set',
    labelKey: 'settings.roles.save',
    effect: 'rpc',
    rpc: ['roles.set'],
  },

  // Devices section
  {
    id: 'settings.device.pair.start',
    labelKey: 'settings.devices.pair',
    effect: 'rpc',
    rpc: ['devices.pair-start'],
  },
  { id: 'settings.device.revoke.open', labelKey: 'settings.devices.revoke', effect: 'state' },
  {
    id: 'settings.device.revoke.confirm',
    labelKey: 'settings.common.confirm_revoke',
    effect: 'rpc',
    rpc: ['devices.revoke'],
  },

  // About section
  {
    id: 'settings.about.health.refresh',
    labelKey: 'settings.about.refresh',
    effect: 'rpc',
    rpc: ['health'],
  },
  { id: 'settings.about.copy', labelKey: 'settings.about.copy', effect: 'state' },

  // Shared dialog & error recovery actions
  { id: 'settings.dialog.cancel', labelKey: 'common.cancel', effect: 'state' },
  { id: 'settings.error.retry', labelKey: 'common.retry', effect: 'state' },
];

