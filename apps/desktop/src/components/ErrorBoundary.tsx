// @warsha/desktop — root error boundary.
//
// A throw during render used to black the whole window: a blank page with the error only in the
// devtools console, which is the worst possible failure for an owner supervising a run. The
// boundary is the last line of defence behind the two real fixes (the client's wire decode and
// the safe date formatters): whatever still throws in a screen gets a recovery card in place of
// its subtree, with the error's own message shown — redacted, because an error can echo a bearer
// token and §security says no secret rides in UI text — and two ways out: retry the subtree and
// reload the app.
//
// The card's copy is catalog-driven (`error.boundary_*`) but deliberately bilingual in both
// catalogs: this card renders precisely when the app may be too broken to trust any provider
// above it (locale, router, data), so the strings say everything in both of the product's
// languages. The locale is read from storage at render — the boundary sits outside
// `LocaleProvider`, so it must not depend on the React context.
// Styling follows the design system: `--warsha-*` tokens only, logical properties, RTL-safe.
import { readStoredLocale, t } from '@warsha/i18n';
import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional observer for telemetry/tests; the card itself never depends on it. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Optional array of values that, when changed, will automatically reset the error boundary. */
  resetKeys?: readonly unknown[];
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Redact secret-looking material from an error message before it is rendered.
 *
 * An RPC or socket error can echo back part of a credential (a bearer token, a pairing secret)
 * inside its text. Long unbroken runs of token-shaped characters — 20 or more of base64/hex with
 * no spaces — are masked wholesale; ordinary sentences and field names pass through untouched.
 */
export function redactErrorText(message: string): string {
  return message.replace(/[A-Za-z0-9+/_=-]{20,}/g, '[redacted]');
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the console copy for diagnosis; the card below is the owner-facing one.
    console.error('Warsha desktop render error:', error.message, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // Auto-reset when resetKeys change
    if (this.state.hasError && this.props.resetKeys) {
      const prevKeys = prevProps.resetKeys ?? [];
      const currKeys = this.props.resetKeys;
      if (currKeys.length === prevKeys.length && currKeys.every((key, i) => key === prevKeys[i])) {
        return; // no change
      }
      this.reset();
    }
  }

  private readonly reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  private readonly reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const message = redactErrorText(this.state.error?.message ?? '');
    const locale = readStoredLocale();
    const label = (key: string): string => t(key, {}, locale);

    return (
      <div
        dir="auto"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minBlockSize: '100vh',
          paddingInline: 'var(--warsha-space-6)',
          paddingBlock: 'var(--warsha-space-6)',
          backgroundColor: 'var(--warsha-color-bg)',
          color: 'var(--warsha-color-text)',
          fontFamily: 'var(--warsha-font-sans)',
        }}
      >
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--warsha-space-4)',
            inlineSize: '100%',
            maxInlineSize: '480px',
            paddingInline: 'var(--warsha-space-6)',
            paddingBlock: 'var(--warsha-space-6)',
            backgroundColor: 'var(--warsha-color-surface)',
            border: 'var(--warsha-size-rule, 1px) solid var(--warsha-color-border)',
            // The error edge leads on the start side — inline-start, so it lands right in RTL.
            borderInlineStartWidth: 'var(--warsha-size-inscribe, 4px)',
            borderInlineStartColor: 'var(--warsha-color-error)',
            borderRadius: 'var(--warsha-radius-lg)',
          }}
        >
          <div
            style={{
              fontSize: 'var(--warsha-font-size-xl)',
              fontWeight: 'var(--warsha-font-weight-bold)',
            }}
          >
            {label('error.boundary_title')}
          </div>

          <div
            style={{
              fontSize: 'var(--warsha-font-size-sm)',
              color: 'var(--warsha-color-text-muted)',
              minBlockSize: 'var(--warsha-space-6)',
            }}
          >
            {message.length > 0 ? message : label('error.boundary_message_fallback')}
          </div>

          <div style={{ display: 'flex', gap: 'var(--warsha-space-3)', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={this.reload}
              style={{
                paddingInline: 'var(--warsha-space-4)',
                paddingBlock: 'var(--warsha-space-2)',
                fontSize: 'var(--warsha-font-size-md)',
                fontWeight: 'var(--warsha-font-weight-semibold)',
                color: 'var(--warsha-color-accent-ink)',
                backgroundColor: 'var(--warsha-color-accent)',
                border: 'none',
                borderRadius: 'var(--warsha-radius-md)',
                cursor: 'pointer',
              }}
            >
              {label('error.boundary_reload')}
            </button>
            <button
              type="button"
              onClick={this.reset}
              style={{
                paddingInline: 'var(--warsha-space-4)',
                paddingBlock: 'var(--warsha-space-2)',
                fontSize: 'var(--warsha-font-size-md)',
                fontWeight: 'var(--warsha-font-weight-medium)',
                color: 'var(--warsha-color-text)',
                backgroundColor: 'var(--warsha-color-surface-muted)',
                border: 'var(--warsha-size-rule, 1px) solid var(--warsha-color-border-strong)',
                borderRadius: 'var(--warsha-radius-md)',
                cursor: 'pointer',
              }}
            >
              {label('error.boundary_retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
