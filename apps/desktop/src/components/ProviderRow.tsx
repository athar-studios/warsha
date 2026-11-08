// Settings → Providers — one provider row, redrawn for Bench & Signal (PLAN.md M8b, B3-core).
//
// Every provider (a coding CLI, a runtime, a model endpoint) is off by default. The row owns no state:
// mode, enabled and the pinned version come from props and every change goes straight back through
// `onModeChange`/`onToggle`/`onPinVersion`. "Test connection" is a seam (`onTest`); nothing here reads a
// key or opens a socket.
//
// The bench shape (§1.2): this is a ruled ledger line on a plate, not a rounded card — a hairline under
// the row, the name leading, and the controls in a second line so a long Arabic label never pushes a
// control off the plate. The state is a `Lamp` plus its word (never colour alone, §9), and the pinned
// version is machine data: mono, tabular, isolated left-to-right (§11).
//
// The DOM contract stays: the row is an `<li>` (the screen's `<ul>` is the list), it carries
// `data-testid`/`data-mode`/`data-enabled`, and every control keeps an accessible name that includes the
// provider's name — `Mode — Ollama`, `Enabled — Codex CLI`, `Pinned version — Claude Code` — because a
// screen of six identical controls otherwise announces "combobox, combobox, combobox" to a screen
// reader. The `<select>` and the checkbox keep their native roles so the keyboard and the platform's own
// switch semantics come free.
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Button, Lamp } from '@warsha/ui';
import React from 'react';

export type ProviderMode = 'off' | 'notify' | 'auto';

export interface ProviderEntry {
  name: string;
  mode: ProviderMode;
  /** Empty or absent means "follow the latest release". */
  pinnedVersion?: string;
  enabled: boolean;
}

/** Selector order: the safest option first. */
export const providerModes: ProviderMode[] = ['off', 'notify', 'auto'];

/** The skin every control on this plate wears: the bench's edge, `sm` type, the 44px floor. */
const CONTROL_STYLE: React.CSSProperties = {
  paddingInline: 'var(--warsha-space-2)',
  paddingBlock: 'var(--warsha-space-2)',
  borderRadius: 'var(--warsha-radius-sm)',
  border: 'var(--warsha-line-edge)',
  backgroundColor: 'var(--warsha-color-surface)',
  color: 'var(--warsha-color-text)',
  fontFamily: 'inherit',
  fontSize: 'var(--warsha-font-size-sm)',
  minBlockSize: 'var(--warsha-size-touch)',
};

export interface ProviderRowProps extends ProviderEntry {
  onModeChange: (mode: ProviderMode) => void;
  onToggle: (enabled: boolean) => void;
  onPinVersion: (version: string) => void;
  /** Optional seam for the existing `health()` check; no call is made here. */
  onTest?: () => void;
}

export function ProviderRow({
  name,
  mode,
  pinnedVersion,
  enabled,
  onModeChange,
  onToggle,
  onPinVersion,
  onTest,
}: ProviderRowProps) {
  const dir = useDirection();
  const locale = useLocale();

  /** `<control label> — <provider>`, so each of the row's three controls names what it belongs to. */
  const withName = (text: string): string => `${text} — ${name}`;

  const modeWord = t('providers.mode', {}, locale);
  const enabledWord = t('providers.enabled', {}, locale);
  const disabledWord = t('providers.mode_off', {}, locale);
  const pinWord = t('providers.pinned', {}, locale);
  const pinPlaceholder = t('providers.pin_placeholder', {}, locale);

  return (
    <li
      dir={dir}
      data-testid={`provider-row-${name}`}
      data-enabled={enabled}
      data-mode={mode}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-2)',
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-3)',
        listStyle: 'none',
        borderBlockEnd: 'var(--warsha-line-rule)',
        backgroundColor: 'var(--warsha-color-surface)',
        color: 'var(--warsha-color-text)',
        minInlineSize: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--warsha-space-3)',
          flexWrap: 'wrap',
          minInlineSize: 0,
        }}
      >
        {/* The lamp says whether this provider is in the team's way of working; the word says it again. */}
        <Lamp state={enabled ? 'ok' : 'idle'} size="xs">
          {enabled ? enabledWord : disabledWord}
        </Lamp>

        <span
          style={{
            flex: '1',
            minInlineSize: 0,
            fontSize: 'var(--warsha-font-size-sm)',
            fontWeight: 600,
            overflowWrap: 'anywhere',
          }}
        >
          {name}
        </span>

        <label
          className="warsha-control"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--warsha-space-2)',
            fontSize: 'var(--warsha-font-size-sm)',
            color: 'var(--warsha-color-text)',
            minInlineSize: 0,
          }}
        >
          <input
            type="checkbox"
            checked={enabled}
            aria-label={withName(enabledWord)}
            onChange={(event) => onToggle(event.target.checked)}
            style={{
              inlineSize: 'var(--warsha-size-badge)',
              blockSize: 'var(--warsha-size-badge)',
              accentColor: 'var(--warsha-color-accent-strong)',
            }}
          />
          {enabledWord}
        </label>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--warsha-space-2)',
          minInlineSize: 0,
        }}
      >
        <select
          aria-label={withName(modeWord)}
          value={mode}
          onChange={(event) => onModeChange(event.target.value as ProviderMode)}
          style={CONTROL_STYLE}
        >
          {providerModes.map((option) => (
            <option key={option} value={option}>
              {t(`providers.mode_${option}`, {}, locale)}
            </option>
          ))}
        </select>

        <input
          type="text"
          dir="ltr"
          translate="no"
          aria-label={withName(pinWord)}
          placeholder={pinPlaceholder}
          title={pinPlaceholder}
          value={pinnedVersion ?? ''}
          onChange={(event) => onPinVersion(event.target.value)}
          // A version id is machine data: mono, tabular, isolated so it never scrambles in Arabic (§11).
          style={{
            ...CONTROL_STYLE,
            fontFamily: 'var(--warsha-font-mono)',
            fontVariantNumeric: 'tabular-nums',
            unicodeBidi: 'isolate',
            maxInlineSize: 'var(--warsha-size-measure-compact)',
          }}
        />

        <Button type="button" variant="secondary" size="sm" dir={dir} onClick={() => onTest?.()}>
          {t('providers.test_connection', {}, locale)}
        </Button>
      </div>
    </li>
  );
}
