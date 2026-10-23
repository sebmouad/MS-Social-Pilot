import { createHmac, timingSafeEqual } from 'node:crypto';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';

const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE_ID = /^[A-Za-z0-9._-]+$/;
const MESSAGE_PREFIX = 'media-share/v1';

function message(workspaceId: string, id: string, exp: number): string {
  return `${MESSAGE_PREFIX}|ws=${workspaceId}|id=${id.toLowerCase()}|exp=${exp}`;
}

/** HMAC signature for one stored image. Pure: callers supply the Root secret so tests never read configuration. */
export function signMediaShare(input: { workspaceId: string; id: string; exp: number }, secret: string): string {
  return createHmac('sha256', secret).update(message(input.workspaceId, input.id, input.exp), 'utf8').digest('base64url');
}

export type MediaShareGrant = { workspaceId: string; id: string; exp: number; sig: string };

/** True only for a well-formed, unexpired grant whose signature matches. Never throws on hostile input. */
export function verifyMediaShare(grant: { workspaceId: string; id: string; exp: number; sig: string }, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !WORKSPACE_ID.test(grant.workspaceId) || grant.workspaceId === '.' || grant.workspaceId === '..' || !IMAGE_ID.test(grant.id)) return false;
  if (!Number.isSafeInteger(grant.exp) || grant.exp <= nowSeconds) return false;
  if (typeof grant.sig !== 'string' || !grant.sig) return false;
  const expected = Buffer.from(signMediaShare(grant, secret), 'utf8');
  const actual = Buffer.from(grant.sig, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Relative serve path carrying the grant. The existing session route stays valid without it. */
export function mediaSharePath(grant: MediaShareGrant): string {
  const params = new URLSearchParams({ ws: grant.workspaceId, exp: String(grant.exp), sig: grant.sig });
  return `/api/media/${encodeURIComponent(grant.id)}?${params.toString()}`;
}

/** Absolute signed URL for providers that fetch attachments by URL. Null while the pipeline is unconfigured. */
export async function mintMediaShareUrl(workspaceId: string, id: string, now = new Date()): Promise<string | null> {
  if (!WORKSPACE_ID.test(workspaceId) || !IMAGE_ID.test(id)) return null;
  const [secret, lifetime, origin] = await Promise.all([
    runtimeSecret('publishing.mediaShareSecret'),
    runtimeConfig('publishing.mediaShareExpirySeconds'),
    runtimeConfig('app.publicOrigin'),
  ]);
  if (!secret || typeof origin !== 'string' || !origin) return null;
  let base: URL;
  try { base = new URL(origin); } catch { return null; }
  if (base.username || base.password) return null;
  const seconds = Math.max(1, Math.trunc(Number(lifetime) || 0));
  const exp = Math.floor(now.getTime() / 1000) + seconds;
  return `${base.origin}${mediaSharePath({ workspaceId, id, exp, sig: signMediaShare({ workspaceId, id, exp }, secret) })}`;
}

/** Relative signed preview path for upload receipts. Needs the secret only; no public origin is involved. */
export async function mintMediaSharePath(workspaceId: string, id: string, now = new Date()): Promise<string | null> {
  if (!WORKSPACE_ID.test(workspaceId) || !IMAGE_ID.test(id)) return null;
  const [secret, lifetime] = await Promise.all([
    runtimeSecret('publishing.mediaShareSecret'),
    runtimeConfig('publishing.mediaShareExpirySeconds'),
  ]);
  if (!secret) return null;
  const seconds = Math.max(1, Math.trunc(Number(lifetime) || 0));
  const exp = Math.floor(now.getTime() / 1000) + seconds;
  return mediaSharePath({ workspaceId, id, exp, sig: signMediaShare({ workspaceId, id, exp }, secret) });
}

/** Providers advertise uploaded-image support only while signed delivery can be minted for them. */
export async function mediaShareDelivery(): Promise<{ origin: string } | null> {
  const [secret, origin] = await Promise.all([
    runtimeSecret('publishing.mediaShareSecret'),
    runtimeConfig('app.publicOrigin'),
  ]);
  if (!secret || typeof origin !== 'string') return null;
  // Providers fetch over the public internet, so only an HTTPS origin can deliver.
  if (!origin.startsWith('https://')) return null;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password) return null;
  } catch { return null; }
  return { origin };
}
