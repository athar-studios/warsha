export interface ToastMessage {
  id?: string;
  type: 'error' | 'success' | 'info' | 'warning';
  message: string;
  actionId?: string;
  timestamp?: number;
}

export type ToastListener = (toast: ToastMessage) => void;

const listeners = new Set<ToastListener>();

/**
 * Strips duplicated HTTP status prefixes composed by daemon wrapper + frontend wrapper (N11).
 * E.g. "HTTP 400: HTTP 400: {..." -> "HTTP 400: {..."
 */
export function stripDuplicateHttpPrefix(message: string): string {
  if (!message) return message;
  return message.replace(/^(HTTP\s+\d+:\s*)(?:HTTP\s+\d+:\s*)+/i, '$1');
}

export function notify(toast: ToastMessage): void {
  const sanitizedMessage = stripDuplicateHttpPrefix(toast.message);
  const id =
    toast.id ??
    (toast.actionId
      ? `toast-action-${toast.actionId}`
      : `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const payload: ToastMessage = {
    ...toast,
    id,
    message: sanitizedMessage,
    timestamp: toast.timestamp ?? Date.now(),
  };

  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // Listener failures must not propagate
    }
  }
}

export function subscribeToast(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearToastListeners(): void {
  listeners.clear();
}
