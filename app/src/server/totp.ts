import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time codes (RFC 6238) for authenticator apps: SHA-1, six
 * digits, 30-second steps — the defaults every app reads from an otpauth URI.
 *
 * Plain `node:crypto`, no library: the algorithm is twenty lines and every
 * dependency on the sign-in path is one more thing to trust.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Not a base32 secret.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new secret: 160 bits, as RFC 4226 recommends, in base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function timeStep(at: number = Date.now()): number {
  return Math.floor(at / 1000 / STEP_SECONDS);
}

/** The code for one time step. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * The step a code belongs to, allowing one step either side for a phone
 * clock that is a little off, or null. The caller refuses a step it has
 * already accepted, so a code read over a shoulder cannot be replayed.
 */
export function matchTotp(secret: string, code: string, at: number = Date.now()): number | null {
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const now = timeStep(at);
  for (const step of [now, now - 1, now + 1]) {
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(typed))) return step;
  }
  return null;
}

/** What an authenticator app scans. */
export function otpauthUri(options: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${options.issuer}:${options.account}`);
  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
