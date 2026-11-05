// @warsha/remote — the pairing hand-off and the session this tab holds.
//
// This module is the only place the phone touches a credential, so the tests are mostly about what it
// must refuse, and about the promise the pairing plate makes out loud: the token lives in this tab, is
// stripped from the address, and never comes back in a message.
import { describe, expect, it } from 'vitest';

import {
  clearStoredSession,
  endpointHost,
  eventStreamUrl,
  isPrivateCleartextHost,
  nativeSessionStore,
  parsePairingLink,
  readSessionFromSearch,
  readStoredSession,
  safeMessage,
  SESSION_STORAGE_KEY,
  sessionStore,
  storeSession,
  stripSessionParams,
  warshaNativeBridge,
  type WarshaNativeBridge,
} from './session';
import { memoryStore } from './testkit';

describe('parsePairingLink', () => {
  it('takes the daemon and the token out of a PWA pairing link', () => {
    const link = 'https://remote.example.com/?server=https%3A%2F%2F10.0.0.5%3A8766&token=abc123';
    const parsed = parsePairingLink(link);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.session.baseUrl).toBe('https://10.0.0.5:8766');
      expect(parsed.session.token).toBe('abc123');
    }
  });

  it('reads a link that is the daemon itself', () => {
    const parsed = parsePairingLink('http://127.0.0.1:8766/?token=zz9');

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.session.baseUrl).toBe('http://127.0.0.1:8766');
  });

  it('never keeps a query on the daemon address', () => {
    // A `baseUrl` that ended in `?token=…` would put the token back into every RPC URL.
    const parsed = parsePairingLink('https://host.example/rpc/?token=abc&other=1');

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.session.baseUrl).toBe('https://host.example/rpc');
  });

  it('keeps the path a reverse proxy put the daemon behind', () => {
    const parsed = parsePairingLink('https://gate.example.com/warsha/?token=abc');

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.session.baseUrl).toBe('https://gate.example.com/warsha');
  });

  it('refuses an empty field with its own reason', () => {
    expect(parsePairingLink('   ')).toEqual({ ok: false, reason: 'missing' });
  });

  it('refuses text that is not an http(s) address', () => {
    expect(parsePairingLink('not a link')).toEqual({ ok: false, reason: 'url' });
    expect(parsePairingLink('ftp://host.example/?token=abc')).toEqual({ ok: false, reason: 'url' });
    expect(parsePairingLink('javascript:alert(1)')).toEqual({ ok: false, reason: 'url' });
  });

  it('refuses a link that asks for an API key', () => {
    // The pairing link carries the device token. A `key=` is an owner pasting the wrong secret, and
    // accepting it would put a provider key in the session.
    const parsed = parsePairingLink('https://host.example/?token=abc&api_key=sk-1234');
    expect(parsed).toEqual({ ok: false, reason: 'userinfo' });
  });

  it('refuses a daemon address that hides credentials in it', () => {
    const parsed = parsePairingLink('https://admin:pw@host.example/?token=abc');
    expect(parsed.ok).toBe(false);
  });

  it('refuses a link with no token, and a token the link syntax cannot carry', () => {
    expect(parsePairingLink('https://host.example/')).toEqual({ ok: false, reason: 'token' });
    expect(parsePairingLink('https://host.example/?token=%20%20')).toEqual({ ok: false, reason: 'token' });
  });
});

describe('the cleartext host policy', () => {
  it('trusts the private networks a pairing link comes from', () => {
    expect(isPrivateCleartextHost('localhost')).toBe(true);
    expect(isPrivateCleartextHost('127.0.0.1')).toBe(true);
    expect(isPrivateCleartextHost('127.5.5.5')).toBe(true);
    // The Android emulator's alias for the host machine lives inside 10/8.
    expect(isPrivateCleartextHost('10.0.2.2')).toBe(true);
    expect(isPrivateCleartextHost('10.255.0.1')).toBe(true);
    expect(isPrivateCleartextHost('172.16.0.1')).toBe(true);
    expect(isPrivateCleartextHost('172.31.255.255')).toBe(true);
    expect(isPrivateCleartextHost('192.168.1.50')).toBe(true);
    // Tailscale's CGNAT range and its MagicDNS hostnames.
    expect(isPrivateCleartextHost('100.64.0.1')).toBe(true);
    expect(isPrivateCleartextHost('100.127.255.255')).toBe(true);
    expect(isPrivateCleartextHost('desktop.ts.net')).toBe(true);
    // mDNS names, the LAN spelled as a name.
    expect(isPrivateCleartextHost('warsha-box.local')).toBe(true);
    // IPv6 loopback, bracketed as a URL carries it and bare as a stored value may hold it.
    expect(isPrivateCleartextHost('[::1]')).toBe(true);
    expect(isPrivateCleartextHost('::1')).toBe(true);
  });

  it('refuses everything else, including near-misses on the ranges', () => {
    expect(isPrivateCleartextHost('8.8.8.8')).toBe(false);
    expect(isPrivateCleartextHost('example.com')).toBe(false);
    expect(isPrivateCleartextHost('172.15.0.1')).toBe(false);
    expect(isPrivateCleartextHost('172.32.0.1')).toBe(false);
    expect(isPrivateCleartextHost('192.169.1.1')).toBe(false);
    expect(isPrivateCleartextHost('100.63.255.255')).toBe(false);
    expect(isPrivateCleartextHost('100.128.0.1')).toBe(false);
    expect(isPrivateCleartextHost('256.1.1.1')).toBe(false);
    expect(isPrivateCleartextHost('[fd00::1]')).toBe(false);
    expect(isPrivateCleartextHost('')).toBe(false);
  });

  it('accepts cleartext http only for those hosts, and https for any valid host', () => {
    const lan = parsePairingLink('http://192.168.1.5:8766/?token=abc');
    expect(lan.ok).toBe(true);
    expect(parsePairingLink('http://8.8.8.8:8766/?token=abc')).toEqual({ ok: false, reason: 'url' });
    expect(parsePairingLink('http://example.com/?token=abc')).toEqual({ ok: false, reason: 'url' });
    // The same public host over TLS is a legitimate endpoint — the policy is about cleartext, not names.
    expect(parsePairingLink('https://example.com/?token=abc').ok).toBe(true);
    // A PWA link's `server` parameter is policed too: the wrapper cannot smuggle a public cleartext daemon.
    expect(
      parsePairingLink('https://remote.example.com/?server=http%3A%2F%2F8.8.8.8%3A8766&token=abc')
    ).toEqual({ ok: false, reason: 'url' });
    expect(
      parsePairingLink('https://remote.example.com/?server=http%3A%2F%2F10.0.2.2%3A8766&token=abc').ok
    ).toBe(true);
  });
});

describe('parsePairingLink on a warsha:// deep link', () => {
  it('reads the server form', () => {
    const parsed = parsePairingLink('warsha://pair?server=http%3A%2F%2F10.0.2.2%3A8766&token=deep1');

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.session).toEqual({ baseUrl: 'http://10.0.2.2:8766', token: 'deep1' });
    }
  });

  it('reads the host/port form over the default cleartext scheme', () => {
    const parsed = parsePairingLink('warsha://pair?host=192.168.0.10&port=8766&token=deep2');

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.session.baseUrl).toBe('http://192.168.0.10:8766');
  });

  it('honours an explicit scheme, and still polices cleartext with the host policy', () => {
    const tls = parsePairingLink('warsha://pair?host=gate.example.com&port=443&scheme=https&token=deep3');
    expect(tls.ok).toBe(true);
    // The URL normaliser drops a scheme-default port; what survives is the daemon address as a client
    // would write it.
    if (tls.ok) expect(tls.session.baseUrl).toBe('https://gate.example.com');

    // A public host without a scheme defaults to http — and the cleartext policy refuses it.
    expect(parsePairingLink('warsha://pair?host=8.8.8.8&port=8766&token=x')).toEqual({
      ok: false,
      reason: 'url',
    });
    expect(parsePairingLink('warsha://pair?host=gate.example.com&port=443&scheme=http&token=x')).toEqual({
      ok: false,
      reason: 'url',
    });
    expect(parsePairingLink('warsha://pair?host=gate.example.com&scheme=ftp&token=x')).toEqual({
      ok: false,
      reason: 'url',
    });
  });

  it('accepts the no-authority spelling of the same link', () => {
    const parsed = parsePairingLink('warsha:pair?host=mybox.local&port=8766&token=deep4');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.session.baseUrl).toBe('http://mybox.local:8766');
  });

  it('refuses a deep link with no token, an API key, or no daemon in it', () => {
    expect(parsePairingLink('warsha://pair?host=10.0.0.5&port=8766')).toEqual({ ok: false, reason: 'token' });
    expect(parsePairingLink('warsha://pair?host=10.0.0.5&port=8766&api_key=sk-1')).toEqual({
      ok: false,
      reason: 'userinfo',
    });
    expect(parsePairingLink('warsha://pair?token=abc')).toEqual({ ok: false, reason: 'url' });
  });

  it('refuses a warsha: link that is not a pairing, and one that is not a URL at all', () => {
    expect(parsePairingLink('warsha://run?id=run_1&token=abc')).toEqual({ ok: false, reason: 'url' });
    expect(parsePairingLink('warsha:')).toEqual({ ok: false, reason: 'url' });
  });
});

describe('readSessionFromSearch', () => {
  it('reads the app URL a pairing opened', () => {
    const parsed = readSessionFromSearch('?server=http%3A%2F%2F127.0.0.1%3A8766&token=t-1');

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.session).toEqual({ baseUrl: 'http://127.0.0.1:8766', token: 't-1' });
  });

  it('names a query with no daemon in it as a refusal, not a crash', () => {
    expect(readSessionFromSearch('?token=t-1')).toEqual({ ok: false, reason: 'url' });
    expect(readSessionFromSearch('?server=http%3A%2F%2F127.0.0.1%3A8766')).toEqual({
      ok: false,
      reason: 'token',
    });
    expect(readSessionFromSearch('')).toEqual({ ok: false, reason: 'url' });
  });
});

describe('the tab-scoped session store', () => {
  it('writes and reads the session under its own key', () => {
    const store = memoryStore();
    const session = { baseUrl: 'http://127.0.0.1:8766', token: 't-1' };

    expect(storeSession(session, store)).toBe(true);
    expect(store.values[SESSION_STORAGE_KEY]).toContain('t-1');
    expect(readStoredSession(store)).toEqual(session);
  });

  it('clears it, which is what ending a session means', () => {
    const store = memoryStore();
    storeSession({ baseUrl: 'http://127.0.0.1:8766', token: 't-1' }, store);

    clearStoredSession(store);

    expect(readStoredSession(store)).toBeNull();
  });

  it('discards a row it cannot read rather than trusting it', () => {
    expect(readStoredSession(memoryStore({ [SESSION_STORAGE_KEY]: '{not json' }))).toBeNull();
    expect(readStoredSession(memoryStore({ [SESSION_STORAGE_KEY]: '[]' }))).toBeNull();
    expect(readStoredSession(memoryStore({ [SESSION_STORAGE_KEY]: '{"baseUrl":"ftp://x","token":"t"}' }))).toBeNull();
    // A session stored before the token rule changed is no session at all.
    expect(readStoredSession(memoryStore({ [SESSION_STORAGE_KEY]: '{"baseUrl":"http://x"}' }))).toBeNull();
  });

  it('loses the remembered session, not the current one, when the store is blocked', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };

    expect(storeSession({ baseUrl: 'http://127.0.0.1:8766', token: 't-1' }, throwing)).toBe(false);
    expect(readStoredSession(throwing)).toBeNull();
    expect(() => clearStoredSession(throwing)).not.toThrow();
    expect(readStoredSession(null)).toBeNull();
  });

  it('prefers the native keystore bridge when the shell provides one', () => {
    // A stand-in for the Capacitor shell: the bridge holds its rows the way the keystore does, and
    // the session must round-trip through it rather than the WebView's plaintext storage.
    const rows = new Map<string, string>();
    const bridge: WarshaNativeBridge = {
      loadSecret: (key) => rows.get(key) ?? null,
      saveSecret: (key, value) => {
        rows.set(key, value);
        return true;
      },
      deleteSecret: (key) => {
        rows.delete(key);
        return true;
      },
    };
    window.WarshaNative = bridge;
    try {
      const store = sessionStore();
      expect(store).not.toBeNull();
      const session = { baseUrl: 'http://127.0.0.1:8766', token: 'keystore-token' };

      expect(storeSession(session, store)).toBe(true);
      expect(rows.get(SESSION_STORAGE_KEY)).toContain('keystore-token');
      expect(readStoredSession(store)).toEqual(session);

      clearStoredSession(store);
      expect(readStoredSession(store)).toBeNull();
    } finally {
      delete window.WarshaNative;
    }
  });

  it('treats a refused keystore write like a blocked store: this tab lives, the memory does not', () => {
    const bridge: WarshaNativeBridge = {
      loadSecret: () => null,
      saveSecret: () => false,
      deleteSecret: () => false,
    };
    const store = nativeSessionStore(bridge);
    expect(storeSession({ baseUrl: 'http://127.0.0.1:8766', token: 't-1' }, store)).toBe(false);
    expect(() => clearStoredSession(store)).not.toThrow();
  });

  it('only trusts a bridge that answers all three secret methods', () => {
    // A half-implemented bridge (a shell from an older APK) must not become the session store.
    window.WarshaNative = { loadSecret: () => null } as unknown as WarshaNativeBridge;
    try {
      expect(warshaNativeBridge()).toBeNull();
      // …and without a usable bridge the store falls back to the tab's own sessionStorage.
      expect(sessionStore()).toBe(window.sessionStorage);
    } finally {
      delete window.WarshaNative;
    }
  });
});

describe('the address bar', () => {
  it('takes the pairing parameters out and keeps every other one', () => {
    expect(stripSessionParams('?server=http%3A%2F%2Fx&token=abc')).toBe('');
    expect(stripSessionParams('?run=run_1&token=abc&server=http%3A%2F%2Fx')).toBe('?run=run_1');
    expect(stripSessionParams('?run=run_1')).toBe('?run=run_1');
    expect(stripSessionParams('')).toBe('');
  });

  it('is case-insensitive about the names it strips', () => {
    expect(stripSessionParams('?Token=abc&SERVER=http%3A%2F%2Fx&keep=1')).toBe('?keep=1');
  });
});

describe('the event feed address', () => {
  it('turns an http base into a socket base', () => {
    // `subscribeEvents` appends `/events` and opens a WebSocket; a socket to an `http:` URL is refused
    // by the browser, which is the difference between a live bench and a permanently offline one.
    expect(eventStreamUrl('http://127.0.0.1:8766')).toBe('ws://127.0.0.1:8766');
    expect(eventStreamUrl('https://gate.example.com/warsha')).toBe('wss://gate.example.com/warsha');
  });
});

describe('safeMessage', () => {
  it('redacts the token out of a daemon failure', () => {
    // The token is in the URL the RPC aimed at and in the socket handshake: a raw `Error.message` can
    // hand it straight back to the DOM.
    const session = { baseUrl: 'http://127.0.0.1:8766', token: 'sekrit' };
    expect(safeMessage('Request to http://127.0.0.1:8766/rpc failed: sekrit rejected', session)).toBe(
      'Request to http://127.0.0.1:8766/rpc failed: [redacted] rejected'
    );
  });

  it('leaves a message that holds no token alone', () => {
    expect(safeMessage('Method not found', null)).toBe('Method not found');
    expect(safeMessage('Method not found', { baseUrl: 'http://x', token: 'sekrit' })).toBe('Method not found');
  });
});

describe('endpointHost', () => {
  it('reports the host the bench is talking to, and nothing else', () => {
    expect(endpointHost({ baseUrl: 'https://gate.example.com:8443/warsha', token: 't' })).toBe(
      'gate.example.com:8443'
    );
    expect(endpointHost(null)).toBe('');
  });

  it('falls back to the raw value when it is not a URL, rather than showing nothing', () => {
    expect(endpointHost({ baseUrl: 'local daemon', token: 't' })).toBe('local daemon');
  });
});
