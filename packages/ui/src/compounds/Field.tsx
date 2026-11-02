// @warsha/ui — Field: a labelled input with its hint and its error, wired the way §7 requires.
//
// The problem this solves is the one AUDIT-1 found in the desktop forms: an input with an `aria-label`
// and no visible label, an error that appears in red without telling assistive technology, and a hint
// the a11y tree never hears. `Field` keeps the three together and gives the control the ids it needs:
//
//   * the label is a real `<label for>` — persistent, clickable, and the name of the control;
//   * the hint and the error are separate nodes with stable ids, so `aria-describedby` can point at them
//     before and after the error exists;
//   * `aria-invalid` is derived from the error the caller passed, so a screen cannot render "invalid" and
//     forget to say so.
//
// The control itself arrives as children: `Field` does not own an `<input>`, because the app's inputs
// carry their own handlers, types and autocomplete attributes, and a design system that swallows those
// is a design system the screen has to work around.

import React from 'react';

import { colorVar, fontSize, fontWeight, lineHeight, size, space } from '../tokens';

import { cx, FIELD } from './internal';

export interface FieldProps {
  children: React.ReactNode;
  /** The persistent label. */
  label: React.ReactNode;
  /** The control's `id`, which is also what the label points at. */
  id: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Required marks the label and lets the caller's own validation say the same thing. */
  required?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** The `id` of a field's hint node, for the control's `aria-describedby`. */
export function fieldHintId(id: string): string {
  return `${id}-hint`;
}

/** The `id` of a field's error node — the one an invalid control must describe itself with. */
export function fieldErrorId(id: string): string {
  return `${id}-error`;
}

/** Both message ids in the order a screen reader should read them, skipping the absent one. */
export function fieldDescribedBy(id: string, options: { hint?: boolean; error?: boolean }): string {
  return [options.error ? fieldErrorId(id) : null, options.hint ? fieldHintId(id) : null]
    .filter((part): part is string => Boolean(part))
    .join(' ');
}

export function Field({
  children,
  label,
  id,
  hint,
  error,
  required = false,
  className = '',
  style,
}: FieldProps) {
  return (
    <div
      className={cx('warsha-field', className)}
      style={{ display: 'grid', gap: space(1), marginBlockEnd: space(4), ...style }}
    >
      <label
        htmlFor={id}
        style={{
          color: colorVar('text'),
          fontSize: fontSize('sm'),
          fontWeight: fontWeight('medium'),
        }}
      >
        {label}
        {required && (
          // The word is the accessible channel; the asterisk is the visual one.
          <span aria-hidden="true" style={{ color: colorVar('error') }}>
            {' *'}
          </span>
        )}
      </label>

      {children}

      {hint && !error && (
        <span
          id={fieldHintId(id)}
          style={{ color: colorVar('textMuted'), fontSize: fontSize('xs'), lineHeight: lineHeight('base') }}
        >
          {hint}
        </span>
      )}

      {error && (
        <span
          id={fieldErrorId(id)}
          role="alert"
          style={{
            color: colorVar('error'),
            fontSize: fontSize('sm'),
            borderInlineStart: `${size('edge')} solid ${colorVar('error')}`,
            paddingInlineStart: space(2),
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

/** What a control inside a `Field` should carry. See `fieldControl`. */
export interface FieldControlProps {
  id: string;
  'aria-required'?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  style: React.CSSProperties;
}

/**
 * The props a text control inside a `Field` should carry. Spread it on the input:
 *
 *   <Field id="key" label={…} error={…}>
 *     <input {...fieldControl('key', { hint: true, error: true })} />
 *   </Field>
 *
 * It sets `aria-invalid` only when there *is* an error — an input that always claims to be invalid is
 * worse than one that never says anything — and it points `aria-describedby` at whichever message nodes
 * the field rendered, error first (§7: inline near the field).
 */
export function fieldControl(
  id: string,
  options: { hint?: boolean; error?: boolean; required?: boolean } = {}
): FieldControlProps {
  const describedBy = fieldDescribedBy(id, options);

  return {
    id,
    ...(options.required ? { 'aria-required': true } : {}),
    ...(options.error ? { 'aria-invalid': true } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    style: { ...FIELD, ...(options.error ? { border: `${size('rule')} solid ${colorVar('error')}` } : {}) },
  };
}
