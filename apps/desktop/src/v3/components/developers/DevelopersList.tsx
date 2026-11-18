// apps/desktop/src/v3/components/developers/DevelopersList.tsx
// E4: the virtualised session table. Hand-rolled windowing (no new deps): only the
// rows around the scroll position render, so 10 000 sessions scroll without
// mounting 10 000 DOM nodes. Every column label comes from the i18n catalog and
// every layout value uses design tokens (ds-v3).
import type { Session } from '@warsha/client';
import { useT } from '@warsha/i18n/v3';
import React, { useCallback, useEffect, useRef, useState } from 'react';

export const ROW_HEIGHT = 40;
export const OVERSCAN = 5;

interface Props {
  sessions: Session[];
  depth?: number;
  onSelect?: (sessionId: string) => void;
  /** Per-session on-screen figures (cost/tokens labels), computed by the page. */
  figures?: Record<string, { action: string; elapsed: string; cost: string }>;
}

const DevelopersList: React.FC<Props> = ({ sessions, depth = 0, onSelect, figures }) => {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>): void => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      setContainerHeight(containerRef.current.clientHeight || 600);
    }
  }, []);

  const totalHeight = sessions.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    sessions.length,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN
  );

  const visibleSessions = sessions.slice(startIndex, endIndex);

  return (
    <div
      ref={containerRef}
      className="developers-list"
      data-testid="developers-list"
      onScroll={handleScroll}
      style={{ overflow: 'auto', position: 'relative' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }} data-testid="developers-list-body">
        {visibleSessions.map((session, index) => (
          <div
            key={session.id}
            data-testid="developers-row"
            role="button"
            tabIndex={0}
            data-action="developers.detail.nav"
            onClick={() => onSelect?.(session.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect?.(session.id);
            }}
            style={{
              position: 'absolute',
              insetInlineStart: 0,
              top: (startIndex + index) * ROW_HEIGHT,
              height: ROW_HEIGHT,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--w-space-2)',
              paddingInlineStart: depth === 0 ? 'var(--w-space-3)' : 'calc(var(--w-space-3) + var(--w-space-4))',
              borderBlockEnd: 'var(--w-border-width) solid var(--w-border)',
              cursor: 'pointer',
            }}
          >
            <span className="developers-cell" data-testid="developers-cell-role">{session.role}</span>
            <span className="developers-cell" data-testid="developers-cell-model">{session.model}</span>
            <span className="developers-cell" data-testid="developers-cell-provider">{session.provider}</span>
            <span className="developers-cell" data-testid="developers-cell-backend">{session.backend}</span>
            <span className="developers-cell" data-testid="developers-cell-status">{session.status}</span>
            <span className="developers-cell developers-cell-action" data-testid="developers-cell-action">
              {figures?.[session.id]?.action ?? t('developers.table.idle')}
            </span>
            <span className="developers-cell" data-testid="developers-cell-cost">
              {figures?.[session.id]?.cost ?? t('developers.unknown')}
            </span>
            <span className="developers-cell" data-testid="developers-cell-elapsed">
              {figures?.[session.id]?.elapsed ?? '0 s'}
            </span>
            <span className="developers-cell developers-cell-hint">{t('developers.detail.nav_hint')}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DevelopersList;
