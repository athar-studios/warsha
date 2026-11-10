import type { WarshaEvent } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useLocale, useT } from '@warsha/i18n/v3';
// eslint-disable-next-line import/no-unresolved
import { Button, EmptyState, IconClock, IconCopy, IconTerminal, Transcript } from '@warsha/ui/v3';
import React, { useState } from 'react';

import { copyTextToClipboard, extractEventText, formatEventTime } from '../helpers';

export interface TerminalTabProps {
  events: WarshaEvent[];
}

export const TerminalTab: React.FC<TerminalTabProps> = ({ events }) => {
  const t = useT();
  const { locale } = useLocale();
  const [follow, setFollow] = useState(true);

  const terminalEvents = events.filter(
    (ev) =>
      ev.kind === 'tool_call' ||
      ev.kind === 'tool_result' ||
      ev.kind === 'agent_step' ||
      ev.kind === 'error'
  );

  const lines = terminalEvents.map((ev) => ({
    id: ev.id,
    content: extractEventText(ev),
    timestamp: formatEventTime(ev.createdAt, locale),
    stream: (ev.kind === 'error'
      ? 'stderr'
      : ev.kind === 'tool_call'
      ? 'system'
      : 'stdout') as 'stdout' | 'stderr' | 'system',
  }));

  const handleCopy = () => {
    const raw = lines.map((l) => `[${l.timestamp}] ${l.content}`).join('\n');
    copyTextToClipboard(raw);
  };

  return (
    <div
      role="tabpanel"
      id="bench-panel-terminal"
      aria-labelledby="bench-tab-terminal"
      data-testid="bench-tabpanel-terminal"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-3)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--w-space-2)',
          flexWrap: 'wrap',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--w-font-size-md)',
            fontWeight: 'var(--w-font-weight-semibold)',
            color: 'var(--w-text)',
          }}
        >
          {t('bench.terminal.title')}
        </h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w-space-2)' }}>
          <Button
            variant={follow ? 'secondary' : 'ghost'}
            size="sm"
            icon={<IconClock size={14} />}
            aria-pressed={follow}
            onClick={() => setFollow((prev) => !prev)}
            data-action="bench.terminal.follow"
            data-testid="bench-terminal-follow-btn"
          >
            {follow ? t('bench.terminal.following') : t('bench.terminal.follow')}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            icon={<IconCopy size={14} />}
            onClick={handleCopy}
            data-action="bench.terminal.copy"
            data-testid="bench-terminal-copy-btn"
          >
            {t('bench.action.terminal_copy')}
          </Button>
        </div>
      </div>

      {lines.length === 0 ? (
        <EmptyState
          icon={<IconTerminal size={20} />}
          title={t('bench.terminal.empty')}
          data-testid="bench-terminal-empty"
        />
      ) : (
        <Transcript
          lines={lines}
          title={t('bench.terminal.title')}
          autoScroll={follow}
          data-testid="bench-terminal-transcript"
        />
      )}
    </div>
  );
};

TerminalTab.displayName = 'TerminalTab';
