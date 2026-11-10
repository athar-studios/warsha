import type { ActionDef } from '../types';

export const ACTIONS: readonly ActionDef[] = [
  {
    id: 'project.gate.approve',
    labelKey: 'project.gate_approve',
    effect: 'rpc',
    rpc: ['gates.approve', 'runs.advance'],
  },
  {
    id: 'project.gate.changes.open',
    labelKey: 'project.gate_changes_open',
    effect: 'state',
  },
  {
    id: 'project.gate.changes.send',
    labelKey: 'project.gate_changes_send',
    effect: 'rpc',
    rpc: ['gates.changes'],
  },
  {
    id: 'project.gate.reject.open',
    labelKey: 'project.gate_reject_open',
    effect: 'state',
  },
  {
    id: 'project.gate.reject.confirm',
    labelKey: 'project.gate_reject_confirm',
    effect: 'rpc',
    rpc: ['gates.reject'],
  },
  {
    id: 'project.preview.start',
    labelKey: 'project.preview_start',
    effect: 'rpc',
    rpc: ['preview.start'],
  },
  {
    id: 'project.preview.stop',
    labelKey: 'project.preview_stop',
    effect: 'rpc',
    rpc: ['preview.stop'],
  },
  {
    id: 'project.preview.open',
    labelKey: 'project.preview_open',
    effect: 'nav',
  },
  {
    id: 'project.code.open',
    labelKey: 'project.code_open',
    effect: 'nav',
  },
  {
    id: 'project.tests.open',
    labelKey: 'project.tests_open',
    effect: 'state',
  },
  {
    id: 'project.activity.toggle',
    labelKey: 'project.activity_toggle',
    effect: 'state',
  },
  {
    id: 'project.followup.send',
    labelKey: 'project.followup_send',
    effect: 'rpc',
    rpc: ['runs.followup'],
  },
  {
    id: 'project.budget.open',
    labelKey: 'project.budget_open',
    effect: 'state',
  },
  {
    id: 'project.budget.save',
    labelKey: 'project.budget_save',
    effect: 'rpc',
    rpc: ['budget.set'],
  },
  {
    id: 'project.run.cancel.open',
    labelKey: 'project.run_cancel_open',
    effect: 'state',
  },
  {
    id: 'project.run.cancel.confirm',
    labelKey: 'project.run_cancel_confirm',
    effect: 'rpc',
    rpc: ['runs.cancel'],
  },
  {
    id: 'project.run.restart',
    labelKey: 'project.run_restart',
    effect: 'rpc',
    rpc: ['runs.start'],
  },
  {
    id: 'project.open-advanced',
    labelKey: 'project.open_advanced',
    effect: 'state',
  },
  {
    id: 'project.retry',
    labelKey: 'project.retry',
    effect: 'rpc',
    rpc: ['projects.get'],
  },
];
