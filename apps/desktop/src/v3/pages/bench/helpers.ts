import type { Role, WarshaEvent } from '@warsha/client';
import type { AgentRole, StatusPillState } from '@warsha/ui/v3';

export function mapRunStatusToPill(status: string): StatusPillState {
  switch (status) {
    case 'running':
      return 'running';
    case 'awaiting_gate':
    case 'waiting':
      return 'waiting';
    case 'completed':
    case 'done':
      return 'done';
    case 'failed':
    case 'error':
    case 'cancelled':
      return 'failed';
    case 'paused':
      return 'paused';
    default:
      return 'idle';
  }
}

export function getStatusLabelKey(status: string): string {
  switch (mapRunStatusToPill(status)) {
    case 'running':
      return 'bench.status.running';
    case 'waiting':
      return 'bench.status.waiting';
    case 'done':
      return 'bench.status.done';
    case 'failed':
      return 'bench.status.failed';
    case 'paused':
      return 'bench.status.paused';
    default:
      return 'bench.status.idle';
  }
}

const ROLE_TO_MARK: Record<Role, AgentRole> = {
  intake: 'orchestrator',
  researcher: 'debugger',
  pm: 'planner',
  designer: 'designer',
  architect: 'architect',
  coder: 'coder',
  reviewer: 'reviewer',
  qa: 'tester',
  security: 'security',
  release: 'releaser',
  marketer: 'scribe',
  feedback: 'verifier',
};

export function mapRoleToMark(role: Role): AgentRole {
  return ROLE_TO_MARK[role] ?? 'orchestrator';
}

export function formatUsd(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

export function formatCentsAsUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatEventTime(iso: string, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    numberingSystem: 'latn',
  }).format(date);
}

export function extractEventText(ev: WarshaEvent): string {
  const payload = ev.payload;
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const obj = payload as Record<string, unknown>;
    const keys = ['summary', 'message', 'note', 'idea', 'reason', 'output', 'text', 'action', 'artifact'];
    for (const key of keys) {
      const val = obj[key];
      if (typeof val === 'string' && val.length > 0) return val;
    }
  }
  return ev.kind;
}

export function aggregateRoleMetrics(
  events: readonly WarshaEvent[]
): Record<string, { costCents: number; tokens: number; latestKind: string | null }> {
  const out: Record<string, { costCents: number; tokens: number; latestKind: string | null }> = {};
  for (const ev of events) {
    if (!ev.role) continue;
    if (!out[ev.role]) {
      out[ev.role] = { costCents: 0, tokens: 0, latestKind: null };
    }
    if (typeof ev.costCents === 'number') {
      out[ev.role].costCents += ev.costCents;
    }
    if (typeof ev.payload === 'object' && ev.payload !== null && !Array.isArray(ev.payload)) {
      const obj = ev.payload as Record<string, unknown>;
      if (typeof obj.tokens === 'number' && Number.isFinite(obj.tokens)) {
        out[ev.role].tokens += obj.tokens;
      }
    }
    out[ev.role].latestKind = ev.kind;
  }
  return out;
}

export function aggregateStageCosts(events: readonly WarshaEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ev of events) {
    if (typeof ev.costCents === 'number' && ev.costCents > 0) {
      out[ev.stage] = (out[ev.stage] ?? 0) + ev.costCents;
    }
  }
  return out;
}

export function copyTextToClipboard(text: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

export function hasGateResumeCapability(capabilities: unknown): boolean {
  if (typeof window !== 'undefined') {
    const win = window as unknown as { __ENABLE_RESUME__?: boolean };
    if (win.__ENABLE_RESUME__ === true) return true;
  }
  if (typeof capabilities === 'object' && capabilities !== null) {
    const capMap = capabilities as Record<string, unknown>;
    return capMap['runs.resume'] === true;
  }
  return false;
}
