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

/**
 * The slice of `sessionStorage` this module needs, so a test can pass its own.
 *
 * The same three methods are what a native keystore adapter has to answer with, which is why the
 * interface — and not `Storage` — is the seam.
 */
export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The Android bridge the Capacitor shell injects as `window.WarshaNative`.
 *
 * `loadSecret`/`saveSecret`/`deleteSecret` are backed by the Android Keystore (AES-256-GCM at rest),
 * so a session token kept through the bridge never sits in a world-readable WebView file. The
 * methods answer synchronously because the shell bridges them that way; a key the keystore cannot
 * produce reads back as `null`, and a write the keystore refuses returns `false`.
 *
 * `getInitialPairingUri` exposes the deep link that launched the app, if any — the cold-start twin
 * of the `warsha:pair-deeplink` event a warm start receives.
 */
export interface WarshaNativeBridge {
  loadSecret(key: string): string | null;
  saveSecret(key: string, value: string): boolean;
  deleteSecret(key: string): boolean;
  getInitialPairingUri?(): string | null;
}

declare global {
  interface Window {
    WarshaNative?: WarshaNativeBridge;
  }
}

/** The native bridge when the app runs inside the Capacitor shell, `null` in a plain browser. */
export function warshaNativeBridge(): WarshaNativeBridge | null {
  try {
    if (typeof window === 'undefined') return null;
    const bridge = window.WarshaNative;
    if (
      bridge === undefined ||
      typeof bridge.loadSecret !== 'function' ||
      typeof bridge.saveSecret !== 'function' ||
      typeof bridge.deleteSecret !== 'function'
    ) {
      return null;
    }
    return bridge;
  } catch {
    return null;
  }
}

/**
 * A `SessionStore` backed by the native bridge.
 *
 * `setItem`/`removeItem` report failure by throwing, so the callers' existing try/catch — the one
 * that treats a blocked store as "this tab still works, the memory does not" — keeps working
 * unchanged when the store is the keystore.
 */
export function nativeSessionStore(bridge: WarshaNativeBridge): SessionStore {
  return {
    getItem: (key) => bridge.loadSecret(key),
    setItem: (key, value) => {
      if (!bridge.saveSecret(key, value)) {
        throw new Error('native keystore refused the write');
      }
    },
    removeItem: (key) => {
      if (!bridge.deleteSecret(key)) {
        throw new Error('native keystore refused the delete');
      }
    },
  };
}

/**
 * The store this session's token is remembered in.
 *
 * The native keystore wins whenever the shell provides one — at-rest encryption is strictly better
 * than the WebView's plaintext `sessionStorage` — and a plain browser keeps `sessionStorage`. A
 * blocked or absent store costs the *remembered* session, not the current one.
 */
export function sessionStore(): SessionStore | null {
  const bridge = warshaNativeBridge();
  if (bridge !== null) return nativeSessionStore(bridge);
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The protocols a daemon may be reached at. Anything else is refused, not repaired. */
const ALLOWED_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/** Four dot-separated decimal octets — and nothing that walks outside 0–255. */
const IPV4_OCTETS = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** The IPv4 first octet of a private range that may be reached in cleartext (10/8, 127/8). */
function privateFirstOctet(a: number): boolean {
  return a === 10 || a === 127;
}

/** 172.16.0.0/12 — the second octet is what bounds it, not the first alone. */
function is172Range(a: number, b: number): boolean {
  return a === 172 && b >= 16 && b <= 31;
}

/** 100.64.0.0/10 — Tailscale's CGNAT range; a tailnet is a private network by construction. */
function isCgnatRange(a: number, b: number): boolean {
  return a === 100 && b >= 64 && b <= 127;
}

/**
 * A host `http://` (cleartext) may be aimed at.
 *
 * The pairing link is typed or pasted on a phone that is usually *not* on the daemon's LAN, so
 * cleartext to the open internet would leak the session token on every request. The daemon's own
 * pairing flow prints LAN/tailnet addresses, so those — and nothing else — are allowed without TLS:
 *
 *   * loopback: `localhost`, `127/8` (the desktop's own daemon), `::1` (also `http://[::1]:8766`);
 *   * `10.0.2.2`, the Android emulator's alias for the host machine, which 10/8 already covers;
 *   * RFC1918: `10/8`, `172.16–31`, `192.168/16` — the home/office LANs pairing lives on;
 *   * Tailscale: `100.64–127` (CGNAT) and `*.ts.net` hostnames — a tailnet's addresses are private
 *     by construction;
 *   * mDNS: `*.local` — the same LAN claim, spelled as a name.
 *
 * Anything else — a public IPv4, a public hostname, anything that merely fails to parse as a
 * private address — is not cleartext-allowed, and the caller refuses the link rather than repairing it.
 */
export function isPrivateCleartextHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === '') return false;

  // `new URL` brackets IPv6 hosts; the bare form appears in some stores.
  const bracketed = host.startsWith('[') && host.endsWith(']');
  const bare = bracketed ? host.slice(1, -1) : host;

  if (bracketed) return bare === '::1';
  if (bare === '::1') return true;

  if (host === 'localhost') return true;
  if (host.endsWith('.local') || host.endsWith('.ts.net')) return true;

  const octets = IPV4_OCTETS.exec(bare);
  if (octets === null) return false;
  const [a, b] = [Number(octets[1]), Number(octets[2])];
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
  if ([a, b, Number(octets[3]), Number(octets[4])].some((n) => n > 255)) return false;

  return privateFirstOctet(a) || is172Range(a, b) || (a === 192 && b === 168) || isCgnatRange(a, b);
}

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
  // Cleartext is trusted only inside the private networks a pairing link actually comes from (§ above).
  if (url.protocol === 'http:' && !isPrivateCleartextHost(url.hostname)) return null;
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
 * The session a `warsha://pair` deep link carries.
 *
 * The native apps register the `warsha:` scheme, so their pairing links arrive as
 * `warsha://pair?...` rather than as a page URL. Two parameter shapes are accepted, because the
 * desktop dialog and the native share sheet describe the daemon differently:
 *
 *   * `server` — the daemon's absolute URL, checked by `readDaemonUrl` like any other link, so a
 *     `warsha:` link gets no cleartext exemption the web link would refuse;
 *   * `host` + `port` (with optional `scheme`, default `http`) — the daemon spelled in parts, which
 *     is reassembled and put through the *same* `readDaemonUrl` gate.
 *
 * The token is the `token` parameter either way. A `warsha:` link with neither shape is refused
 * with `url`, the same refusal a malformed address gets.
 */
function parseDeepLink(link: URL): PairingResult {
  const params = link.searchParams;
  if (carriesApiKey(params)) return { ok: false, reason: 'userinfo' };

  const server = params.get(SERVER_PARAM);
  let daemonUrl: string | null = server;
  if (daemonUrl === null && params.get('host') !== null) {
    const host = params.get('host');
    const port = params.get('port');
    const schemeParam = params.get('scheme');
    const scheme = schemeParam === 'https' ? 'https:' : 'http:';
    if (schemeParam !== null && schemeParam !== 'http' && schemeParam !== 'https') {
      return { ok: false, reason: 'url' };
    }
    // Reassemble, then let `readDaemonUrl` police it — including the cleartext host policy.
    daemonUrl = `${scheme}//${host}${port === null || port === '' ? '' : `:${port}`}`;
  }
  if (daemonUrl === null) return { ok: false, reason: 'url' };

  const daemon = readDaemonUrl(daemonUrl);
  if (daemon === null) return { ok: false, reason: 'url' };

  const token = readToken(params.get(TOKEN_PARAM));
  if (token === null) return { ok: false, reason: 'token' };

  const session = buildSession(daemon.toString(), token);
  return session === null ? { ok: false, reason: 'url' } : { ok: true, session };
}

/**
 * The session a pairing link carries.
 *
 * Three shapes are accepted, because the desktop's dialog, a relay's redirect and the native
 * `warsha:` handler do not always agree:
 *
 *   * a **PWA link** — `https://remote.example/?server=https%3A%2F%2F10.0.0.5%3A8766&token=…`, where
 *     `server` names the daemon and `token` is this device's access token;
 *   * a **daemon link** — `https://10.0.0.5:8766/?token=…`, where the address itself is the daemon;
 *   * a **deep link** — `warsha://pair?server=…&token=…` (or `host`/`port`/`token`), the shape the
 *     native apps hand over; see `parseDeepLink`.
 */
export function parsePairingLink(value: string): PairingResult {
  const raw = value.trim();
  if (raw === '') return { ok: false, reason: 'missing' };

  // The native scheme arrives before any web URL is attempted. `warsha:pair` and `warsha://pair`
  // are the same intent; anything else on the scheme (a stale `warsha:run?id=…`) is not a pairing.
  if (raw.toLowerCase().startsWith('warsha:')) {
    let link: URL;
    try {
      link = new URL(raw);
    } catch {
      return { ok: false, reason: 'url' };
    }
    // `warsha://pair` arrives with host `pair`; `warsha:pair` with path `pair`. Either is a pairing;
    // any other `warsha:` target (a stale `warsha:run?id=…`) is not this link kind and is refused.
    const isPair = link.hostname === 'pair' || (link.hostname === '' && link.pathname === 'pair');
    if (!isPair) return { ok: false, reason: 'url' };
    return parseDeepLink(link);
  }

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
