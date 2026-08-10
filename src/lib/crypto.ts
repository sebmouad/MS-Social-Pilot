import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

import { env } from './env';

/**
 * Token encryption, password hashing and signing helpers.
 *
 * Access tokens are the crown jewels here: a leaked page token lets anyone
 * post as the customer's brand. Everything that touches one goes through
 * `encryptSecret`/`decryptSecret`.
 */

const ENCRYPTION_VERSION = 'v1';
const IV_BYTES = 12; // GCM standard nonce length.
const KEY_BYTES = 32;

function loadKey(): Buffer {
  const key = Buffer.from(env.encryptionKey, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes, got ${key.length}. Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

/**
 * Encrypt with AES-256-GCM. Output is `v1:<iv>:<tag>:<ciphertext>`, all
 * base64url — the version prefix exists so a future key/algorithm rotation can
 * decrypt old values instead of orphaning them.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) {
    throw new Error('Malformed encrypted value; expected the v1 envelope format.');
  }
  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];

  const decipher = createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Password hashing with scrypt. Format: `scrypt:<N>:<salt>:<hash>`.
 * Node ships scrypt, so this avoids a native bcrypt build.
 */
const SCRYPT_COST = 16_384;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
  return ['scrypt', String(SCRYPT_COST), salt.toString('base64url'), derived.toString('base64url')].join(
    ':',
  );
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const [, costPart, saltPart, hashPart] = parts as [string, string, string, string];

  const cost = Number.parseInt(costPart, 10);
  if (!Number.isFinite(cost)) return false;

  const expected = Buffer.from(hashPart, 'base64url');
  const actual = scryptSync(password, Buffer.from(saltPart, 'base64url'), expected.length, {
    N: cost,
  });
  return timingSafeEqual(expected, actual);
}

/** Session tokens are stored hashed, so a database dump cannot be replayed. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** HMAC-SHA256 in hex — used for OAuth state and Facebook's appsecret_proof. */
export function hmacHex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
