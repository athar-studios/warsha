import type { McpCallEvent, WarshaEvent } from '@warsha/client';
import { decodeMcpCall, decodeRunFinished } from '@warsha/client';
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

  // The agent's MCP calls, rendered from the event rather than from a summary: the
  // event carries the server, the tool and the phase, and never the arguments, so
  // there is nothing to show but what was called and how it ended (R-EXT-2).
  const mcpCalls = events
    .map((ev) => ({ ev, call: decodeMcpCall(ev) }))
    .filter((row): row is { ev: WarshaEvent; call: McpCallEvent } => row.call !== null);

  // The kinds the terminal keeps, minus the MCP calls drawn above (an `allow_once`
  // answer is a `tool_call` too, and it keeps its place in the transcript).
  const terminalEvents = events.filter(
    (ev) =>
      (ev.kind === 'tool_call' && decodeMcpCall(ev) === null) ||
      ev.kind === 'tool_result' ||
      ev.kind === 'agent_step' ||
      ev.kind === 'error'
  );

  const finished = events
    .map((ev) => decodeRunFinished(ev))
    .filter((status): status is NonNullable<typeof status> => status !== null)
    .slice(-1)[0];

  const lines = terminalEvents.map((ev) => ({
    id: ev.id,
    content: extractEventText(ev),
    timestamp: formatEventTime(ev.createdAt, locale),
    stream: (ev.kind === 'error' ? 'stderr' : ev.kind === 'tool_call' ? 'system' : 'stdout') as
      'stdout' | 'stderr' | 'system',
  }));

  const isEmpty = lines.length === 0 && mcpCalls.length === 0 && finished === undefined;

  const handleCopy = () => {
    const calls = mcpCalls.map(
      ({ ev, call }) =>
        `[${formatEventTime(ev.createdAt, locale)}] ${call.server} · ${call.tool} — ${t(
          `events.tool_call.phase.${call.phase}`
        )}`
    );
    const raw = [...lines.map((l) => `[${l.timestamp}] ${l.content}`), ...calls].join('\n');
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

      {isEmpty ? (
        <EmptyState
          icon={<IconTerminal size={20} />}
          title={t('bench.terminal.empty')}
          data-testid="bench-terminal-empty"
        />
      ) : (
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-2)' }}
          data-testid="bench-terminal-body"
        >
          {mcpCalls.length > 0 && (
            <ol
              data-testid="bench-terminal-mcp-calls"
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--w-space-1)',
                fontFamily: 'var(--w-font-mono)',
                fontSize: 'var(--w-font-size-sm)',
                color: 'var(--w-text)',
              }}
            >
              {mcpCalls.map(({ ev, call }) => (
                <li
                  key={ev.id}
                  data-testid="bench-terminal-mcp-call"
                  data-phase={call.phase}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--w-space-1)' }}
                >
                  <span dir="ltr">{call.server}</span>
                  <span aria-hidden="true">·</span>
                  <span dir="ltr">{call.tool}</span>
                  <span aria-hidden="true">—</span>
                  <span>{t(`events.tool_call.phase.${call.phase}`)}</span>
                  {call.phase === 'approval_required' && (
                    <span data-testid="bench-terminal-mcp-answer-inbox">
                      {t('events.tool_call.answer_inbox')}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}

          {finished !== undefined && (
            <p
              data-testid="bench-terminal-run-finished"
              data-status={finished}
              dir="auto"
              style={{
                margin: 0,
                fontSize: 'var(--w-font-size-sm)',
                fontWeight: 'var(--w-font-weight-semibold)',
                color: finished === 'completed' ? 'var(--w-success)' : 'var(--w-danger)',
              }}
            >
              {t(`events.run_finished.${finished}`)}
            </p>
          )}

          {lines.length > 0 && (
            <Transcript
              lines={lines}
              title={t('bench.terminal.title')}
              autoScroll={follow}
              data-testid="bench-terminal-transcript"
            />
          )}
        </div>
      )}
    </div>
  );
};

TerminalTab.displayName = 'TerminalTab';
