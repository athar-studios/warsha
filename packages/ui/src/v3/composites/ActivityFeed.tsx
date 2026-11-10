// packages/ui/src/v3/composites/ActivityFeed.tsx — Design System v3 ActivityFeed (DS v3 §3.2)
// Event stream in plain sentences (Simple) or raw (Advanced). Live region polite, grouped by stage.

import React from 'react';

import { IconSparkle } from '../icons';

export interface ActivityEvent {
  id: string;
  time?: string;
  message: React.ReactNode;
  raw?: string;
  stageKey?: string;
  stageLabel?: string;
  icon?: React.ReactNode;
}

export interface ActivityFeedProps {
  events: ActivityEvent[];
  variant?: 'simple' | 'advanced';
  emptyLabel?: string;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

interface EventGroup {
  stageKey?: string;
  stageLabel?: string;
  events: ActivityEvent[];
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({
  events = [],
  variant = 'simple',
  emptyLabel = '',
  ariaLabel,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  // Group events by stage while preserving sequential order
  const groups = React.useMemo<EventGroup[]>(() => {
    const result: EventGroup[] = [];
    let currentGroup: EventGroup | null = null;

    for (const ev of events) {
      if (!currentGroup || currentGroup.stageKey !== ev.stageKey) {
        currentGroup = {
          stageKey: ev.stageKey,
          stageLabel: ev.stageLabel,
          events: [ev],
        };
        result.push(currentGroup);
      } else {
        currentGroup.events.push(ev);
      }
    }
    return result;
  }, [events]);

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label={ariaLabel}
      data-variant={variant}
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-activity-feed w-activity-feed--${variant} ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-4)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {events.length === 0 ? (
        <div
          style={{
            paddingBlock: 'var(--w-space-4)',
            textAlign: 'center',
            color: 'var(--w-text-muted)',
            fontSize: 'var(--w-font-size-sm)',
          }}
        >
          {emptyLabel}
        </div>
      ) : (
        groups.map((group, groupIdx) => (
          <div
            key={group.stageKey ?? `group-${groupIdx}`}
            className="w-activity-feed__group"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--w-space-2)',
            }}
          >
            {group.stageLabel && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--w-space-2)',
                  fontSize: 'var(--w-font-size-xs)',
                  fontWeight: 'var(--w-font-weight-semibold)',
                  color: 'var(--w-text-muted)',
                  textTransform: 'uppercase',
                  paddingBlock: 'var(--w-space-1)',
                  borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
                }}
              >
                <span>{group.stageLabel}</span>
              </div>
            )}

            <ol
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {group.events.map((ev) => (
                <li
                  key={ev.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--w-space-1)',
                    paddingBlock: 'var(--w-space-2)',
                    borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
                    fontSize: 'var(--w-font-size-sm)',
                    lineHeight: 'var(--w-line-height-sm)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 'var(--w-space-3)',
                    }}
                  >
                    {ev.time && (
                      <time
                        style={{
                          color: 'var(--w-text-faint)',
                          fontSize: 'var(--w-font-size-xs)',
                          fontFamily: 'var(--w-font-mono)',
                          direction: 'ltr',
                          flexShrink: 0,
                        }}
                      >
                        {ev.time}
                      </time>
                    )}

                    <span
                      aria-hidden="true"
                      style={{
                        color: 'var(--w-primary-text)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {ev.icon ?? <IconSparkle size={14} />}
                    </span>

                    <div style={{ flex: 1, color: 'var(--w-text)' }}>
                      {ev.message}
                    </div>
                  </div>

                  {variant === 'advanced' && ev.raw && (
                    <pre
                      dir="ltr"
                      style={{
                        margin: 0,
                        marginTop: 'var(--w-space-1)',
                        padding: 'var(--w-space-2)',
                        borderRadius: 'var(--w-radius-sm)',
                        backgroundColor: 'var(--w-sunken)',
                        fontFamily: 'var(--w-font-mono)',
                        fontSize: 'var(--w-font-size-xs)',
                        lineHeight: 'var(--w-line-height-xs)',
                        color: 'var(--w-text-muted)',
                        overflowX: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {ev.raw}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
    </div>
  );
};

ActivityFeed.displayName = 'ActivityFeed';
