// packages/ui/src/v3/composites/Toast.tsx — Design System v3 Toast (DS v3 §3.2)
// ToastProvider + useToast(). Auto-dismiss 5000ms except errors. Errors persist with retry callback.

import React from 'react';

import { IconAlert, IconCheck, IconInfo, IconRefresh, IconX } from '../icons';
import { Button } from '../primitives/Button';
import { IconButton } from '../primitives/IconButton';

export type ToastVariant = 'info' | 'success' | 'attention' | 'danger';

export interface ToastItem {
  id: string;
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
  toast: (options: Omit<ToastItem, 'id'> & { id?: string }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

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

      {dismissLabel && (
        <IconButton
          icon={<IconX size={16} />}
          label={dismissLabel}
          variant="ghost"
          size="sm"
          onClick={() => onDismiss(id)}
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

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clear = React.useCallback(() => {
    setToasts([]);
  }, []);

  const toast = React.useCallback(
    (options: Omit<ToastItem, 'id'> & { id?: string }) => {
      idCounter.current += 1;
      const id = options.id ?? `w-toast-${idCounter.current}`;
      const isError = options.variant === 'danger';
      const duration = options.duration ?? (isError ? 0 : 5000);

      const newItem: ToastItem = {
        ...options,
        id,
        duration,
      };

      setToasts((prev) => [...prev, newItem]);

      if (duration > 0) {
        setTimeout(() => {
          dismiss(id);
        }, duration);
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
        style={{
          position: 'fixed',
          insetBlockEnd: 'var(--w-space-5)',
          insetInlineEnd: 'var(--w-space-5)',
          zIndex: 'var(--w-layer-toast)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w-space-2)',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((item) => (
          <div key={item.id} style={{ pointerEvents: 'auto' }}>
            <Toast item={item} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

ToastProvider.displayName = 'ToastProvider';
