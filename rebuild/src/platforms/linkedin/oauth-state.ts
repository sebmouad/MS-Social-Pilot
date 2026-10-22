import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { encryptSecret, decryptSecret } from '@/server/secret-crypto';
const pendingSchema = z.object({ state: z.string(), userId: z.string(), workspaceId: z.string(), redirectUri: z.string().url(), expiresAt: z.number() });
/** 256-bit CSRF nonce and authenticated envelope are protocol/security invariants. */
export function createState(userId: string, workspaceId: string, redirectUri: string, ttlSeconds: number, now = Date.now()) {
  const pending = { state: randomBytes(32).toString('base64url'), userId, workspaceId, redirectUri, expiresAt: now + ttlSeconds * 1000 };
  return { state: pending.state, cookie: encryptSecret(JSON.stringify(pending)) };
}
export function openState(cookie: string | undefined, state: string | null, userId: string, workspaceId: string, redirectUri: string, now = Date.now()) {
  if (!cookie || !state) return null;
  try {
    const pending = pendingSchema.parse(JSON.parse(decryptSecret(cookie)));
    const a = Buffer.from(pending.state), b = Buffer.from(state);
    if (a.length !== b.length || !timingSafeEqual(a, b) || pending.userId !== userId || pending.workspaceId !== workspaceId || pending.redirectUri !== redirectUri || pending.expiresAt <= now) return null;
    return pending;
  } catch { return null; }
}
