import type { GateEvidence } from '@warsha/client';
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  Card,
  DiffView,
  IconCheck,
  IconRefresh,
  IconX,
  TextField,
} from '@warsha/ui/v3';
import React, { useState } from 'react';

/**
 * The command field as the daemon binds it: one program and its arguments.
 *
 * Whitespace separates the tokens and nothing else happens — no shell, no quoting, no
 * expansion, no globbing. A quoted token therefore stays literal (`sh -c 'a b'` sends
 * `'a` and `b'`), which is the honest reading of "one command field, split into program
 * and args": the daemon runs the program it is given with exactly these arguments, so a
 * screen that interpreted quotes would be inventing a second, invisible grammar.
 *
 * `null` is an empty or whitespace-only field — there is no program to run.
 */
export function splitEvidenceCommand(
  command: string
): { program: string; args: string[] } | null {
  const tokens = command.trim().split(/\s+/).filter((token) => token.length > 0);
  const [program, ...args] = tokens;
  if (program === undefined) return null;
  return { program, args };
}

/** How a failed `gates.evidence` call reads to the owner, one per daemon refusal. */
export type EvidenceFailureKind = 'policy' | 'owner' | 'no_worktree' | 'failed';

/** One refusal, classified by the daemon's JSON-RPC code. */
export interface EvidenceFailure {
  kind: EvidenceFailureKind;
  /** The code the daemon answered, or `null` when the message was not an RPC refusal. */
  code: number | null;
  /** The daemon's own words, carried verbatim so nothing it said is lost. */
  detail: string;
}

/**
 * Read a refusal off the message `@warsha/client` throws (`RPC error <code>: <message>`).
 *
 * The four states are the daemon's own: `-32005` is `CommandPolicy` refusing the program
 * (`crates/warshad/src/lib.rs:2232`), `-32002` is the Owner/Spend row refusing a device
 * that is not the owner (`crates/warshad/src/auth.rs:333`), and `-32000` is the two
 * reasons the handler declines to collect at all — the run is not at Gate C, or it has no
 * worktree. Gate C is already a UI precondition here (the card only offers to collect at
 * Gate C), so a `-32000` that names the worktree is the "no worktree" state and anything
 * else is reported as a plain failure with the daemon's message beside it.
 *
 * A classification never replaces the daemon's words: `detail` is always what it said.
 */
export function classifyEvidenceError(error: unknown): EvidenceFailure {
  const detail = error instanceof Error ? error.message : String(error);
  const code = /RPC error (-?\d+):/.exec(detail);
  if (code === null) return { kind: 'failed', code: null, detail };
  const numeric = Number(code[1]);
  if (numeric === -32005) return { kind: 'policy', code: numeric, detail };
  if (numeric === -32002) return { kind: 'owner', code: numeric, detail };
  if (numeric === -32000 && /worktree/i.test(detail)) {
    return { kind: 'no_worktree', code: numeric, detail };
  }
  return { kind: 'failed', code: numeric, detail };
}

export interface EvidenceCardProps {
  /** The run's current stage. Anything but `gate_c` cannot collect. */
  runStage: string;
  /** The evidence the owner already collected, or `null` before the one action is taken. */
  evidence: GateEvidence | null;
  /**
   * The one explicit collection. Nothing calls this on mount, reload or tab switch: it
   * runs from the button, and resolves to what the daemon measured.
   *
   * Absent only on a screen that was rendered without a client (`ChangesTab` keeps its
   * props optional so a fixture can mount it alone); the action is then unavailable
   * rather than silently doing something else.
   */
  onCollect?: (program: string, args: string[]) => Promise<GateEvidence>;
  /** Open a changed path in the Files tab. */
  onOpenFile?: (path: string) => void;
}

/** What one test command measured, as the daemon reported it (never re-derived here). */
const TestVerdict: React.FC<{ evidence: GateEvidence }> = ({ evidence }) => {
  const t = useT();
  const { tests } = evidence;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-2)' }}
      data-testid="bench-evidence-verdict"
      data-verdict={tests.success ? 'passing' : 'failing'}
    >
      <Banner
        variant={tests.success ? 'success' : 'danger'}
        icon={tests.success ? <IconCheck size={18} /> : <IconX size={18} />}
        data-testid={tests.success ? 'bench-evidence-passing' : 'bench-evidence-failing'}
      >
        {tests.success ? t('bench.evidence.tests_passing') : t('bench.evidence.tests_failing')}
      </Banner>

      <p
        style={{
          margin: 0,
          fontSize: 'var(--w-font-size-sm)',
          color: 'var(--w-text-muted)',
        }}
      >
        {t('bench.evidence.tests_duration', { ms: tests.duration_ms })}
        {tests.exit_code === null
          ? ''
          : ` · ${t('bench.evidence.tests_exit_code', { code: tests.exit_code })}`}
      </p>

      {/* The command that ran, as the daemon recorded it — not as the field spells it now. */}
      <p
        dir="ltr"
        style={{
          margin: 0,
          fontFamily: 'var(--w-font-mono)',
          fontSize: 'var(--w-font-size-xs)',
          color: 'var(--w-text-muted)',
          textAlign: 'start',
          overflowWrap: 'anywhere',
        }}
        data-testid="bench-evidence-test-command"
      >
        {[tests.program, ...tests.args].join(' ')}
      </p>

      {/* Truncation is shown only from what the daemon reports; the stream text already
          carries the in-band `…[truncated]` marker the daemon appended. */}
      {tests.truncated && (
        <Banner variant="attention" data-testid="bench-evidence-tests-truncated">
          {t('bench.evidence.tests_truncated')}
        </Banner>
      )}

      {(tests.stdout.length > 0 || tests.stderr.length > 0) && (
        <pre
          dir="ltr"
          data-testid="bench-evidence-test-output"
          style={{
            margin: 0,
            padding: 'var(--w-space-2)',
            backgroundColor: 'var(--w-sunken)',
            border: 'var(--w-border-width) solid var(--w-line)',
            borderRadius: 'var(--w-radius-md)',
            fontFamily: 'var(--w-font-mono)',
            fontSize: 'var(--w-font-size-xs)',
            lineHeight: 'var(--w-line-height-sm)',
            color: 'var(--w-text)',
            maxHeight: 'var(--w-space-10)',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {[tests.stdout, tests.stderr].filter((stream) => stream.length > 0).join('\n')}
        </pre>
      )}
    </div>
  );
};

/**
 * Gate C evidence: the one owner action that collects the diff, the changed files, one
 * measured test run and the preview the project already has — `gates.evidence`
 * (`crates/warshad/src/lib.rs:634`), whose auth row is Owner / Spend
 * (`crates/warshad/src/auth.rs:333`): every call is a spend, never a passive read.
 *
 * Per OD-B3 there is no collection on mount, reload or tab switch. The card renders what
 * the owner asked for and nothing else, and the owner's one action is the button.
 */
export const EvidenceCard: React.FC<EvidenceCardProps> = ({
  runStage,
  evidence,
  onCollect,
  onOpenFile,
}) => {
  const t = useT();

  const [command, setCommand] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<EvidenceFailure | null>(null);

  const atGateC = runStage === 'gate_c';
  const split = splitEvidenceCommand(command);

  const handleCollect = async () => {
    const parts = splitEvidenceCommand(command);
    if (parts === null || onCollect === undefined) return;
    setPending(true);
    setFailure(null);
    try {
      await onCollect(parts.program, parts.args);
    } catch (error) {
      setFailure(classifyEvidenceError(error));
    } finally {
      setPending(false);
    }
  };

  const failureMessage = (kind: EvidenceFailureKind): string => {
    switch (kind) {
      case 'policy':
        return t('bench.evidence.error_policy');
      case 'owner':
        return t('bench.evidence.error_owner');
      case 'no_worktree':
        return t('bench.evidence.error_no_worktree');
      default:
        return t('bench.evidence.error_failed');
    }
  };

  return (
    <Card
      title={t('bench.evidence.title')}
      subtitle={t('bench.evidence.subtitle')}
      data-testid="bench-evidence-card"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}
    >
      {!atGateC && (
        <Banner variant="info" data-testid="bench-evidence-not-at-gate-c">
          {t('bench.evidence.not_at_gate_c')}
        </Banner>
      )}

      {atGateC && (
        <p
          style={{ margin: 0, fontSize: 'var(--w-font-size-sm)', color: 'var(--w-text-muted)' }}
          data-testid="bench-evidence-approve-guard"
        >
          {t('bench.evidence.approve_guard')}
        </p>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 'var(--w-space-3)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 'var(--w-rail-width)' }}>
          <TextField
            label={t('bench.evidence.command_label')}
            hint={t('bench.evidence.command_hint')}
            placeholder={t('bench.evidence.command_placeholder')}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={!atGateC}
            data-testid="bench-evidence-command-input"
          />
        </div>

        <Button
          variant="secondary"
          size="sm"
          icon={<IconRefresh size={14} />}
          loading={pending}
          disabled={!atGateC || split === null || onCollect === undefined}
          onClick={() => void handleCollect()}
          data-action="bench.evidence.collect"
          data-testid="bench-evidence-collect-btn"
        >
          {t('bench.action.evidence_collect')}
        </Button>
      </div>

      {failure !== null && (
        <Banner
          variant="danger"
          title={failureMessage(failure.kind)}
          data-testid={`bench-evidence-error-${failure.kind}`}
        >
          <span dir="ltr" style={{ fontFamily: 'var(--w-font-mono)' }}>
            {failure.detail}
          </span>
        </Banner>
      )}

      {evidence !== null && (
        <>
          <p
            style={{ margin: 0, fontSize: 'var(--w-font-size-sm)', color: 'var(--w-text-muted)' }}
            data-testid="bench-evidence-collected"
          >
            {t('bench.evidence.collected')}
          </p>

          <TestVerdict evidence={evidence} />

          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-2)' }}
            data-testid="bench-evidence-files"
          >
            <h3
              style={{
                margin: 0,
                fontSize: 'var(--w-font-size-sm)',
                fontWeight: 'var(--w-font-weight-semibold)',
                color: 'var(--w-text)',
              }}
            >
              {t('bench.evidence.files_title', { count: evidence.files_changed.length })}
            </h3>

            {evidence.files_changed.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 'var(--w-font-size-sm)',
                  color: 'var(--w-text-muted)',
                }}
                data-testid="bench-evidence-files-empty"
              >
                {t('bench.evidence.files_empty')}
              </p>
            ) : (
              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--w-space-1)',
                }}
              >
                {evidence.files_changed.map((path) => (
                  <li key={path}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onOpenFile?.(path)}
                      data-action="bench.evidence.file.open"
                      data-testid="bench-evidence-file"
                    >
                      <span dir="ltr" style={{ fontFamily: 'var(--w-font-mono)' }}>
                        {path}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {evidence.diff.length === 0 ? (
            <p
              style={{ margin: 0, fontSize: 'var(--w-font-size-sm)', color: 'var(--w-text-muted)' }}
              data-testid="bench-evidence-diff-empty"
            >
              {t('bench.evidence.diff_empty')}
            </p>
          ) : (
            // The diff the daemon capped: its marker is in-band text, so the view shows
            // truncation exactly where the daemon put it and nowhere else.
            <DiffView
              diff={evidence.diff}
              data-testid="bench-evidence-diff"
              maxHeight="var(--w-space-10)"
            />
          )}

          {evidence.preview === null ? (
            <p
              style={{ margin: 0, fontSize: 'var(--w-font-size-sm)', color: 'var(--w-text-muted)' }}
              data-testid="bench-evidence-preview-absent"
            >
              {t('bench.evidence.preview_absent')}
            </p>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--w-space-1)',
                padding: 'var(--w-space-3)',
                backgroundColor: 'var(--w-sunken)',
                border: 'var(--w-border-width) solid var(--w-line)',
                borderRadius: 'var(--w-radius-md)',
              }}
              data-testid="bench-evidence-preview"
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 'var(--w-font-size-sm)',
                  fontWeight: 'var(--w-font-weight-semibold)',
                  color: 'var(--w-text)',
                }}
              >
                {t('bench.evidence.preview_title')}
              </h3>
              <p
                style={{ margin: 0, fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}
              >
                {t('bench.evidence.preview_project_note')}
              </p>
              <p dir="ltr" style={{ margin: 0, fontSize: 'var(--w-font-size-sm)' }}>
                <span style={{ fontFamily: 'var(--w-font-mono)' }}>
                  {evidence.preview.url ?? t('bench.evidence.preview_no_url')}
                </span>
              </p>
              <p
                style={{ margin: 0, fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}
              >
                {t('bench.evidence.preview_status', { status: evidence.preview.status })}
                {` · ${evidence.preview.process_id}`}
              </p>
            </div>
          )}
        </>
      )}

      {evidence === null && failure === null && atGateC && (
        <p
          style={{ margin: 0, fontSize: 'var(--w-font-size-sm)', color: 'var(--w-text-muted)' }}
          data-testid="bench-evidence-not-collected"
        >
          {t('bench.evidence.not_collected')}
        </p>
      )}

      {evidence === null && !atGateC && (
        <p
          style={{ margin: 0, fontSize: 'var(--w-font-size-sm)', color: 'var(--w-text-muted)' }}
        >
          {t('bench.evidence.diff_hint')}
        </p>
      )}

      <p
        style={{ margin: 0, fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}
        data-testid="bench-evidence-spend-note"
      >
        {t('bench.evidence.spend_note')}
      </p>
    </Card>
  );
};

EvidenceCard.displayName = 'EvidenceCard';
