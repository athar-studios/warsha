// @warsha/ui — SettingsScopeSentence compound
//
// Shows whether a settings screen applies globally ("All projects") or to a specific
// project ("Current project: {name}"). This is the t3code pattern for making scope
// visible at a glance so the owner never wonders which layer they're editing.
//
// The sentence is a single inline element: an icon (global vs project), the scope label,
// and a subtle hint that explains the implication. It lives in the screen's header area,
// above the first ruled section, and uses only token values.

import React from 'react';

import { type TextProps } from '../components';
import { colorVar, radius, space, fontSize, fontWeight } from '../tokens';

export interface SettingsScopeSentenceProps {
  /** The project this screen is scoped to, or `null`/`undefined` for global settings. */
  project: { id: string; name: string } | null | undefined;
  /** Optional custom className for positioning. */
  className?: string;
  /** Optional dir prop for RTL support. */
  dir?: TextProps['dir'];
  /**
   * The global scope's label, when the consumer passes catalog strings (DS v2 §6, D9). Defaults to
   * today's English so the rendered pixels do not move; Phase B passes the catalog value.
   */
  globalLabel?: string;
  /** The project scope's label, as a function of the project name; same contract as `globalLabel`. */
  projectLabel?: (projectName: string) => string;
  /** The global scope's hint; same contract as `globalLabel`. */
  globalHint?: string;
  /** The project scope's hint; same contract as `globalLabel`. */
  projectHint?: string;
}

export function SettingsScopeSentence({
  project,
  className = '',
  dir = 'auto',
  globalLabel = 'All projects',
  projectLabel = (projectName: string) => `Current project: ${projectName}`,
  globalHint = 'This setting applies to all projects.',
  projectHint = 'This setting applies to the selected project only.',
}: SettingsScopeSentenceProps) {
  const isGlobal = !project;
  const projectName = project?.name ?? '';

  return (
    <span
      dir={dir}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: space(1.5),
        paddingInline: space(2),
        paddingBlock: space(1),
        borderRadius: radius('sm'),
        backgroundColor: isGlobal ? colorVar('accent') : colorVar('surfaceMuted'),
        color: isGlobal ? colorVar('accentInk') : colorVar('textMuted'),
        fontSize: fontSize('xs'),
        fontWeight: fontWeight('medium'),
        whiteSpace: 'nowrap',
      }}
    >
      {isGlobal ? (
        <>
          {/* Decorative: the label already says "global", so the glyph must not be read twice. */}
          <span aria-hidden="true" style={{ fontSize: fontSize('sm') }}>🌐</span>
          <span data-testid="settings-scope-label">{globalLabel}</span>
        </>
      ) : (
        <>
          <span aria-hidden="true" style={{ fontSize: fontSize('sm') }}>📁</span>
          <span data-testid="settings-scope-label">{projectLabel(projectName)}</span>
        </>
      )}
      <span
        data-testid="settings-scope-hint"
        style={{
          opacity: 0.7,
          fontWeight: fontWeight('normal'),
          fontSize: fontSize('xs'),
        }}
      >
        {isGlobal ? globalHint : projectHint}
      </span>
    </span>
  );
}