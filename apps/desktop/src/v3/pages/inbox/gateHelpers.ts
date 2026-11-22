import type { GateSummary, RunSummary } from '@warsha/client';

/**
 * Pure helpers shared by the Inbox and the project inspector. They live here, not in a page
 * module, so both screens read one implementation and neither imports the other's page.
 */

export function extractGateCode(stage: string): 'a' | 'b' | 'c' | 'd' {
  if (stage === 'gate_a') return 'a';
  if (stage === 'gate_b') return 'b';
  if (stage === 'gate_c') return 'c';
  if (stage === 'gate_d') return 'd';
  return 'a';
}

export function formatTime24(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${mins}`;
}

export function findPendingGateAtCurrentStage(
  gates: readonly GateSummary[] | null | undefined,
  run: RunSummary | null
): GateSummary | null {
  if (!run || !gates || gates.length === 0) return null;
  if (run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed') {
    return null;
  }
  const match = gates.find((g) => g.stage === run.stage && g.state.state === 'pending');
  return match ?? null;
}
