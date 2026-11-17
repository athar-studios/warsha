// packages/ui/src/v3/composites/Gauge.tsx
import React from 'react';
import { clsx } from 'clsx';
import './Gauge.css';

export type GaugeStatus = 'green' | 'amber' | 'red';

export interface GaugeProps {
  percentage: number; // 0-100
  status?: GaugeStatus;
  className?: string;
}

export function Gauge({ percentage, status, className }: GaugeProps): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, percentage));
  const statusClass = status ? `gauge--${status}` : 'gauge--default';
  
  return (
    <div className={clsx('gauge-container', className)}>
      <div className={clsx('gauge-bar', statusClass)} style={{ width: `${clamped}%` }} />
    </div>
  );
}
