// Agent workflow — slash command picker (PLAN.md M18, redrawn for Bench & Signal in B3-core).
//
// Skills exposed as slash commands in the composer: the dropdown lists what the project has, filtered by
// what was typed after the `/`, and a click hands the command name back to the caller. Nothing is
// executed here — the registry that owns the commands lives in `crates/warsha-pipeline/src/agent_workflow.rs`.
//
// Same bench shape as the mention picker (§1, §6): a hairline plate, `Ledger` rows, the command name in
// mono with `translate="no"` because `/review` is machine data (§11), and its one-line description under
// it in the prose family. No shadow, no entrance motion (§8).
//
// Keyboard (§9): the rows are real buttons, arrows and `Home`/`End` move focus inside the open list,
// `Escape` hands the popover back to the caller through `onClose`.
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Button, Ledger } from '@warsha/ui';
import React, { useCallback, useRef } from 'react';

/** One command the composer can offer. */
export interface SlashCommandItem {
  /** The command as typed, with the leading `/`. */
  name: string;
  /** One line shown under the name. */
  description: string;
}

function bareName(name: string): string {
  return name.trim().replace(/^\//, '');
}

/**
 * The commands that match what was typed after the `/`, sorted by name.
 *
 * Prefix matching mirrors the Rust `SlashCommandRegistry::matching`, so the dropdown and the daemon
 * cannot disagree about what `re` offers; the leading `/` is optional and the comparison is
 * case-insensitive. Sorting is by the bare name — the slash is a prefix, not part of the word — which
 * keeps the order stable between keystrokes instead of following the props order.
 */
export function filterSlashCommands(
  commands: readonly SlashCommandItem[],
  query: string
): SlashCommandItem[] {
  const wanted = bareName(query).toLowerCase();
  return commands
    .filter((command) => bareName(command.name).toLowerCase().startsWith(wanted))
    .slice()
    .sort((left, right) =>
      bareName(left.name).toLowerCase().localeCompare(bareName(right.name).toLowerCase())
    );
}

export interface SlashCommandPickerProps {
  /** Every command the project knows about. */
  commands: readonly SlashCommandItem[];
  /** Called with the command's name, with its leading `/`. */
  onSelect: (name: string) => void;
  /** What the owner typed after the `/`. */
  query?: string;
  /** Called on `Escape`: the popover closes and the composer keeps its draft. */
  onClose?: () => void;
}

/** A popover line: plate padding, `text` colour, no colour-only hierarchy (§9). */
const LINE_STYLE: React.CSSProperties = {
  marginBlock: 0,
  marginInline: 0,
  paddingInline: 'var(--warsha-space-4)',
  paddingBlock: 'var(--warsha-space-3)',
  color: 'var(--warsha-color-text)',
  fontSize: 'var(--warsha-font-size-sm)',
};

export function SlashCommandPicker({
  commands,
  onSelect,
  query = '',
  onClose,
}: SlashCommandPickerProps) {
  const dir = useDirection();
  const locale = useLocale();
  const plateRef = useRef<HTMLDivElement>(null);

  const title = t('agent_workflow.slash.title', {}, locale);
  const options = filterSlashCommands(commands, query);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }

      const buttons = plateRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not([disabled])'
      );
      if (!buttons || buttons.length === 0) return;

      const order = [...buttons];
      const current = order.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      const target =
        event.key === 'Home'
          ? order[0]
          : event.key === 'End'
            ? order[order.length - 1]
            : step === 0
              ? undefined
              : order[(current + step + order.length) % order.length];

      if (target) {
        event.preventDefault();
        target.focus();
      }
    },
    [onClose]
  );

  return (
    <div
      ref={plateRef}
      dir={dir}
      data-testid="slash-command-picker"
      data-query={query}
      role="group"
      aria-label={title}
      aria-describedby="slash-command-picker-hint"
      onKeyDown={onKeyDown}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minInlineSize: '15rem',
        maxInlineSize: '100%',
        backgroundColor: 'var(--warsha-color-surface)',
        border: '1px solid var(--warsha-bench-rule)',
        borderRadius: 'var(--warsha-radius-md)',
      }}
    >
      {options.length === 0 ? (
        <p data-testid="slash-command-picker-empty" style={LINE_STYLE}>
          {t('agent_workflow.slash.empty', {}, locale)}
        </p>
      ) : (
        <Ledger label={title} recessed>
          {options.map((command) => (
            <Ledger.Row key={command.name}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                dir={dir}
                data-command={command.name}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 'var(--warsha-space-1)',
                  inlineSize: '100%',
                  backgroundColor: 'transparent',
                }}
                onClick={() => onSelect(command.name)}
              >
                {/* The name is machine data: mono and isolated, whatever the interface direction (§11). */}
                <span
                  dir="ltr"
                  translate="no"
                  style={{
                    fontFamily: 'var(--warsha-font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--warsha-color-text)',
                    fontWeight: 600,
                    unicodeBidi: 'isolate',
                  }}
                >
                  {command.name}
                </span>
                <span style={{ color: 'var(--warsha-color-text)', fontSize: 'var(--warsha-font-size-xs)' }}>
                  {command.description}
                </span>
              </Button>
            </Ledger.Row>
          ))}
        </Ledger>
      )}

      <p
        id="slash-command-picker-hint"
        style={{
          ...LINE_STYLE,
          paddingBlock: 'var(--warsha-space-2)',
          fontSize: 'var(--warsha-font-size-xs)',
          borderBlockStart: '1px solid var(--warsha-bench-rule)',
        }}
      >
        {t('agent_workflow.picker_hint', {}, locale)}
      </p>
    </div>
  );
}
