// @warsha/desktop — the gate bell: the owner's queue, one press away (REDESIGN §4).
//
// §4 puts a bell with a count badge in the top bar, and §1 says what the badge means: a lit lamp is
// "this needs the owner's hand". So the badge is only ever lit by *pending* gates — a decided queue
// reads as a quiet number, and an empty one shows no badge at all. The count is machine data (§11), so
// it is mono with tabular numerals.
//
// The queue itself is a dialog, and it follows the same three-part contract the accepted Handoff,
// new-project and pair-device dialogs do (§9, AUDIT-1 §4.2): focus moves in when it opens, `Tab`
// cannot leave it while it is up, and `Escape` closes it and puts focus back on the bell that opened
// it. A non-modal popover that stole the keyboard would be the worse lie, so the surface that takes
// the keyboard says so with a scrim.
//
// The gates arrive from the shell (`client.getGates(run.id)` — the same seam `GatesInbox` reads), and
// the only action here is navigation to the inbox, where a decision is actually made. A bell that
// approved a gate from its own popover would be a second decision path around the record the gates
// screen keeps.
import { type GateSummary, type Stage } from '@warsha/client';
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Button, Chip, Lamp, Ledger, Panel } from '@warsha/ui';
import React, { useCallback, useEffect, useRef } from 'react';

/** The selector focusable things answer to, for the dialog's Tab ring (same contract as HandoffDialog). */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A gate is in the owner's queue only while it is pending. */
export function pendingStages(gates: readonly GateSummary[] | null): Stage[] {
  if (gates === null) return [];
  return gates.filter((gate) => gate.state.state === 'pending').map((gate) => gate.stage);
}

/**
 * The catalog key a stage is named by.
 *
 * The four decision gates own their words (`gates.label.gate_a`); every other stage is a pipeline
 * stage and reads from the run's list, so the bell never invents a fifth label.
 */
function stageKey(stage: Stage): string {
  return stage.startsWith('gate_') ? `gates.label.${stage}` : `run.stage.${stage}`;
}

export interface GateBellProps {
  /** The selected run's gates, or `null` while nothing has been read. */
  gates: GateSummary[] | null;
  /** A read is in flight. */
  loading: boolean;
  /** The last read failed — §7 wants the problem *and* the next action. */
  failed: boolean;
  /** False when no run is selected, so the queue has no owner to be waiting on. */
  hasRun: boolean;
  /** Ask the shell to open the gates inbox for the selected run. */
  onOpenGates: () => void;
  /** Read the gates again after a failure. */
  onRetry: () => void;
}

export function GateBell({ gates, loading, failed, hasRun, onOpenGates, onRetry }: GateBellProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);

  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The control that had focus before the dialog opened: focus returns to it on close (§9).
  const restoreRef = useRef<HTMLElement | null>(null);

  const pending = pendingStages(gates);
  const count = pending.length;
  const label = t('shell.gate_bell', {}, locale);
  const hint = t('shell.gate_bell_hint', {}, locale);
  const ariaLabel = count > 0 ? `${label} — ${count}` : label;

  // Focus in on open, focus back on close: one effect, because both halves are the same transaction.
  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const restore = restoreRef.current;
    return () => {
      restore?.focus?.();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const order = [...nodes];
      const current = order.indexOf(document.activeElement as HTMLElement);
      const step = event.shiftKey ? -1 : 1;
      const next = order[(current + step + order.length) % order.length];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    },
    []
  );

  const closeAndOpenInbox = (): void => {
    setOpen(false);
    onOpenGates();
  };

  return (
    <div className="bench-bell" dir={dir}>
      <button
        ref={bellRef}
        type="button"
        dir={dir}
        data-testid="gate-bell"
        data-count={count}
        data-lit={count > 0 ? 'true' : 'false'}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={hint}
        onClick={() => setOpen((current) => !current)}
      >
        {/* The bell is decoration; the number and the label say what it means (§9). */}
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          style={{ flex: 'none', display: 'block' }}
        >
          <path
            d="M8 1.8a4.2 4.2 0 0 0-4.2 4.2v2.3L2.6 10a.6.6 0 0 0 .5.9h9.8a.6.6 0 0 0 .5-.9l-1.2-1.7V6A4.2 4.2 0 0 0 8 1.8Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M6.4 12.8a1.7 1.7 0 0 0 3.2 0" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        {count > 0 && (
          <span aria-hidden="true" className="bench-bell-badge" data-testid="gate-bell-count">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          dir={dir}
          role="presentation"
          // The scrim is what makes the modal promise true: everything outside the queue is inert while
          // it is open, and a press there closes it.
          data-testid="gate-bell-scrim"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 140,
            backgroundColor: 'var(--warsha-color-scrim)',
          }}
        >
          <div
            ref={panelRef}
            dir={dir}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            data-testid="gate-bell-panel"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={onKeyDown}
            className="bench-bell-popover"
          >
            <Panel
              title={label}
              label={label}
              actions={
                <Button variant="ghost" size="sm" dir={dir} onClick={() => setOpen(false)}>
                  {t('common.close', {}, locale)}
                </Button>
              }
              style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}
            >
              {failed ? (
                // §7: the problem and the next action, in the same breath.
                <div style={{ display: 'grid', gap: 'var(--warsha-space-2)' }}>
                  <Lamp state="fail" size="sm">
                    {t('shell.gate_bell_failed', {}, locale)}
                  </Lamp>
                  <Button variant="secondary" size="sm" dir={dir} onClick={onRetry}>
                    {t('common.retry', {}, locale)}
                  </Button>
                </div>
              ) : loading ? (
                <Lamp state="working" size="sm">
                  {t('shell.gate_bell_loading', {}, locale)}
                </Lamp>
              ) : !hasRun ? (
                <Lamp state="idle" size="sm">
                  {t('shell.gate_bell_no_run', {}, locale)}
                </Lamp>
              ) : count === 0 ? (
                <Lamp state="ok" size="sm">
                  {t('shell.gate_bell_none', {}, locale)}
                </Lamp>
              ) : (
                <Ledger
                  label={label}
                  style={{ borderBlockStart: 'none' }}
                >
                  {pending.map((stage) => (
                    <Ledger.Row
                      key={stage}
                      meta={
                        <Chip tone="lit" label={`${t('gates.word', {}, locale)} — ${t('gates.pending', {}, locale)}`}>
                          {t('gates.pending', {}, locale)}
                        </Chip>
                      }
                    >
                      <Lamp state="waiting" size="sm">
                        {t(stageKey(stage), {}, locale)}
                      </Lamp>
                    </Ledger.Row>
                  ))}
                </Ledger>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--warsha-space-3)' }}>
                <Button variant="primary" size="sm" dir={dir} data-testid="gate-bell-open" onClick={closeAndOpenInbox}>
                  {t('shell.open_gates', {}, locale)}
                </Button>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
