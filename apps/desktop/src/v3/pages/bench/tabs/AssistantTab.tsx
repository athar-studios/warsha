import type { AgentModeName, AgentState, AgentTodo, AgentTurn } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  IconCheck,
  IconLock,
  IconSend,
  IconSparkle,
  Skeleton,
  TextArea,
// eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React, { useEffect, useState } from 'react';

import type { AssistantMessage } from '../types';

export interface AssistantTabProps {
  agentState: AgentState | null;
  status: 'loading' | 'empty' | 'error' | 'ready';
  onSendTurn: (input: string) => Promise<AgentTurn | undefined>;
  sendPending?: boolean;
  onSwitchToPlan: () => Promise<void> | void;
  planPending?: boolean;
  onSwitchToAgent: () => Promise<void> | void;
  agentPending?: boolean;
  onReload: () => void;
}

export const AssistantTab: React.FC<AssistantTabProps> = ({
  agentState,
  status,
  onSendTurn,
  sendPending = false,
  onSwitchToPlan,
  planPending = false,
  onSwitchToAgent,
  agentPending = false,
  onReload,
}) => {
  const t = useT();

  const [mode, setMode] = useState<AgentModeName>(agentState?.mode ?? 'plan');
  const [todos, setTodos] = useState<AgentTodo[]>(agentState?.todos ?? []);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [turnError, setTurnError] = useState<string | null>(null);

  useEffect(() => {
    if (agentState) {
      setMode(agentState.mode);
      setTodos(agentState.todos);
    }
  }, [agentState]);

  const handleSwitchPlan = async () => {
    setTurnError(null);
    await onSwitchToPlan();
    setMode('plan');
  };

  const handleSwitchAgent = async () => {
    setTurnError(null);
    await onSwitchToAgent();
    setMode('agent');
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || sendPending) return;
    setTurnError(null);
    const userMsg: AssistantMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    try {
      const turn = await onSendTurn(trimmed);
      if (turn) {
        setMode(turn.mode);
        setTodos(turn.todos);
        const replyMsg: AssistantMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: turn.response,
          timestamp: new Date().toISOString(),
          todos: turn.todos,
          tools: turn.tools.map((tool) => ({
            success: tool.success,
            output: tool.output,
          })),
        };
        setMessages((prev) => [...prev, replyMsg]);
      }
    } catch (err) {
      setTurnError(err instanceof Error ? err.message : String(err));
    }
  };

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
        <Skeleton height="var(--w-space-8)" />
        <Skeleton height="var(--w-space-10)" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <Banner
        variant="danger"
        action={
          <Button variant="secondary" size="sm" onClick={onReload} data-action="bench.stream.reconnect">
            {t('bench.retry')}
          </Button>
        }
      >
        {t('bench.error')}
      </Banner>
    );
  }

  return (
    <div
      role="tabpanel"
      id="bench-panel-assistant"
      aria-labelledby="bench-tab-assistant"
      data-testid="bench-tabpanel-assistant"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-4)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--w-space-3)',
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
          {t('bench.assistant.title')}
        </h2>

        <div
          role="group"
          aria-label={t('bench.assistant.title')}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--w-space-2)' }}
        >
          <Button
            variant={mode === 'plan' ? 'secondary' : 'ghost'}
            size="sm"
            icon={<IconLock size={14} />}
            loading={planPending}
            aria-pressed={mode === 'plan'}
            onClick={() => void handleSwitchPlan()}
            data-action="bench.assistant.mode.plan"
            data-testid="bench-assistant-mode-plan-btn"
          >
            {t('bench.action.assistant_mode_plan')}
          </Button>

          <Button
            variant={mode === 'agent' ? 'secondary' : 'ghost'}
            size="sm"
            icon={<IconCheck size={14} />}
            loading={agentPending}
            aria-pressed={mode === 'agent'}
            onClick={() => void handleSwitchAgent()}
            data-action="bench.assistant.mode.agent"
            data-testid="bench-assistant-mode-agent-btn"
          >
            {t('bench.action.assistant_mode_agent')}
          </Button>
        </div>
      </div>

      <Banner variant={mode === 'agent' ? 'attention' : 'info'}>
        {mode === 'agent'
          ? t('bench.assistant.agent_notice')
          : t('bench.assistant.plan_notice')}
      </Banner>

      {agentState && !agentState.model_wired && (
        <Banner variant="attention">{t('bench.assistant.model_unwired')}</Banner>
      )}

      {turnError && <Banner variant="danger">{turnError}</Banner>}

      <Card style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
        {messages.length === 0 ? (
          <EmptyState
            icon={<IconSparkle size={20} />}
            title={t('bench.assistant.empty')}
            style={{ paddingBlock: 'var(--w-space-4)' }}
          />
        ) : (
          <ul
            data-testid="bench-assistant-messages"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--w-space-3)',
            }}
          >
            {messages.map((msg) => (
              <li
                key={msg.id}
                data-msg-role={msg.role}
                style={{
                  padding: 'var(--w-space-3)',
                  borderRadius: 'var(--w-radius-md)',
                  backgroundColor:
                    msg.role === 'user' ? 'var(--w-primary-soft)' : 'var(--w-sunken)',
                  color: 'var(--w-text)',
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '90%',
                }}
              >
                <div
                  dir="auto"
                  style={{
                    whiteSpace: 'pre-wrap',
                    fontSize: 'var(--w-font-size-md)',
                    lineHeight: 'var(--w-line-height-md)',
                  }}
                >
                  {msg.content}
                </div>

                {msg.tools && msg.tools.length > 0 && (
                  <div
                    style={{
                      marginTop: 'var(--w-space-2)',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 'var(--w-space-1)',
                    }}
                  >
                    {msg.tools.map((tool, tIdx) => (
                      <Badge key={tIdx} variant={tool.success ? 'primary' : 'attention'}>
                        <bdi dir="ltr">{tool.output}</bdi>
                      </Badge>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-2)' }}>
          <TextArea
            label={t('bench.assistant.title')}
            placeholder={t('bench.assistant.placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onEnter={() => void handleSend()}
            rows={2}
            data-testid="bench-assistant-input"
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="secondary"
              size="sm"
              iconEnd={<IconSend size={14} />}
              loading={sendPending}
              disabled={!input.trim() || sendPending}
              onClick={() => void handleSend()}
              data-action="bench.assistant.send"
              data-testid="bench-assistant-send-btn"
            >
              {t('bench.assistant.send')}
            </Button>
          </div>
        </div>
      </Card>

      {todos.length > 0 && (
        <Card title={t('bench.assistant.todos_title')}>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--w-space-2)',
            }}
          >
            {todos.map((todo) => (
              <li
                key={todo.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--w-space-2)',
                  paddingBlock: 'var(--w-space-1)',
                }}
              >
                <span style={{ fontSize: 'var(--w-font-size-sm)' }}>{todo.description}</span>
                <Badge variant={todo.status === 'done' ? 'primary' : 'neutral'}>
                  {t(`bench.assistant.todo_${todo.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};

AssistantTab.displayName = 'AssistantTab';
