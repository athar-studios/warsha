// apps/desktop/src/v3/webmcp/setting.ts — X9a: the device-scoped switch behind the four tools.
//
// Copied in shape from `app/soundCues.ts` (R-UI-3 D2-b/D2-c), because the two switches answer the same questions:
// a boolean belongs on the device, not in the decaying preferences store (W11); absent means off, so the feature is
// off after a fresh install and after every upgrade; a blocked storage API means off rather than a guess; and an
// in-tab event is needed because `storage` fires only in *other* tabs.

/** `'on'` means on; absent means off. Never written by an upgrade, never written by the daemon. */
export const WEBMCP_STORAGE_KEY = 'warsha.webmcp';

/** In-tab notification: `localStorage` only fires `storage` in *other* tabs. */
const WEBMCP_EVENT = 'warsha:webmcp';

export function readWebMcpEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(WEBMCP_STORAGE_KEY) === 'on';
  } catch {
    // Storage blocked (private mode, disabled): the tools stay unregistered.
    return false;
  }
}

export function writeWebMcpEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;

  try {
    if (enabled) {
      window.localStorage.setItem(WEBMCP_STORAGE_KEY, 'on');
    } else {
      window.localStorage.removeItem(WEBMCP_STORAGE_KEY);
    }
  } catch {
    // Storage blocked: the switch still reflects the click for this session.
  }

  window.dispatchEvent(new Event(WEBMCP_EVENT));
}

/** Listens in this tab (the Settings switch) and across tabs (the plain `storage` event). */
export function subscribeWebMcpEnabled(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const onLocal = (): void => listener(readWebMcpEnabled());
  const onStorage = (event: StorageEvent): void => {
    if (event.key === WEBMCP_STORAGE_KEY || event.key === null) listener(readWebMcpEnabled());
  };

  window.addEventListener(WEBMCP_EVENT, onLocal);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(WEBMCP_EVENT, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}
