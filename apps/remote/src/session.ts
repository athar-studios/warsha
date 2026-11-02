// @warsha/remote — the pairing hand-off and the session this phone holds.
//
// The remote bench is a client of the same daemon the desktop talks to (`docs/DAEMON.md`: "every
// client … is a thin caller"), and it reaches it the way the pairing flow hands a phone a session:
// the desktop's “Pair new device” dialog produces a link, the owner opens or pastes that link here,
// and this module turns it into a `{ baseUrl, token }` pair that `@warsha/client` can drive.
//
// Three rules shape the whole file, and they are security rules rather than style preferences:
//
//   * **the token is session-scoped.** It goes to `sessionStorage`, never to `localStorage`: closing
//     the tab ends the device's access, and a shared phone does not keep an owner's session for the
//     next hand. A blocked or absent store costs the *remembered* session, not the current one.
//   * **the token does not stay in the address.** Once it has been read out of the URL it is stripped
//     with `history.replaceState`, so it cannot be re-read from the address bar, a screenshot, a
//     browser-history export or a link the owner forwards.
//   * **credentials never travel in the address of the daemon.** A link whose daemon URL embeds
//     `user:pass@` is refused rather than normalised — the wire contract (`@warsha/client`) carries
//     the token in a header and a WebSocket subprotocol, so a URL that needs a password is a mistake
//     the owner should be told about, not something to silently repair.
//
// Nothing here speaks to the network: `@warsha/client` owns the RPC and the event stream, and the
// architecture rule R5 (`docs/ARCH_RULES.md`) keeps the UI from opening its own sockets.
import { redactToken } from '@warsha/client';

/** What a session needs to reach a daemon: where it is, and the token this device pairs with. */
export interface DaemonSession {
  readonly baseUrl: string;
  readonly token: string;
}

/** The `sessionStorage` key holding the session. Named like `warsha.locale` / `warsha.theme`. */
export const SESSION_STORAGE_KEY = 'warsha.remote.session';

/** The query parameters a pairing link may carry. */
export const SERVER_PARAM = 'server';
export const TOKEN_PARAM = 'token';

/** Why a pairing link was refused — each one has its own sentence in the catalog. */
export type PairingFailure = 'missing' | 'url' | 'token' | 'userinfo';

export type PairingResult =
  | { readonly ok: true; readonly session: DaemonSession }
  | { readonly ok: false; readonly reason: PairingFailure };

/** The slice of `sessionStorage` this module needs, so a test can pass its own. */
export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `sessionStorage` when the browser gives us one, `null` when it is blocked or absent. */
export function sessionStore(): SessionStore | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The protocols a daemon may be reached at. Anything else is refused, not repaired. */
const ALLOWED_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/** One absolute URL, or `null` when the text is not one, is not http(s), hides credentials or has no host. */
function readDaemonUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) return null;
  // `user:pass@host` is a credential in the address: the pairing link never carries one.
  if (url.username !== '' || url.password !== '') return null;
  if (url.hostname === '') return null;
  return url;
}

/** A token is opaque text with no whitespace and no separator the link syntax already means. */
function readToken(value: string | null): string | null {
  if (value === null) return null;
  const token = value.trim();
  if (token === '') return null;
  if (/[\s#&+]/.test(token)) return null;
  return token;
}

/**
 * A session from the two parts a pairing flow carries, or `null` when either part is not one.
 *
 * The daemon address is always written without its query: the token is already held by the session,
 * and a `baseUrl` that ends in `?token=…` would put it back on the wire in every RPC URL. Scheme,
 * host, port and path survive — a daemon behind a reverse proxy lives under a path.
 */
export function buildSession(baseUrl: string, token: string): DaemonSession | null {
  const daemon = readDaemonUrl(baseUrl);
  const secret = readToken(token);
  if (daemon === null || secret === null) return null;
  const origin = `${daemon.protocol}//${daemon.host}${daemon.pathname}`.replace(/\/+$/, '');
  return { baseUrl: origin, token: secret };
}

/** A pairing link that asks for an API key or a provider key in its query is not a pairing link. */
function carriesApiKey(params: URLSearchParams): boolean {
  return params.has('api_key') || params.has('key');
}

/**
 * The session a pairing link carries.
 *
 * Two shapes are accepted, because the desktop's dialog and a relay's redirect do not always agree:
 *
 *   * a **PWA link** — `https://remote.example/?server=https%3A%2F%2F10.0.0.5%3A8766&token=…`, where
 *     `server` names the daemon and `token` is this device's access token;
 *   * a **daemon link** — `https://10.0.0.5:8766/?token=…`, where the address itself is the daemon.
 */
export function parsePairingLink(value: string): PairingResult {
  const raw = value.trim();
  if (raw === '') return { ok: false, reason: 'missing' };

  const link = readDaemonUrl(raw);
  if (link === null) return { ok: false, reason: 'url' };
  if (carriesApiKey(link.searchParams)) return { ok: false, reason: 'userinfo' };

  const serverParam = link.searchParams.get(SERVER_PARAM);
  // A PWA link names the daemon in `server`; a daemon link is its own address.
  const daemon = readDaemonUrl(serverParam ?? link.toString());
  if (daemon === null) return { ok: false, reason: 'url' };

  const token =
    readToken(link.searchParams.get(TOKEN_PARAM)) ?? readToken(daemon.searchParams.get(TOKEN_PARAM));
  if (token === null) return { ok: false, reason: 'token' };

  const session = buildSession(daemon.toString(), token);
  return session === null ? { ok: false, reason: 'url' } : { ok: true, session };
}

/**
 * The session a URL's query carries.
 *
 * `window.location.search` and a bare `server=…&token=…` both work. With no `server` parameter there
 * is no daemon to reach from a query alone, and the answer is the same `url` refusal the link gives.
 */
export function readSessionFromSearch(search: string): PairingResult {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (carriesApiKey(params)) return { ok: false, reason: 'userinfo' };

  const server = params.get(SERVER_PARAM);
  if (server === null) return { ok: false, reason: 'url' };

  const token = readToken(params.get(TOKEN_PARAM));
  if (token === null) return { ok: false, reason: 'token' };

  const session = buildSession(server, token);
  return session === null ? { ok: false, reason: 'url' } : { ok: true, session };
}

/**
 * The stored session, or `null`.
 *
 * A row this module cannot read is discarded rather than trusted: a half-written JSON blob is not a
 * session, and a screen that rendered one would be showing a broken endpoint as if it were paired.
 */
export function readStoredSession(store: SessionStore | null = sessionStore()): DaemonSession | null {
  if (store === null) return null;
  let stored: string | null = null;
  try {
    stored = store.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (stored === null || stored === '') return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return null;

  const source = decoded as Record<string, unknown>;
  if (typeof source.baseUrl !== 'string' || typeof source.token !== 'string') return null;

  // The same gate a fresh pairing link passes: what was stored must still be a session this module
  // would have accepted, or it is not one.
  return buildSession(source.baseUrl, source.token);
}

/** Record the session for this tab. Returns whether it was actually stored. */
export function storeSession(session: DaemonSession, store: SessionStore | null = sessionStore()): boolean {
  if (store === null) return false;
  try {
    store.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch {
    // A private-mode store costs the remembered session; the owner is still paired for this tab.
    return false;
  }
}

/** Forget the session on this device — the token goes, and the bench goes back to the pairing plate. */
export function clearStoredSession(store: SessionStore | null = sessionStore()): void {
  if (store === null) return;
  try {
    store.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Nothing to retry: the store that will not delete will not have kept the token either.
  }
}

/**
 * Drop the pairing parameters from the address bar.
 *
 * `replaceState` rather than a navigation: the owner's back button must not step into a URL that
 * held the token, and there is nothing to re-render — the session is already in memory.
 */
export function stripSessionParams(search: string): string {
  const query = search.startsWith('?') ? search.slice(1) : search;
  if (query === '') return '';
  const kept = query
    .split('&')
    .filter((pair) => pair !== '')
    .filter((pair) => {
      const name = pair.split('=')[0]?.toLowerCase();
      return name !== SERVER_PARAM && name !== TOKEN_PARAM;
    });
  return kept.length === 0 ? '' : `?${kept.join('&')}`;
}

/**
 * The `/events` address for a daemon base URL.
 *
 * `subscribeEvents` appends `/events` to whatever it is given and opens a WebSocket, so an `http://`
 * base has to arrive as `ws://` (and `https://` as `wss://`) — the same client contract the desktop
 * bench follows.
 */
export function eventStreamUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/i, 'ws');
}

/**
 * An error the owner can be shown.
 *
 * Every daemon failure passes through here before it reaches the screen: the token is in the URL the
 * RPC was aimed at and in the WebSocket handshake, so an un-redacted `Error.message` can hand it back
 * to a screenshot, a log or the DOM. `redactToken` is the client's own function, so the reading of
 * "what must never appear" is stated once for the whole repository.
 */
export function safeMessage(message: string, session: DaemonSession | null): string {
  return session === null ? message : redactToken(message, session.token);
}

/** The daemon host the pairing plate and the settings screen report — machine data, never a secret. */
export function endpointHost(session: DaemonSession | null): string {
  if (session === null) return '';
  try {
    return new URL(session.baseUrl).host;
  } catch {
    return session.baseUrl;
  }
}
