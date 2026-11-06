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
}

export function SettingsScopeSentence({
  project,
  className = '',
  dir = 'auto',
}: SettingsScopeSentenceProps) {
  const isGlobal = !project;
  const projectName = project?.name ?? '';

  // We use a local i18n call through the consumer; the component receives the
  // already-translated strings as children would, but here we keep it simple
  // and let the consumer pass the label and hint. However, the t3code pattern
  // shows a self-contained component, so we use a small trick: the consumer
  // can pass a `t` function via context, but for now we'll expect the label
  // and hint to be passed as props when i18n is not directly available.
  //
  // Actually, looking at other compounds like Lamp, they don't use i18n directly
  // either - the label comes from the consumer. So we'll follow that pattern
  // and make this a purely presentational component that receives the strings.

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
          <span style={{ fontSize: fontSize('sm') }}>🌐</span>
          <span data-testid="settings-scope-label">{'All projects'}</span>
        </>
      ) : (
        <>
          <span style={{ fontSize: fontSize('sm') }}>📁</span>
          <span data-testid="settings-scope-label">{`Current project: ${projectName}`}</span>
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
        {isGlobal ? 'This setting applies to all projects.' : 'This setting applies to the selected project only.'}
      </span>
    </span>
  );
}