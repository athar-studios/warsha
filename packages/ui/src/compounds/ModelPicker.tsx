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
// keyboard-accessible (arrows to navigate, Enter to select, Esc to close).

import React, { useId, useRef, useEffect, useState, useMemo } from 'react';

import { Button, type TextProps } from '../components';
import { aliasVar, colorVar, fontSize, lineHeight, radius, shadow, size, space } from '../tokens';

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
  ariaLabel,
}: ModelPickerProps) {
  const triggerId = useId();
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Build the full list with optional default option
  const allOptions = useMemo(() => {
    const opts: ModelOption[] = [];
    if (showDefaultOption) {
      opts.push({
        id: defaultOptionValue,
        name: defaultOptionLabel ?? 'Auto',
        provider: '',
        description: 'Uses the role routing configured in settings',
      });
    }
    opts.push(...options);
    return opts;
  }, [options, showDefaultOption, defaultOptionValue, defaultOptionLabel]);

  const selectedOption = allOptions.find((opt) => opt.id === selectedId) ?? allOptions[0];

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
        setHighlightedIndex(-1);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Keyboard navigation inside the picker
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setHighlightedIndex((prev) =>
            prev < allOptions.length - 1 ? prev + 1 : 0
          );
          break;
        case 'ArrowUp':
          event.preventDefault();
          setHighlightedIndex((prev) =>
            prev > 0 ? prev - 1 : allOptions.length - 1
          );
          break;
        case 'Enter':
          event.preventDefault();
          if (highlightedIndex >= 0) {
            onChange(allOptions[highlightedIndex].id);
            setOpen(false);
            setHighlightedIndex(-1);
          }
          break;
        case 'Escape':
          event.preventDefault();
          setOpen(false);
          setHighlightedIndex(-1);
          break;
        case 'Tab':
          setOpen(false);
          setHighlightedIndex(-1);
          break;
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, allOptions, highlightedIndex, onChange]);

  const triggerLabel = label ?? (
    <>
      <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate' }}>
        {selectedOption.name}
      </span>
      <span aria-hidden="true" style={{ marginInlineStart: space(1) }}>▾</span>
    </>
  );

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
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
          ref={panelRef}
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
          zIndex: 50,
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
                setOpen(false);
                setHighlightedIndex(-1);
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
                <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate', fontWeight: 600 }}>
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