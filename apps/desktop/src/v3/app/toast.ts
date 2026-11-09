export interface ToastMessage {
  id?: string;
  type: 'error' | 'success' | 'info' | 'warning';
  message: string;
  actionId?: string;
  timestamp?: number;
}

export type ToastListener = (toast: ToastMessage) => void;

const listeners = new Set<ToastListener>();

export function notify(toast: ToastMessage): void {
  const payload: ToastMessage = {
    ...toast,
    id: toast.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
