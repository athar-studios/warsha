import { describe, it, expect } from 'vitest';

import {
  generateKeyPair,
  deriveSharedSecret,
  deriveKey,
  encrypt,
  decrypt,
  generateNonce,
  createPairingData,
  isPairingExpired,
  ReplayProtection,
  DeviceRegistry,
  EncryptedChannel,
  serializeFrame,
  deserializeFrame,
  type DeviceId,
  type DeviceIdentity,
} from './index';

function makeDeviceId(id: string): DeviceId {
  return id as DeviceId;
}

function makeIdentity(name: string): DeviceIdentity {
  const kp = generateKeyPair();
  return {
    deviceId: makeDeviceId(`${name}-id`),
    publicKey: kp.publicKey,
    name,
    createdAt: Date.now(),
    revoked: false,
    revokedAt: null,
  };
}

describe('key exchange', () => {
  it('generates valid X25519 key pairs', () => {
    const kp = generateKeyPair();
    expect(kp.publicKey).toHaveLength(32);
    expect(kp.privateKey).toHaveLength(32);
  });

  it('derives the same shared secret on both sides', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const s1 = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const s2 = deriveSharedSecret(bob.privateKey, alice.publicKey);
    expect(Buffer.from(s1).toString('hex')).toBe(Buffer.from(s2).toString('hex'));
  });

  it('derives keys with HKDF', () => {
    const secret = new Uint8Array(32).fill(7);
    const salt = new Uint8Array(32).fill(1);
    const info = new TextEncoder().encode('test');
    const key = deriveKey(secret, salt, info, 32);
    expect(key).toHaveLength(32);
  });
});

describe('ChaCha20-Poly1305 encryption', () => {
  it('roundtrips plaintext', () => {
    const key = new Uint8Array(32).fill(3);
    const nonce = generateNonce();
    const plaintext = new TextEncoder().encode('hello warsha');

    const ciphertext = encrypt(key, nonce, plaintext);
    expect(ciphertext).not.toEqual(plaintext);

    const decrypted = decrypt(key, nonce, ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe('hello warsha');
  });

  it('rejects tampered ciphertext', () => {
    const key = new Uint8Array(32).fill(3);
    const nonce = generateNonce();
    const ciphertext = encrypt(key, nonce, new Uint8Array([1, 2, 3]));
    ciphertext[0] ^= 0xff;
    expect(() => decrypt(key, nonce, ciphertext)).toThrow();
  });

  it('rejects a wrong key', () => {
    const key = new Uint8Array(32).fill(3);
    const otherKey = new Uint8Array(32).fill(4);
    const nonce = generateNonce();
    const ciphertext = encrypt(key, nonce, new Uint8Array([9, 9, 9]));
    expect(() => decrypt(otherKey, nonce, ciphertext)).toThrow();
  });
});

describe('pairing data', () => {
  it('creates pairing data that has not expired', () => {
    const kp = generateKeyPair();
    const pairing = createPairingData(makeDeviceId('dev-1'), kp.publicKey);
    expect(isPairingExpired(pairing)).toBe(false);
    expect(pairing.pairingSecret).toHaveLength(32);
    expect(pairing.expiresAt).toBeGreaterThan(Date.now());
  });

  it('detects expired pairing data', () => {
    const kp = generateKeyPair();
    const pairing = createPairingData(makeDeviceId('dev-1'), kp.publicKey);
    pairing.expiresAt = Date.now() - 1000;
    expect(isPairingExpired(pairing)).toBe(true);
  });

  it('keeps the relay URL when provided', () => {
    const kp = generateKeyPair();
    const pairing = createPairingData(makeDeviceId('dev-1'), kp.publicKey, 'wss://relay.example');
    expect(pairing.relayUrl).toBe('wss://relay.example');
  });
});

describe('replay protection', () => {
  it('accepts a nonce once and rejects the replay', () => {
    const rp = new ReplayProtection();
    const nonce = generateNonce();
    expect(rp.check(nonce)).toBe(true);
    expect(rp.check(nonce)).toBe(false);
  });

  it('accepts distinct nonces', () => {
    const rp = new ReplayProtection();
    expect(rp.check(generateNonce())).toBe(true);
    expect(rp.check(generateNonce())).toBe(true);
  });

  it('clears its cache', () => {
    const rp = new ReplayProtection();
    const nonce = generateNonce();
    rp.check(nonce);
    rp.clear();
    expect(rp.check(nonce)).toBe(true);
  });
});

describe('device registry', () => {
  it('starts with only the local device', () => {
    const registry = new DeviceRegistry(makeIdentity('local'));
    expect(registry.listDevices()).toHaveLength(1);
  });

  it('adds and retrieves a paired device', () => {
    const registry = new DeviceRegistry(makeIdentity('local'));
    const remote = makeIdentity('remote');
    registry.addDevice(remote);
    expect(registry.getDevice(remote.deviceId)?.name).toBe('remote');
  });

  it('revokes a device', () => {
    const registry = new DeviceRegistry(makeIdentity('local'));
    const remote = makeIdentity('remote');
    registry.addDevice(remote);

    expect(registry.isRevoked(remote.deviceId)).toBe(false);
    expect(registry.revokeDevice(remote.deviceId)).toBe(true);
    expect(registry.isRevoked(remote.deviceId)).toBe(true);
    expect(registry.getDevice(remote.deviceId)?.revokedAt).not.toBeNull();
  });

  it('refuses to add an already-revoked device', () => {
    const registry = new DeviceRegistry(makeIdentity('local'));
    const remote = makeIdentity('remote');
    remote.revoked = true;
    expect(() => registry.addDevice(remote)).toThrow();
  });

  it('reports unknown devices as revoked', () => {
    const registry = new DeviceRegistry(makeIdentity('local'));
    expect(registry.isRevoked(makeDeviceId('never-paired'))).toBe(true);
  });
});

describe('encrypted channel', () => {
  it('establishes a channel and roundtrips a message', async () => {
    const aliceKp = generateKeyPair();
    const bobKp = generateKeyPair();

    const alice = new EncryptedChannel();
    const bob = new EncryptedChannel();

    // Complementary roles: the initiator sends with the initiator key and the
    // responder receives with it. Send and receive keys are distinct per
    // direction, so two initiators can never decrypt each other's frames.
    await alice.initializeAsInitiator(aliceKp, bobKp.publicKey);
    await bob.initializeAsResponder(bobKp, aliceKp.publicKey);

    const plaintext = new TextEncoder().encode('gate A approved');
    const { nonce, ciphertext } = alice.encrypt(plaintext);

    const decrypted = bob.decrypt(ciphertext, nonce);
    expect(new TextDecoder().decode(decrypted)).toBe('gate A approved');
  });

  it('rejects a replayed frame', async () => {
    const aliceKp = generateKeyPair();
    const bobKp = generateKeyPair();

    const alice = new EncryptedChannel();
    const bob = new EncryptedChannel();

    await alice.initializeAsInitiator(aliceKp, bobKp.publicKey);
    await bob.initializeAsResponder(bobKp, aliceKp.publicKey);

    const { nonce, ciphertext } = alice.encrypt(new TextEncoder().encode('once'));

    bob.decrypt(ciphertext, nonce);
    expect(() => bob.decrypt(ciphertext, nonce)).toThrow(/Replay/);
  });

  it('rejects use before initialization', () => {
    const channel = new EncryptedChannel();
    expect(() => channel.encrypt(new Uint8Array([1]))).toThrow(/not initialized/);
  });
});

describe('frame serialization', () => {
  it('roundtrips an encrypted frame', () => {
    const frame = {
      from: makeDeviceId('a'),
      to: makeDeviceId('b'),
      nonce: generateNonce(),
      ciphertext: new Uint8Array([4, 5, 6]),
      timestamp: 1700000000,
    };

    const json = serializeFrame(frame);
    const restored = deserializeFrame(json);

    expect(restored.from).toBe('a');
    expect(restored.to).toBe('b');
    expect(Array.from(restored.ciphertext)).toEqual([4, 5, 6]);
    expect(restored.timestamp).toBe(1700000000);
  });

  it('keeps ciphertext opaque in the serialized payload', () => {
    const frame = {
      from: makeDeviceId('a'),
      to: makeDeviceId('b'),
      nonce: generateNonce(),
      ciphertext: new TextEncoder().encode('secret plaintext'),
      timestamp: 1700000000,
    };

    const json = serializeFrame(frame);
    expect(json).not.toContain('secret plaintext');
  });
});