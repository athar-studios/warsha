/**
 * Interview entry hint (D-RN-UI-R5).
 *
 * Home starts a secretary interview, then navigates to the project. The project page opens the
 * secretary sheet when `interview.status` says an interview exists, but that read can be refused
 * (the daemon rate limiter) or fail transiently, and the owner would land on a project with no
 * sheet. Home records the project here once `interview.start` succeeded; the project page opens
 * the sheet on that hint without waiting for the read (the sheet has its own retry control).
 */
const entered = new Set<string>();

export function markInterviewEntry(projectId: string): void {
  entered.add(projectId);
}

export function hasInterviewEntry(projectId: string): boolean {
  return entered.has(projectId);
}

export function clearInterviewEntry(projectId: string): void {
  entered.delete(projectId);
}
