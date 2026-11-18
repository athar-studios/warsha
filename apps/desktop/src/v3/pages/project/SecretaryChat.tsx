// E2: the secretary chat panel — the owner's conversation over daemon records.
//
// Every answer the secretary gives is one of two things: words, or a structured
// PROPOSAL. A proposal never acts by itself — the only thing that performs it is
// the confirm button on this panel, which calls the same RPC the owner would call
// from the desktop surface, with the owner's own credential, and the daemon's
// receipt then records the confirmation came from the secretary thread. A proposal
// that does not reference an owner message in the same thread is refused here
// before any RPC: unquoted instruction content must not move the owner's money.
import type {
  CostEstimate,
  ProposalAction,
  RunId,
  SecretaryThread,
  SecretaryTurn,
  Stage,
} from '@warsha/client';
import { t as translate } from '@warsha/i18n';
/* eslint-disable import/no-unresolved */
import { Banner, Button, Skeleton } from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useClient } from '../../app/ClientContext';
import type { WarshaClient } from '@warsha/client';

/** The wire `refs_owner_message` is the injection gate; the label is for the owner. */
interface ProposalCardProps {
  proposal: { label: string; action: ProposalAction; turnId: string } | null;
  refsOwnerMessage: string | null;
  turns: readonly SecretaryTurn[];
  t: (key: string, params?: Record<string, string | number>) => string;
  onConfirm: (proposal: { label: string; action: ProposalAction; turnId: string }) => void;
  onDismiss: () => void;
  estimate: CostEstimate | null;
  estimateState: 'idle' | 'loading' | 'ready' | 'failed';
}

/** The one button that performs the proposal, labelled with what the secretary proposed. */
export function ProposalCard(props: ProposalCardProps): React.ReactElement | null {
  const { proposal, refsOwnerMessage, turns, t, onConfirm, onDismiss, estimate, estimateState } = props;
  if (proposal === null) return null;
  const blocked = refsOwnerMessage === null || !turns.some((turn) => turn.id === refsOwnerMessage);
  return (
    <div className="v3-secretary-proposal" data-testid="secretary-proposal-card">
      <div className="v3-secretary-proposal-title">{t('secretary.proposal.title')}</div>
      <div className="v3-secretary-proposal-label">{proposal.label}</div>
      {blocked ? (
        <Banner variant="danger">{t('secretary.proposal.needs_ref')}</Banner>
      ) : (
        <>
          {proposal.action.type === 'run_start' && estimateState === 'loading' && (
            <div className="v3-secretary-estimate">{t('secretary.proposal.estimate_loading')}</div>
          )}
          {proposal.action.type === 'run_start' && estimateState === 'ready' && estimate !== null && (
            <div className="v3-secretary-estimate" data-testid="secretary-estimate">
              {t('secretary.proposal.estimate_line', {
                min: String(estimate.minCents / 100),
                max: String(estimate.maxCents / 100),
              })}
            </div>
          )}
          <div className="v3-secretary-proposal-actions">
            <Button
              variant="primary"
              size="sm"
              data-action="secretary.confirm"
              data-testid="secretary-confirm"
              onClick={() => onConfirm(proposal)}
            >
              {t('secretary.proposal.confirm')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              data-action="secretary.proposal.dismiss"
              data-testid="secretary-dismiss"
              onClick={onDismiss}
            >
              {t('secretary.proposal.dismiss')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export interface SecretaryChatProps {
  /** The project thread to open on mount, or `null` for the global thread. */
  projectId: ProjectId | null;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Closes the host sheet after a confirmed action, when the host wants that. */
  onConfirmed?: () => void;
}

type ProjectId = Parameters<WarshaClient['startRun']>[0];

/** The chat body: thread switcher (global / this project), turns, input, proposal card. */
export default function SecretaryChat({
  projectId,
  t,
  onConfirmed,
}: SecretaryChatProps): React.ReactElement {
  const contextClient = useClient() as WarshaClient | null;

  const [threads, setThreads] = useState<SecretaryThread[]>([]);
  const [scope, setScope] = useState<'global' | 'project'>(
    projectId === null ? 'global' : 'project'
  );
  const [turns, setTurns] = useState<SecretaryTurn[]>([]);
  const [turnsState, setTurnsState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedNote, setConfirmedNote] = useState(false);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [estimateState, setEstimateState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [dismissedTurnIds, setDismissedTurnIds] = useState<Set<string>>(new Set());

  const tailRef = useRef<HTMLDivElement | null>(null);

  const activeThread = useCallback(
    (list: readonly SecretaryThread[]): SecretaryThread | null => {
      if (scope === 'global') return list.find((row) => row.projectId === null) ?? null;
      return list.find((row) => row.projectId !== null && row.projectId === projectId) ?? null;
    },
    [scope, projectId]
  );

  const threadId = turns.length > 0 ? turns[0]?.conversationId ?? null : null;

  // The thread list, read once per mount (and whenever the switcher flips).
  useEffect(() => {
    if (contextClient === null) return undefined;
    let cancelled = false;
    contextClient
      .listSecretaryThreads()
      .then((list) => {
        if (cancelled) return;
        setThreads(list);
      })
      .catch(() => {
        if (cancelled) return;
        setThreads([]);
      });
    return () => {
      cancelled = true;
    };
  }, [contextClient]);

  const turnThreadId = activeThread(threads)?.id ?? null;

  // The turns of the active thread; a thread the daemon has not created yet just reads empty.
  useEffect(() => {
    if (contextClient === null) return undefined;
    if (turnThreadId === null) {
      setTurns([]);
      setTurnsState('ready');
      return undefined;
    }
    let cancelled = false;
    setTurnsState('loading');
    contextClient
      .getSecretaryTurns(turnThreadId)
      .then((rows) => {
        if (cancelled) return;
        setTurns(rows);
        setTurnsState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setTurnsState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [contextClient, turnThreadId]);

  // The pre-run estimate only has a job on a run_start proposal: read it when one appears.
  const lastProposal = getLastProposal(turns);
  const lastProposalTurnId = lastProposal ? lastProposal.turnId : null;
  const lastProposalActionType = lastProposal ? lastProposal.action.type : null;
  const lastProposalIdea = lastProposal && lastProposal.action.type === 'run_start' ? lastProposal.action.idea : null;
  const visibleProposal = lastProposal && !dismissedTurnIds.has(lastProposal.turnId) ? lastProposal : null;

  useEffect(() => {
    if (contextClient === null) return undefined;
    const estimateProjectId = lastProposal?.action.type === 'run_start' ? lastProposal.action.projectId : projectId;
    if (estimateProjectId === null) {
      setEstimate(null);
      setEstimateState('idle');
      return undefined;
    }
    if (lastProposal === null || lastProposalActionType !== 'run_start') {
      setEstimate(null);
      setEstimateState('idle');
      return undefined;
    }
    let cancelled = false;
    setEstimateState('loading');
    contextClient
      .estimateRun(estimateProjectId, lastProposalIdea!)
      .then((answer) => {
        if (cancelled) return;
        setEstimate(answer);
        setEstimateState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setEstimate(null);
        setEstimateState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [contextClient, projectId, lastProposalTurnId, lastProposalActionType, lastProposalIdea]);

  // Keep the owner's eye at the newest turn.
  useEffect(() => {
    // jsdom has no scrollIntoView; the panel works without it there too.
    if (tailRef.current !== null && typeof tailRef.current.scrollIntoView === 'function') {
      tailRef.current.scrollIntoView({ block: 'end' });
    }
  }, [turns.length, sending]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (contextClient === null || text === '' || sending) return;
    setSending(true);
    setError(null);
    try {
      const reply = await contextClient.secretaryChat(
        scope === 'project' ? projectId : null,
        activeThread(threads)?.id ?? null,
        text
      );
      // The daemon's own row is the truth: read this thread again instead of splicing.
      setThreads((previous) => {
        const without = previous.filter((row) => row.id !== reply.conversationId);
        // A chat reply names only its conversation: the scope's own project id is
        // what a project-thread row carries (the daemon keys threads by scope).
        const scopeProject = scope === 'project' ? projectId : null;
        if (scopeProject !== null || scope === 'global') {
          return [
            {
              id: reply.conversationId,
              projectId: scopeProject,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            ...without,
          ];
        }
        return without;
      });
      setInput('');
      const rows = await contextClient.getSecretaryTurns(reply.conversationId).catch(() => []);
      setTurns(rows);
      setTurnsState('ready');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '';
      setError(
        message.toLowerCase().includes('daily limit') || message.toLowerCase().includes('cap')
          ? t('secretary.cap')
          : t('secretary.error')
      );
    } finally {
      setSending(false);
    }
  }, [contextClient, input, sending, scope, projectId, threads, activeThread, t]);

  const onDismiss = useCallback((turnId: string) => {
    setDismissedTurnIds((prev) => new Set(prev).add(turnId));
  }, []);
  const [confirmed, setConfirmed] = useState(false);
  const confirm = useCallback(
    (proposal: { label: string; action: ProposalAction; turnId: string }) => {
      if (contextClient === null || confirmed) return;
      setConfirmed(true);
      const action = proposal.action;
      const finish = (): void => {
        setConfirmedNote(true);
        if (onConfirmed !== undefined) onConfirmed();
      };
      const run = (promise: Promise<unknown>): void => {
        promise.then(finish).catch((e) => {
          setError(t('secretary.error'));
          setConfirmed(false);
        });
      };
      if (action.type === 'gate_approve') {
        run(contextClient.approveGate(action.runId as RunId, action.stage as Stage));
      } else if (action.type === 'gate_reject') {
        run(contextClient.rejectGate(action.runId as RunId, action.stage as Stage, action.reason));
      } else if (action.type === 'queue_decide') {
        if (action.allow) {
          run(contextClient.mcpAllowOnce(action.questionId));
        } else {
          setError(t('secretary.refused'));
          setConfirmed(false);
        }
      } else if (action.type === 'run_start') {
        run(contextClient.startRun(action.projectId, action.idea));
      } else if (action.type === 'run_cancel') {
        run(contextClient.cancelRun(action.runId as RunId, 'secretary confirmed'));
      }
    },
    [contextClient, onConfirmed, t, confirmed]
  );
  
  // Reset confirmed state when new proposal arrives or on mount
  useEffect(() => {
    setConfirmed(false);
  }, [lastProposal?.turnId]);

  const scopeKey = scope === 'global' ? 'secretary.global' : 'secretary.project';

  return (
    <div className="v3-secretary" data-testid="secretary-chat">
      {projectId !== null && (
        <div className="v3-secretary-scope" role="group" aria-label={t('secretary.title')}>
          <Button
            variant={scope === 'global' ? 'primary' : 'secondary'}
            size="sm"
            data-action="secretary.thread.switch"
            data-testid="secretary-scope-global"
            onClick={() => setScope('global')}
          >
            {t('secretary.global')}
          </Button>
          <Button
            variant={scope === 'project' ? 'primary' : 'secondary'}
            size="sm"
            data-action="secretary.thread.switch"
            data-testid="secretary-scope-project"
            onClick={() => setScope('project')}
          >
            {t('secretary.project')}
          </Button>
        </div>
      )}

      {turnsState === 'loading' ? (
        <div role="status" aria-label={t('secretary.loading')}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      ) : turnsState === 'failed' ? (
        <Banner variant="danger">{t('secretary.error')}</Banner>
      ) : (
        <div className="v3-secretary-log" aria-label={t('secretary.title')}>
          {turns.length === 0 && (
            <div className="v3-secretary-empty" data-testid="secretary-empty">
              {t('secretary.empty')}
            </div>
          )}
          {turns.map((turn) => (
            <div
              key={turn.id}
              className={`v3-secretary-turn v3-secretary-turn--${turn.role}`}
              data-testid={`secretary-turn-${turn.role}`}
            >
              <span className="v3-secretary-turn-role">
                {turn.role === 'owner' ? t('secretary.role.owner') : t('secretary.role.assistant')}
              </span>
              <span className="v3-secretary-turn-content">{turn.content}</span>
            </div>
          ))}
          <div ref={tailRef} />
        </div>
      )}

      {error !== null && <Banner variant="danger">{error}</Banner>}
      {confirmedNote && <Banner variant="success">{t('secretary.confirmed')}</Banner>}

      <ProposalCard
        proposal={visibleProposal}
        refsOwnerMessage={visibleProposal !== null ? visibleProposal.refsOwnerMessage : null}
        turns={turns}
        t={t}
        onConfirm={confirm}
        onDismiss={() => {
            if (visibleProposal) {
                onDismiss(visibleProposal.turnId);
                setConfirmedNote(false);
            }
        }}
        estimate={estimate}
        estimateState={estimateState}
      />

      <div className="v3-secretary-composer">
        <label htmlFor="secretary-input" className="v3-secretary-composer-label">
          {t('secretary.input_label')}
        </label>
        <textarea
          id="secretary-input"
          className="v3-secretary-input"
          value={input}
          placeholder={t('secretary.input_placeholder')}
          rows={2}
          data-testid="secretary-input"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button
          variant="primary"
          data-action="secretary.send"
          data-testid="secretary-send"
          disabled={sending || input.trim() === ''}
          onClick={() => {
            void send();
          }}
        >
          {sending ? t('secretary.loading') : t('secretary.send')}
        </Button>
      </div>
      <span className="v3-secretary-scope-name">{t(scopeKey)}</span>
      {threadId !== null && <span className="v3-secretary-thread-id">{threadId}</span>}
    </div>
  );
}

/**
 * The proposal the panel acts on: the newest secretary turn that carries one.
 * The `refsOwnerMessage` flag rides with the turn — a proposal without it never
 * leaves the card's blocked state.
 */
function getLastProposal(turns: readonly SecretaryTurn[]): {
  turnId: string;
  label: string;
  action: ProposalAction;
  refsOwnerMessage: string | null;
} | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role === 'secretary' && turn.proposal !== null) {
      return {
        turnId: turn.id,
        label: turn.proposal.label,
        action: turn.proposal.action,
        refsOwnerMessage: turn.refsOwnerMessage,
      };
    }
  }
  return null;
}

/** Silence the unused-translate import guard for hosts that pass their own `t`. */
export const SECRETARY_TRANSLATE = translate;
