// packages/ui/src/v3/composites/Toast.tsx — Design System v3 Toast (DS v3 §3.2)
// ToastProvider + useToast(). Auto-dismiss 5000ms except errors. Errors persist with retry callback.

import React from 'react';

import { IconAlert, IconCheck, IconInfo, IconRefresh, IconX } from '../icons';
import { Button } from '../primitives/Button';
import { IconButton } from '../primitives/IconButton';
import './Toast.css';

export type ToastVariant = 'info' | 'success' | 'attention' | 'danger';

export interface ToastItem {
  id: string;
  actionId?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
  onRetry?: () => void;
  retryLabel?: string;
  dismissLabel?: string;
  'data-action'?: string;
  'data-testid'?: string;
}

export interface ToastContextValue {
  toasts: ToastItem[];
  toast: (options: Omit<ToastItem, 'id'> & { id?: string; actionId?: string }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const MAX_VISIBLE_TOASTS = 3;
export const AUTO_DISMISS_DURATION = 10000;

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

const VARIANT_ICONS: Record<ToastVariant, React.ReactNode> = {
  info: <IconInfo size={18} />,
  success: <IconCheck size={18} />,
  attention: <IconAlert size={18} />,
  danger: <IconAlert size={18} />,
};

const VARIANT_COLORS: Record<ToastVariant, { bg: string; border: string; iconColor: string }> = {
  info: {
    bg: 'var(--w-surface)',
    border: 'var(--w-info)',
    iconColor: 'var(--w-info)',
  },
  success: {
    bg: 'var(--w-surface)',
    border: 'var(--w-success)',
    iconColor: 'var(--w-success)',
  },
  attention: {
    bg: 'var(--w-surface)',
    border: 'var(--w-attention)',
    iconColor: 'var(--w-attention)',
  },
  danger: {
    bg: 'var(--w-danger-soft)',
    border: 'var(--w-danger)',
    iconColor: 'var(--w-danger)',
  },
};

export interface ToastProps {
  item: ToastItem;
  onDismiss: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Toast: React.FC<ToastProps> = ({
  item,
  onDismiss,
  className = '',
  style,
}) => {
  const {
    id,
    title,
    description,
    variant = 'info',
    onRetry,
    retryLabel,
    dismissLabel,
    'data-action': dataAction,
    'data-testid': dataTestId,
  } = item;

  const config = VARIANT_COLORS[variant];
  const role = variant === 'danger' ? 'alert' : 'status';

  return (
    <div
      role={role}
      data-variant={variant}
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-toast w-toast--${variant} ${className}`.trim()}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--w-space-3)',
        paddingBlock: 'var(--w-space-3)',
        paddingInline: 'var(--w-space-4)',
        backgroundColor: config.bg,
        border: 'var(--w-border-width) solid var(--w-line)',
        borderInlineStart: 'var(--w-space-1) solid ' + config.border,
        borderRadius: 'var(--w-radius-md)',
        boxShadow: 'var(--w-shadow-2)',
        color: 'var(--w-text)',
        fontFamily: 'var(--w-font-sans)',
        fontSize: 'var(--w-font-size-sm)',
        lineHeight: 'var(--w-line-height-sm)',
        minWidth: 'var(--w-rail-width)',
        maxWidth: 'var(--w-content-narrow)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          color: config.iconColor,
          display: 'inline-flex',
          marginTop: 'var(--w-space-1)',
          flexShrink: 0,
        }}
      >
        {VARIANT_ICONS[variant]}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div
            style={{
              fontWeight: 'var(--w-font-weight-semibold)',
              marginBottom: description ? 'var(--w-space-1)' : 0,
            }}
          >
            {title}
          </div>
        )}
        {description && <div>{description}</div>}

        {onRetry && retryLabel && (
          <div style={{ marginTop: 'var(--w-space-2)' }}>
            <Button
              variant="secondary"
              size="sm"
              icon={<IconRefresh size={14} />}
              onClick={() => {
                onRetry();
                onDismiss(id);
              }}
              data-action="toast.retry"
            >
              {retryLabel}
            </Button>
          </div>
        )}
      </div>

      {(dismissLabel || variant === 'danger') && (
        <IconButton
          icon={<IconX size={16} />}
          label={dismissLabel || 'Close'}
          variant="ghost"
          size="sm"
          onClick={() => onDismiss(id)}
          data-action="toast.dismiss"
          data-testid="toast-dismiss-button"
        />
      )}
    </div>
  );
};

Toast.displayName = 'Toast';

export interface ToastProviderProps {
  children: React.ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const idCounter = React.useRef(0);
  const timers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = React.useCallback((id: string) => {
    const existingTimer = timers.current.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clear = React.useCallback(() => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
    setToasts([]);
  }, []);

  React.useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((timer) => clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  const toast = React.useCallback(
    (options: Omit<ToastItem, 'id'> & { id?: string; actionId?: string }) => {
      idCounter.current += 1;
      const id =
        options.id ??
        (options.actionId ? `w-toast-action-${options.actionId}` : `w-toast-${idCounter.current}`);
      const isError = options.variant === 'danger' || (options.variant as string) === 'error';
      const variant: ToastVariant = (options.variant as string) === 'error' ? 'danger' : (options.variant ?? 'info');
      const duration = options.duration ?? (isError ? 0 : AUTO_DISMISS_DURATION);

      const newItem: ToastItem = {
        ...options,
        id,
        variant,
        duration,
      };

      const existingTimer = timers.current.get(id);
      if (existingTimer) {
        clearTimeout(existingTimer);
        timers.current.delete(id);
      }

      setToasts((prev) => {
        const existingIndex = prev.findIndex(
          (t) => t.id === id || (Boolean(options.actionId) && t.actionId === options.actionId)
        );

        let next: ToastItem[];
        if (existingIndex >= 0) {
          next = [...prev];
          next[existingIndex] = newItem;
        } else {
          next = [...prev, newItem];
        }

        if (next.length > MAX_VISIBLE_TOASTS) {
          const evicted = next.slice(0, next.length - MAX_VISIBLE_TOASTS);
          for (const item of evicted) {
            const timer = timers.current.get(item.id);
            if (timer) {
              clearTimeout(timer);
              timers.current.delete(item.id);
            }
          }
          next = next.slice(-MAX_VISIBLE_TOASTS);
        }
        return next;
      });

      if (duration > 0) {
        const timer = setTimeout(() => {
          dismiss(id);
        }, duration);
        timers.current.set(id, timer);
      }

      return id;
    },
    [dismiss]
  );

  const contextValue = React.useMemo<ToastContextValue>(
    () => ({
      toasts,
      toast,
      dismiss,
      clear,
    }),
    [toasts, toast, dismiss, clear]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div
        role="region"
        aria-live="polite"
        className="w-toast-container"
      >
        {toasts.map((item) => (
          <div key={item.id} className="w-toast-wrapper">
            <Toast item={item} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

ToastProvider.displayName = 'ToastProvider';
