import type { ActionDef } from '../types';

export const ACTIONS: readonly ActionDef[] = [
  {
    id: 'inbox.back',
    labelKey: 'inbox.back',
    effect: 'nav',
    route: '/',
  },
  {
    id: 'inbox.decision.open',
    labelKey: 'inbox.decision_open',
    effect: 'state',
  },
  {
    id: 'inbox.gate.approve',
    labelKey: 'inbox.gate_approve',
    effect: 'rpc',
    rpc: ['gates.approve', 'runs.advance'],
  },
  {
    id: 'inbox.gate.changes.send',
    labelKey: 'inbox.gate_changes_send',
    effect: 'rpc',
    rpc: ['gates.changes'],
  },
  {
    id: 'inbox.gate.reject.confirm',
    labelKey: 'inbox.gate_reject_confirm',
    effect: 'rpc',
    rpc: ['gates.reject'],
  },
  {
    id: 'inbox.mcp.allow-always',
    labelKey: 'inbox.mcp.allow_always',
    effect: 'rpc',
    rpc: ['mcp.permissions.set'],
  },
  {
    id: 'inbox.mcp.allow-once',
    labelKey: 'inbox.mcp.allow_once',
    effect: 'rpc',
    rpc: ['mcp.approvals.allow_once'],
  },
  {
    id: 'inbox.mcp.deny',
    labelKey: 'inbox.mcp.deny',
    effect: 'rpc',
    rpc: ['mcp.permissions.set'],
  },
  {
    id: 'inbox.project.open',
    labelKey: 'inbox.project_open',
    effect: 'nav',
    route: '/p/:id',
  },
  {
    id: 'inbox.retry',
    labelKey: 'inbox.retry',
    effect: 'rpc',
    rpc: ['projects.list'],
  },
];
