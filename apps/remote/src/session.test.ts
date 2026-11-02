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
  parsePairingLink,
  readSessionFromSearch,
  readStoredSession,
  safeMessage,
  SESSION_STORAGE_KEY,
  storeSession,
  stripSessionParams,
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
