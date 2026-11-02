// @warsha/remote — the pipeline, as the phone draws it.
//
// `Stage` is the daemon's own union (`@warsha/client`), and this is the order it walks it in — the same
// order the desktop's run view uses, restated here because the two apps may not import from each other
// (`docs/ARCHITECTURE.md`: each app depends on the shared packages, never on the other).
//
// The phone's run plate is a *pipeline plate* (docs/design/REDESIGN.md §5: "stage pipeline plate"), and
// `Ledger.Row`'s `state` is the shape it draws with: `✓` for a stage that is behind the run, `»` for the
// one it is on, `☐` for the ones still to come (§9: the glyph says it, the tint only helps).
import type { Stage } from '@warsha/client';

/** The pipeline in order, gates included. */
export const PIPELINE_STAGES: readonly Stage[] = [
  'idea',
  'gate_a',
  'research',
  'prd_spec',
  'gate_b',
  'design',
  'plan_tasks',
  'code',
  'review_qa_security',
  'gate_c',
  'release',
  'gate_d',
  'launch_drafts',
  'feedback',
];

/** Where a stage sits relative to the run's current stage. */
export type StagePosition = 'done' | 'running' | 'todo';

/**
 * The row state for one stage of a run.
 *
 * A stage the daemon names that this list does not know reads as `todo` rather than as an index of `-1`
 * propagating through the plate: an unknown position is "not reached yet" for everything behind it, and
 * claiming a stage is done that nothing reported done would be a lie about the owner's work.
 */
export function stagePosition(stage: Stage, current: Stage | null): StagePosition {
  if (current === null) return 'todo';
  const wanted = PIPELINE_STAGES.indexOf(stage);
  const now = PIPELINE_STAGES.indexOf(current);
  if (wanted === -1 || now === -1) return 'todo';
  if (wanted < now) return 'done';
  if (wanted === now) return 'running';
  return 'todo';
}

/** Is the run finished? A completed or failed run has nothing left to reach. */
export function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/** Every stage with its position — the plate's whole rows, in one pass. */
export function stageRows(
  current: Stage | null,
  status: string | null
): { stage: Stage; position: StagePosition }[] {
  const finished = status !== null && isTerminalStatus(status);
  return PIPELINE_STAGES.map((stage) => {
    if (finished) {
      // A run that stopped has no "running" stage: everything up to where it was is done, the rest is not.
      const wanted = PIPELINE_STAGES.indexOf(stage);
      const now = current === null ? -1 : PIPELINE_STAGES.indexOf(current);
      return { stage, position: wanted <= now ? 'done' : 'todo' };
    }
    return { stage, position: stagePosition(stage, current) };
  });
}
