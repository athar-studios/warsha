// @warsha/ui — ModelPicker: the composer's model selector, kept where the owner's hands already are.
//
// The t3code pattern: a self-contained compound that shows the current model and opens a picker on click.
// The picker lists available models with their display names and providers. It uses the same control skin
// as other composer controls: 44px touch floor, bordered pill, and the picker panel follows the design
// system's Panel/Menu patterns.
//
// The model list comes from the consumer (typically the daemon's model catalog + custom models),
// so this component is purely presentational and handles selection UI only.
//
// The component receives translated strings as props for accessibility labels. The picker is
// keyboard-accessible (arrows to navigate, Enter to select, Esc to close). The keydown listener lives
// on the component itself — trigger and listbox — never on `document`, so a key press elsewhere on the
// screen cannot drive the picker; Escape, selection and outside-close all return focus to the trigger.

import React, { useId, useRef, useEffect, useState, useMemo } from 'react';

import { Button, type TextProps } from '../components';
import { aliasVar, colorVar, fontSize, fontWeight, layer, lineHeight, radius, shadow, size, space } from '../tokens';

import { cx, CONTROL_CLASS, CONTROL_COMPACT_CLASS, HOVER_RECESS_CLASS } from './internal';

export interface ModelOption {
  /** The full model id (e.g., 'anthropic/claude-3-5-sonnet') */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Provider name (e.g., 'Anthropic', 'OpenAI', 'Ollama') */
  provider: string;
  /** Optional: short description or capabilities */
  description?: string;
}

export interface ModelPickerProps {
  /** Currently selected model id */
  selectedId: string;
  /** Available models to choose from */
  options: readonly ModelOption[];
  /** Callback when selection changes */
  onChange: (modelId: string) => void;
  /** Optional custom label for the picker trigger */
  label?: React.ReactNode;
  /** Optional dir prop for RTL support */
  dir?: TextProps['dir'];
  /** Optional: show a "default" / "auto" option at the top */
  showDefaultOption?: boolean;
  /** Label for the default option */
  defaultOptionLabel?: string;
  /** Default option value */
  defaultOptionValue?: string;
  /**
   * The default option's name, when the consumer passes catalog strings (DS v2 §6, D9). Defaults to
   * today's English so the rendered pixels do not move; Phase B passes the catalog value.
   */
  autoLabel?: string;
  /** The default option's description. Defaults to today's English; same contract as `autoLabel`. */
  autoDescription?: string;
  /** Accessibility label for the picker (translated) */
  ariaLabel: string;
}

export function ModelPicker({
  selectedId,
  options,
  onChange,
  label,
  dir = 'auto',
  showDefaultOption = true,
  defaultOptionLabel,
  defaultOptionValue = 'auto',
  autoLabel = 'Auto',
  autoDescription = 'Uses the role routing configured in settings',
  ariaLabel,
}: ModelPickerProps) {
  const triggerId = useId();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Build the full list with optional default option
  const allOptions = useMemo(() => {
    const opts: ModelOption[] = [];
    if (showDefaultOption) {
      opts.push({
        id: defaultOptionValue,
        name: defaultOptionLabel ?? autoLabel,
        provider: '',
        description: autoDescription,
      });
    }
    opts.push(...options);
    return opts;
  }, [options, showDefaultOption, defaultOptionValue, defaultOptionLabel, autoLabel, autoDescription]);

  const selectedOption = allOptions.find((opt) => opt.id === selectedId) ?? allOptions[0];

  // The picker is an activedescendant widget: focus stays on the trigger, so every close path hands
  // focus back to it explicitly rather than letting it fall to <body>.
  const closePicker = (restoreFocus: boolean) => {
    setOpen(false);
    setHighlightedIndex(-1);
    if (restoreFocus) document.getElementById(triggerId)?.focus();
  };

  // Close on outside click. The trigger is inside the component, so clicking it toggles normally;
  // a click anywhere else closes and returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setHighlightedIndex(-1);
        document.getElementById(triggerId)?.focus();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, triggerId]);

  // Keyboard navigation, scoped to the component: the handler hangs on the root element, so only
  // keys that land on the trigger or inside the listbox drive it — never a key pressed elsewhere.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlightedIndex((prev) => (prev < allOptions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : allOptions.length - 1));
        break;
      case 'Enter':
        event.preventDefault();
        if (highlightedIndex >= 0) {
          onChange(allOptions[highlightedIndex].id);
          closePicker(true);
        }
        break;
      case 'Escape':
        event.preventDefault();
        closePicker(true);
        break;
      case 'Tab':
        // Tab keeps its native meaning: close without trapping the focus that is leaving.
        closePicker(false);
        break;
    }
  };

  const triggerLabel = label ?? (
    <>
      <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate' }}>
        {selectedOption.name}
      </span>
      <span aria-hidden="true" style={{ marginInlineStart: space(1) }}>▾</span>
    </>
  );

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} style={{ position: 'relative', display: 'inline-flex' }}>
      <Button
        id={triggerId}
        type="button"
        variant="secondary"
        size="sm"
        dir={dir}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ariaLabel}
        data-testid="model-picker-trigger"
        className={cx('warsha-model-picker-trigger', CONTROL_CLASS, CONTROL_COMPACT_CLASS, HOVER_RECESS_CLASS)}
        style={{
          minBlockSize: size('touch'),
          border: `${size('rule')} solid ${aliasVar('benchEdge')}`,
          borderRadius: radius('full'),
          paddingInlineEnd: space(3),
          textAlign: 'start',
          minInlineSize: space(40),
          maxInlineSize: space(70),
          justifyContent: 'space-between',
        }}
        onClick={() => {
          setOpen(!open);
          if (!open) setHighlightedIndex(allOptions.findIndex((o) => o.id === selectedId));
        }}
      >
        {triggerLabel}
      </Button>

      {open && (
        <div
          id={panelId}
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={highlightedIndex >= 0 ? `${panelId}-option-${highlightedIndex}` : undefined}
          dir={dir}
          data-testid="model-picker-panel"
          style={{
          position: 'absolute',
          insetBlockStart: `calc(100% + ${space(1)})`,
          insetInlineEnd: 0,
          zIndex: layer('popover'),
          backgroundColor: colorVar('surface'),
          border: `${size('rule')} solid ${aliasVar('benchEdge')}`,
          borderRadius: radius('md'),
          boxShadow: shadow('lg'),
          overflow: 'hidden',
          minInlineSize: space(60),
          maxInlineSize: space(80),
          maxBlockSize: space(80),
          overflowY: 'auto',
        }}
        >
          {allOptions.map((option, index) => (
            <button
              key={option.id}
              id={`${panelId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={option.id === selectedId}
              aria-describedby={option.description ? `${panelId}-option-${index}-desc` : undefined}
              data-testid={`model-picker-option-${option.id}`}
              onClick={() => {
                onChange(option.id);
                closePicker(true);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: space(0.5),
                padding: space(3),
                textAlign: 'start',
                backgroundColor: option.id === selectedId
                  ? colorVar('accent')
                  : index === highlightedIndex
                  ? colorVar('surfaceMuted')
                  : 'transparent',
                border: 'none',
                color: option.id === selectedId ? colorVar('accentInk') : colorVar('text'),
                fontSize: fontSize('sm'),
                lineHeight: lineHeight('snug'),
                width: '100%',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
                <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate', fontWeight: fontWeight('semibold') }}>
                  {option.name}
                </span>
                {option.provider && (
                  <span
                    dir="ltr"
                    translate="no"
                    style={{
                      unicodeBidi: 'isolate',
                      fontSize: fontSize('xs'),
                      color: option.id === selectedId
                        ? colorVar('accentInk')
                        : colorVar('textMuted'),
                      opacity: 0.8,
                    }}
                  >
                    {option.provider}
                  </span>
                )}
              </div>
              {option.description && (
                <span
                  id={`${panelId}-option-${index}-desc`}
                  dir={dir}
                  style={{
                    fontSize: fontSize('xs'),
                    color: option.id === selectedId
                      ? colorVar('accentInk')
                      : colorVar('textMuted'),
                    lineHeight: lineHeight('relaxed'),
                  }}
                >
                  {option.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}