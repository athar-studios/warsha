// @warsha/crypto — Shared crypto primitives for E2E encryption
// X25519 key exchange, ChaCha20-Poly1305 encryption, replay protection, device revocation

import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';

export type DeviceId = string & { readonly __brand: unique symbol };

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface EncryptedFrame {
  from: DeviceId;
  to: DeviceId;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  timestamp: number;
}

export interface PairingData {
  deviceId: DeviceId;
  publicKey: Uint8Array;
  relayUrl: string | null;
  pairingSecret: Uint8Array;
  expiresAt: number;
}

export interface DeviceIdentity {
  deviceId: DeviceId;
  publicKey: Uint8Array;
  name: string;
  createdAt: number;
  revoked: boolean;
  revokedAt: number | null;
}

/** Generate X25519 key pair */
export function generateKeyPair(): KeyPair {
  const privateKey = randomBytes(32);
  const publicKey = x25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

/** Derive shared secret using X25519 */
export function deriveSharedSecret(privateKey: Uint8Array, remotePublicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(privateKey, remotePublicKey);
}

/** HKDF key derivation */
export function deriveKey(
  sharedSecret: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number = 32
): Uint8Array {
  return hkdf(sha256, sharedSecret, salt, info, length);
}

/** Lexicographic comparison of two byte strings, used for order-independent hashing */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Derive the HKDF salt that both peers must agree on.
 *
 * A random salt would have to travel over the wire before either side can derive
 * keys, and the pairing flow has no such round trip. So the salt is computed
 * deterministically: sha256 over the two static public keys concatenated in
 * lexicographic order. Sorting makes the value independent of who is the
 * initiator, and hashing keeps it unique per pair while never leaking a key.
 */
function deriveChannelSalt(selfPublicKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  const ordered =
    compareBytes(selfPublicKey, peerPublicKey) <= 0
      ? [selfPublicKey, peerPublicKey]
      : [peerPublicKey, selfPublicKey];
  const concatenated = new Uint8Array(ordered[0].length + ordered[1].length);
  concatenated.set(ordered[0], 0);
  concatenated.set(ordered[1], ordered[0].length);
  return sha256(concatenated);
}

/** HKDF info string for frames sent by the initiator */
const INITIATOR_KEY_INFO = new TextEncoder().encode('warsha-initiator');

/** HKDF info string for frames sent by the responder */
const RESPONDER_KEY_INFO = new TextEncoder().encode('warsha-responder');

/** Encrypt with ChaCha20-Poly1305 */
export function encrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  associatedData?: Uint8Array
): Uint8Array {
  const cipher = chacha20poly1305(key, nonce, associatedData);
  return cipher.encrypt(plaintext);
}

/** Decrypt with ChaCha20-Poly1305 */
export function decrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  associatedData?: Uint8Array
): Uint8Array {
  const cipher = chacha20poly1305(key, nonce, associatedData);
  return cipher.decrypt(ciphertext);
}

/** Generate random nonce (12 bytes for ChaCha20-Poly1305) */
export function generateNonce(): Uint8Array {
  return randomBytes(12);
}

/** Generate pairing secret */
export function generatePairingSecret(): Uint8Array {
  return randomBytes(32);
}

/** Create pairing data for QR code */
export function createPairingData(
  deviceId: DeviceId,
  publicKey: Uint8Array,
  relayUrl: string | null = null
): PairingData {
  return {
    deviceId,
    publicKey,
    relayUrl,
    pairingSecret: generatePairingSecret(),
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  };
}

/** Check if pairing data is expired */
export function isPairingExpired(pairing: PairingData): boolean {
  return Date.now() > pairing.expiresAt;
}

/** Replay protection: check and store nonce */
export class ReplayProtection {
  private cache: Set<string> = new Set();
  private maxSize: number;

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
  }

  check(nonce: Uint8Array): boolean {
    const key = toHex(nonce);
    if (this.cache.has(key)) {
      return false; // Replay detected
    }
    this.cache.add(key);
    if (this.cache.size > this.maxSize) {
      // Remove oldest entries (simple FIFO)
      const first = this.cache.values().next().value;
      if (first) this.cache.delete(first);
    }
    return true;
  }

  clear(): void {
    this.cache.clear();
  }
}

/** Lowercase hex encoding of a byte array. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/** Decode a lowercase hex string into bytes. */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('Invalid hex digit');
    bytes[i] = byte;
  }
  return bytes;
}

/** Base64 encoding of a byte array (portable, no Node Buffer). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Decode base64 into bytes (portable, no Node Buffer). */
export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Device registry for managing paired devices */
export class DeviceRegistry {
  private devices: Map<DeviceId, DeviceIdentity> = new Map();
  private localIdentity: DeviceIdentity;

  constructor(localIdentity: DeviceIdentity) {
    this.localIdentity = localIdentity;
    this.devices.set(localIdentity.deviceId, localIdentity);
  }

  addDevice(device: DeviceIdentity): void {
    if (device.revoked) {
      throw new Error(`Device ${device.deviceId} is revoked`);
    }
    this.devices.set(device.deviceId, device);
  }

  revokeDevice(deviceId: DeviceId): boolean {
    const device = this.devices.get(deviceId);
    if (device) {
      device.revoked = true;
      device.revokedAt = Date.now();
      return true;
    }
    return false;
  }

  getDevice(deviceId: DeviceId): DeviceIdentity | undefined {
    return this.devices.get(deviceId);
  }

  listDevices(): DeviceIdentity[] {
    return Array.from(this.devices.values());
  }

  isRevoked(deviceId: DeviceId): boolean {
    return this.devices.get(deviceId)?.revoked ?? true;
  }

  getLocalIdentity(): DeviceIdentity {
    return this.localIdentity;
  }
}

/** Encrypted channel using Noise XX pattern (simplified) */
export class EncryptedChannel {
  private sendKey: Uint8Array | null = null;
  private recvKey: Uint8Array | null = null;
  private sendNonce: number = 0;
  private recvNonce: number = 0;
  private replayProtection: ReplayProtection;

  constructor() {
    this.replayProtection = new ReplayProtection();
  }

  /** Initialize as initiator */
  async initializeAsInitiator(
    localKeyPair: KeyPair,
    remotePublicKey: Uint8Array
  ): Promise<void> {
    const sharedSecret = deriveSharedSecret(localKeyPair.privateKey, remotePublicKey);
    const salt = deriveChannelSalt(localKeyPair.publicKey, remotePublicKey);
    // One namespaced info string per direction, so both peers derive the same two
    // keys: the initiator sends with the initiator key and receives with the
    // responder key.
    this.sendKey = deriveKey(sharedSecret, salt, INITIATOR_KEY_INFO, 32);
    this.recvKey = deriveKey(sharedSecret, salt, RESPONDER_KEY_INFO, 32);
  }

  /** Initialize as responder */
  async initializeAsResponder(
    localKeyPair: KeyPair,
    remotePublicKey: Uint8Array
  ): Promise<void> {
    const sharedSecret = deriveSharedSecret(localKeyPair.privateKey, remotePublicKey);
    const salt = deriveChannelSalt(localKeyPair.publicKey, remotePublicKey);
    // Keys are mirrored for the responder: it sends with the responder key and
    // receives with the initiator key.
    this.sendKey = deriveKey(sharedSecret, salt, RESPONDER_KEY_INFO, 32);
    this.recvKey = deriveKey(sharedSecret, salt, INITIATOR_KEY_INFO, 32);
  }

  /** Encrypt message */
  encrypt(plaintext: Uint8Array, associatedData?: Uint8Array): { nonce: Uint8Array; ciphertext: Uint8Array } {
    if (!this.sendKey) throw new Error('Channel not initialized');
    
    const nonce = generateNonce();
    // Prepend nonce counter for ordering
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, this.sendNonce++, false);
    const fullNonce = new Uint8Array(12);
    fullNonce.set(counterBytes, 0);
    fullNonce.set(nonce.slice(4), 4);
    
    const ciphertext = encrypt(this.sendKey, fullNonce, plaintext, associatedData);
    return { nonce: fullNonce, ciphertext };
  }

  /** Decrypt message */
  decrypt(ciphertext: Uint8Array, nonce: Uint8Array, associatedData?: Uint8Array): Uint8Array {
    if (!this.recvKey) throw new Error('Channel not initialized');
    
    // Check replay protection
    if (!this.replayProtection.check(nonce)) {
      throw new Error('Replay attack detected');
    }
    
    this.recvNonce++;
    return decrypt(this.recvKey, nonce, ciphertext, associatedData);
  }
}

/** Serialize encrypted frame for transport */
export function serializeFrame(frame: EncryptedFrame): string {
  return JSON.stringify({
    from: frame.from,
    to: frame.to,
    nonce: toBase64(frame.nonce),
    ciphertext: toBase64(frame.ciphertext),
    timestamp: frame.timestamp,
  });
}

/** Deserialize encrypted frame from transport */
export function deserializeFrame(json: string): EncryptedFrame {
  const data = JSON.parse(json);
  return {
    from: data.from,
    to: data.to,
    nonce: fromBase64(data.nonce),
    ciphertext: fromBase64(data.ciphertext),
    timestamp: data.timestamp,
  };
}