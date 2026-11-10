// packages/ui/src/v3/primitives/RoleMark.tsx — Design System v3 RoleMark (DS v3 §3.1)
// 12 agent roles: Arabic name + icon. Decorative icon aria-hidden="true".

import React from 'react';

import {
  IconAlert,
  IconCalendar,
  IconCheck,
  IconCode,
  IconCpu,
  IconEdit,
  IconEye,
  IconLock,
  IconSend,
  IconSparkle,
  IconTerminal,
  IconUsers,
} from '../icons';

export type AgentRole =
  | 'planner'
  | 'architect'
  | 'coder'
  | 'reviewer'
  | 'verifier'
  | 'tester'
  | 'security'
  | 'releaser'
  | 'orchestrator'
  | 'debugger'
  | 'scribe'
  | 'designer';

export interface RoleMarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  role: AgentRole;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  'data-action'?: string;
  'data-testid'?: string;
}

export const ROLE_CONFIG: Record<
  AgentRole,
  { label: string; icon: React.ReactNode }
> = {
  planner: { label: 'المخطط', icon: <IconCalendar size={16} /> },
  architect: { label: 'المعماري', icon: <IconCpu size={16} /> },
  coder: { label: 'المبرمج', icon: <IconCode size={16} /> },
  reviewer: { label: 'المراجع', icon: <IconEye size={16} /> },
  verifier: { label: 'الفاحص', icon: <IconCheck size={16} /> },
  tester: { label: 'المختبر', icon: <IconTerminal size={16} /> },
  security: { label: 'الأمني', icon: <IconLock size={16} /> },
  releaser: { label: 'المُطلق', icon: <IconSend size={16} /> },
  orchestrator: { label: 'المنسق', icon: <IconUsers size={16} /> },
  debugger: { label: 'المصحح', icon: <IconAlert size={16} /> },
  scribe: { label: 'الموثق', icon: <IconEdit size={16} /> },
  designer: { label: 'المصمم', icon: <IconSparkle size={16} /> },
};

export const RoleMark: React.FC<RoleMarkProps> = ({
  role,
  showLabel = true,
  size = 'md',
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
  ...rest
}) => {
  const config = ROLE_CONFIG[role];

  return (
    <span
      data-role={role}
      className={`w-role-mark w-role-mark--${role} w-role-mark--${size} ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--w-space-1)',
        paddingBlock: 'var(--w-space-1)',
        paddingInline: 'var(--w-space-2)',
        borderRadius: 'var(--w-radius-sm)',
        backgroundColor: 'var(--w-sunken)',
        color: 'var(--w-text)',
        fontSize: size === 'sm' ? 'var(--w-font-size-xs)' : 'var(--w-font-size-sm)',
        lineHeight: size === 'sm' ? 'var(--w-line-height-xs)' : 'var(--w-line-height-sm)',
        fontFamily: 'var(--w-font-sans)',
        fontWeight: 'var(--w-font-weight-medium)',
        ...style,
      }}
      data-action={dataAction}
      data-testid={dataTestId}
      {...rest}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>
        {config.icon}
      </span>
      {showLabel && <span>{config.label}</span>}
    </span>
  );
};

RoleMark.displayName = 'RoleMark';
