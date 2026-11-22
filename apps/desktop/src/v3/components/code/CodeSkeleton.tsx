import { Skeleton } from '@warsha/ui/v3';
import React from 'react';

/** The code screen's one loading shape: a path line and a block of code lines, announced once. */
export const CodeSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <div className="v3-code-skeleton" role="status" aria-label={label} data-testid="code-viewer-loading">
    <Skeleton variant="text" width="40%" />
    <Skeleton width="100%" height="calc(var(--w-space-10) * 4)" />
  </div>
);
