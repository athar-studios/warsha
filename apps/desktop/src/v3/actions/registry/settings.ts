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

  // Workflows section
  {
    id: 'settings.harness.select',
    labelKey: 'settings.workflows.select',
    effect: 'rpc',
    rpc: ['harness.select'],
  },
  {
    id: 'settings.harness.import',
    labelKey: 'settings.workflows.import_btn',
    effect: 'rpc',
    rpc: ['harness.import'],
  },
  {
    id: 'settings.harness.view',
    labelKey: 'settings.workflows.view',
    effect: 'rpc',
    rpc: ['harness.get'],
  },
  { id: 'settings.harness.delete.open', labelKey: 'settings.workflows.delete', effect: 'state' },
  {
    id: 'settings.harness.delete.confirm',
    labelKey: 'settings.common.confirm_delete',
    effect: 'rpc',
    rpc: ['harness.delete'],
  },

  // Skills section
  {
    id: 'settings.skill.toggle',
    labelKey: 'settings.skills.toggle',
    effect: 'rpc',
    rpc: ['skills.toggle'],
  },
  {
    id: 'settings.skill.import',
    labelKey: 'settings.skills.import_btn',
    effect: 'rpc',
    rpc: ['skills.import'],
  },
  { id: 'settings.skill.delete.open', labelKey: 'settings.skills.delete', effect: 'state' },
  {
    id: 'settings.skill.delete.confirm',
    labelKey: 'settings.common.confirm_delete',
    effect: 'rpc',
    rpc: ['skills.delete'],
  },

  // Plugins section
  {
    id: 'settings.plugin.install',
    labelKey: 'settings.plugins.install_btn',
    effect: 'rpc',
    rpc: ['plugins.install'],
  },
  {
    id: 'settings.plugin.toggle',
    labelKey: 'settings.plugins.toggle',
    effect: 'rpc',
    rpc: ['plugins.toggle'],
  },
  { id: 'settings.plugin.configure.open', labelKey: 'settings.plugins.configure', effect: 'state' },
  {
    id: 'settings.plugin.configure.save',
    labelKey: 'settings.plugins.configure.save',
    effect: 'rpc',
    rpc: ['plugins.configure'],
  },
  { id: 'settings.plugin.remove.open', labelKey: 'settings.plugins.remove', effect: 'state' },
  {
    id: 'settings.plugin.remove.confirm',
    labelKey: 'settings.common.confirm_remove',
    effect: 'rpc',
    rpc: ['plugins.remove'],
  },

  // Integrations section
  { id: 'settings.integration.connect.open', labelKey: 'settings.integrations.connect_btn', effect: 'state' },
  {
    id: 'settings.integration.connect',
    labelKey: 'settings.integrations.form.save',
    effect: 'rpc',
    rpc: ['integrations.connect'],
  },
  {
    id: 'settings.integration.test',
    labelKey: 'settings.integrations.test',
    effect: 'rpc',
    rpc: ['integrations.test'],
  },
  { id: 'settings.integration.disconnect.open', labelKey: 'settings.integrations.disconnect', effect: 'state' },
  {
    id: 'settings.integration.disconnect',
    labelKey: 'settings.common.confirm_disconnect',
    effect: 'rpc',
    rpc: ['integrations.disconnect'],
  },

  // Routines section
  {
    id: 'settings.routine.run-now',
    labelKey: 'settings.routines.run_now',
    effect: 'rpc',
    rpc: ['routines.run_now'],
  },
  {
    id: 'settings.routine.pause',
    labelKey: 'settings.routines.pause',
    effect: 'rpc',
    rpc: ['routines.pause'],
  },
  {
    id: 'settings.routine.resume',
    labelKey: 'settings.routines.resume',
    effect: 'rpc',
    rpc: ['routines.resume'],
  },
  {
    id: 'settings.routine.view',
    labelKey: 'settings.routines.view',
    effect: 'rpc',
    rpc: ['routines.get'],
  },

  // Budgets section
  {
    id: 'settings.budget.save',
    labelKey: 'settings.budgets.save',
    effect: 'rpc',
    rpc: ['budget.set'],
  },

  // Post-launch section
  {
    id: 'settings.crashes.filter',
    labelKey: 'settings.postlaunch.filter_btn',
    effect: 'rpc',
    rpc: ['postlaunch.crashes'],
  },
  { id: 'settings.crash.copy', labelKey: 'settings.postlaunch.copy_crash', effect: 'state' },
  {
    id: 'settings.reviews.filter',
    labelKey: 'settings.postlaunch.reviews_title',
    effect: 'rpc',
    rpc: ['postlaunch.reviews'],
  },

  // Shared dialog & error recovery actions
  { id: 'settings.dialog.cancel', labelKey: 'common.cancel', effect: 'state' },
  { id: 'settings.error.retry', labelKey: 'common.retry', effect: 'state' },
];

