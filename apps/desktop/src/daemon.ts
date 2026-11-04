// The daemon endpoint the shell resolved: where RPC answers, where `/events` answers, and
// the credential that reaches both.
//
// The shell starts `warshad` itself and lets the OS choose the ports, so none of these three
// values can be a constant in the frontend. `apps/desktop/src-tauri/src/lib.rs` publishes them
// as the `daemon_url`, `daemon_ws_url` and `daemon_token` config keys, and this module is the
// only place that reads them back and shapes them:
//
//   * `daemon_url` is the JSON-RPC base — the daemon's RPC listener, reported as `http://` on
//     the daemon's `ws_port` (8766 by default; `crates/warshad/src/lib.rs` binds the RPC
//     address from `config.ws_port`);
//   * `daemon_ws_url` is where `/events` is actually served — the daemon's axum HTTP listener
//     already in socket form (`ws://127.0.0.1:8765`), because the RPC port is not the events
//     port and one cannot be derived from the other;
//   * `daemon_token` is the session's bearer credential — the only token that can authenticate
//     the socket handshake's `warsha.token.<token>` subprotocol
//     (`crates/warshad/tests/events_ws_auth.rs` pins that path).
//
// What this file refuses to do is invent any of it. A value the shell did not report, or
// reported in the wrong shape, stays the empty string — "not resolved" — and every consumer
// treats that as its offline state rather than as a licence to guess a port or fabricate a
// credential. A fake secret literal in the render path is what the project's secret-hygiene
// rules forbid; an empty one is what honesty under an absent shell looks like.

/** Where the daemon is, and the token that reaches it — all three as the shell reported them. */
export interface DaemonEndpoint {
  /** JSON-RPC base URL (`daemon_url`), or `''` when the shell reported nothing usable. */
  baseUrl: string;
  /** The `/events` WebSocket base (`daemon_ws_url`), or `''` when nothing usable was reported. */
  eventsUrl: string;
  /** The session bearer token (`daemon_token`), or `''` when the shell reported none. */
  token: string;
}

/** What an app without a shell (a plain browser) starts with: nothing, said as nothing. */
export const UNRESOLVED_ENDPOINT: DaemonEndpoint = { baseUrl: '', eventsUrl: '', token: '' };

/** Whether `value` is a usable HTTP(S) base URL, tolerating nothing else. */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value);
}

/** Whether `value` is a usable WebSocket base URL — the shape `/events` is reported in. */
function isSocketUrl(value: string): boolean {
  return /^wss?:\/\/\S+$/.test(value);
}

/**
 * Shape one `get_config` read into a `DaemonEndpoint`.
 *
 * Pure, so the rule "a malformed or absent report resolves to nothing" is testable without a
 * shell or a socket: an HTTP URL is kept for the RPC base and only an HTTP URL; a `ws(s)` URL
 * is kept for the events base and only a `ws(s)` URL — the events endpoint is never derived
 * from the RPC base, because they live on different listeners; a non-empty token is carried
 * through verbatim and an empty one stays empty. Trailing slashes are trimmed, since the
 * client appends `/rpc` and `subscribeEvents` appends `/events`.
 */
export function resolveDaemonEndpoint(config: {
  url: string;
  wsUrl: string;
  token: string;
}): DaemonEndpoint {
  return {
    baseUrl: isHttpUrl(config.url) ? config.url.replace(/\/+$/, '') : '',
    eventsUrl: isSocketUrl(config.wsUrl) ? config.wsUrl.replace(/\/+$/, '') : '',
    token: config.token === '' ? '' : config.token,
  };
}

/**
 * Read the three shell config keys and resolve them.
 *
 * `read` is injected (the App's `readConfig`, which answers `''` when there is no shell) so
 * this stays a Tauri-free seam a test can drive with fixed answers.
 */
export async function readDaemonEndpoint(
  read: (key: string) => Promise<string>
): Promise<DaemonEndpoint> {
  const [url, wsUrl, token] = await Promise.all([
    read('daemon_url'),
    read('daemon_ws_url'),
    read('daemon_token'),
  ]);
  return resolveDaemonEndpoint({ url, wsUrl, token });
}
