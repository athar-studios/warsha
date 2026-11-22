// packages/ui/src/v3/composites/Gauge.tsx
import React from 'react';
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
    <div className={`gauge-container ${className ?? ''}`.trim()}>
      <div className={`gauge-bar ${statusClass}`.trim()} style={{ width: `${clamped}%` }} />
    </div>
  );
}
