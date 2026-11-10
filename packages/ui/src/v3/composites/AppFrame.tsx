// packages/ui/src/v3/composites/AppFrame.tsx — Design System v3 AppFrame (DS v3 §3.2)
// Top bar + optional side nav + main. Landmarks: header, nav, main; skip link first.
// Supports density: 'comfortable' | 'compact'.

import React from 'react';

export interface AppFrameProps {
  topBar: React.ReactNode;
  sideNav?: React.ReactNode;
  children: React.ReactNode;
  skipLabel?: string;
  mainId?: string;
  navLabel?: string;
  density?: 'comfortable' | 'compact';
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const AppFrame: React.FC<AppFrameProps> = ({
  topBar,
  sideNav,
  children,
  skipLabel,
  mainId = 'main',
  navLabel,
  density = 'comfortable',
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const [skipFocused, setSkipFocused] = React.useState(false);

  return (
    <div
      data-density={density}
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-app-frame ${className}`.trim()}
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--w-bg)',
        color: 'var(--w-text)',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {skipLabel && (
        <a
          href={`#${mainId}`}
          className="w-app-frame__skip"
          onFocus={() => setSkipFocused(true)}
          onBlur={() => setSkipFocused(false)}
          style={{
            position: 'absolute',
            insetBlockStart: 'var(--w-space-2)',
            insetInlineStart: 'var(--w-space-2)',
            zIndex: 'var(--w-layer-toast)',
            paddingBlock: 'var(--w-space-2)',
            paddingInline: 'var(--w-space-4)',
            backgroundColor: 'var(--w-primary)',
            color: 'var(--w-on-primary)',
            borderRadius: 'var(--w-radius-sm)',
            fontWeight: 'var(--w-font-weight-semibold)',
            textDecoration: 'none',
            outlineOffset: 'var(--w-space-1)',
            clip: skipFocused ? 'auto' : 'rect(0, 0, 0, 0)',
            width: skipFocused ? 'auto' : '1',
            height: skipFocused ? 'auto' : '1',
            overflow: skipFocused ? 'visible' : 'hidden',
          }}
        >
          {skipLabel}
        </a>
      )}

      <header className="w-app-frame__header">{topBar}</header>

      <div
        className="w-app-frame__body"
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
        }}
      >
        {sideNav && (
          <nav
            aria-label={navLabel}
            className="w-app-frame__nav"
            style={{
              width: 'var(--w-nav-width)',
              flexShrink: 0,
              borderInlineEnd: 'var(--w-border-width) solid var(--w-line)',
              backgroundColor: 'var(--w-surface)',
              overflowY: 'auto',
            }}
          >
            {sideNav}
          </nav>
        )}

        <main
          id={mainId}
          tabIndex={-1}
          className="w-app-frame__main"
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            outline: 'none',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
};

AppFrame.displayName = 'AppFrame';
