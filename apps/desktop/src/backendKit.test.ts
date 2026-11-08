import type { ProjectId, ProjectSummary, RunId, RunSummary } from '@warsha/client';
import { describe, expect, it } from 'vitest';

import { deriveBackendOutputDir } from './backendKit';

const project: ProjectSummary = {
  id: 'proj-1' as ProjectId,
  name: 'shop',
  createdAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
};

const run: RunSummary = {
  id: 'run-1' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'code',
  status: 'running',
  startedAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
};

describe('deriveBackendOutputDir', () => {
  it('returns nothing without a project or without a run', () => {
    expect(deriveBackendOutputDir(null, run)).toBeNull();
    expect(deriveBackendOutputDir(project, null)).toBeNull();
    expect(deriveBackendOutputDir(null, null)).toBeNull();
  });

  it('returns nothing even with both records: neither decoded summary carries a directory', () => {
    expect(deriveBackendOutputDir(project, run)).toBeNull();
  });
});
