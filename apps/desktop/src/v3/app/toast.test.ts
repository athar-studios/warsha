import { describe, expect, it, vi } from 'vitest';

import {
  clearToastListeners,
  notify,
  stripDuplicateHttpPrefix,
  subscribeToast,
  type ToastMessage,
} from './toast';

describe('toast app module', () => {
  describe('stripDuplicateHttpPrefix (N11)', () => {
    it('strips duplicate HTTP status prefix composed by daemon + frontend', () => {
      expect(
        stripDuplicateHttpPrefix('HTTP 400: HTTP 400: {"error":"invalid params"}')
      ).toBe('HTTP 400: {"error":"invalid params"}');
      expect(
        stripDuplicateHttpPrefix('HTTP 500: HTTP 500: HTTP 500: Internal Server Error')
      ).toBe('HTTP 500: Internal Server Error');
    });

    it('preserves single HTTP prefix or plain message', () => {
      expect(stripDuplicateHttpPrefix('HTTP 404: Resource not found')).toBe(
        'HTTP 404: Resource not found'
      );
      expect(stripDuplicateHttpPrefix('Connection timed out')).toBe('Connection timed out');
      expect(stripDuplicateHttpPrefix('')).toBe('');
    });
  });

  describe('notify and subscribeToast', () => {
    it('notifies subscribers with sanitized message and stable id from actionId', () => {
      clearToastListeners();
      const received: ToastMessage[] = [];
      const unsubscribe = subscribeToast((t) => received.push(t));

      notify({
        type: 'error',
        message: 'HTTP 400: HTTP 400: connection timeout',
        actionId: 'onboarding.connect',
      });

      expect(received).toHaveLength(1);
      expect(received[0].message).toBe('HTTP 400: connection timeout');
      expect(received[0].id).toBe('toast-action-onboarding.connect');
      expect(received[0].actionId).toBe('onboarding.connect');

      unsubscribe();

      notify({
        type: 'info',
        message: 'another message',
      });

      // No new notifications after unsubscribe
      expect(received).toHaveLength(1);
    });

    it('uses explicit id when provided and handles listener errors gracefully', () => {
      clearToastListeners();
      const goodListener = vi.fn();
      const faultyListener = vi.fn().mockImplementation(() => {
        throw new Error('boom');
      });

      subscribeToast(faultyListener);
      subscribeToast(goodListener);

      expect(() => {
        notify({
          id: 'custom-toast-id',
          type: 'success',
          message: 'Saved successfully',
        });
      }).not.toThrow();

      expect(goodListener).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'custom-toast-id',
          message: 'Saved successfully',
          type: 'success',
        })
      );
    });
  });
});
