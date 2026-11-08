// The directory `backend.export` may write into, derived only from records the app already holds.
//
// There is none today: `@warsha/client` deliberately decodes `warsha_core::Project` down to its
// summary (no `repo_path`), and `Run` carries no path at all. The brief forbids adding a file-dialog
// plugin, so the honest answer is `null` and the panel states why instead of guessing a path.
import type { ProjectSummary, RunSummary } from '@warsha/client';

export function deriveBackendOutputDir(
  project: ProjectSummary | null,
  run: RunSummary | null
): string | null {
  if (project === null || run === null) return null;
  return null;
}
