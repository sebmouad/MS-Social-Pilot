import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeSecret } from '@/server/config/store';
import type { PlatformDataCallbackResult } from '@/server/platforms/host';
import { DATA_DELETION_ACTION } from '@/server/platforms/deletion-status';

/**
 * Meta's two server-to-server callbacks: "deauthorize" (a person removed the app in Facebook)
 * and "data deletion request" (a person asked Facebook to have the app erase their data).
 * Meta posts a `signed_request` form field: `<signature>.<payload>`, both base64url, where the
 * signature is HMAC-SHA256 of the payload text keyed with the app secret.
 */
const DEAUTHORIZED_REASON = 'The Facebook user removed this app, so its access tokens were revoked.';
const DELETION_REASON = 'Removed at the request of the Facebook user.';
export const FACEBOOK_DATA_DELETION_ACTION = DATA_DELETION_ACTION;
export const FACEBOOK_DEAUTHORIZE_ACTION = 'platform.deauthorized';

/** Pure: the Facebook user id of a correctly signed request, otherwise null. */
export function parseFacebookSignedRequest(signedRequest: string, appSecret: string): string | null {
  if (!appSecret) return null;
  const parts = signedRequest.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [signature, payload] = parts as [string, string];
  const expected = createHmac('sha256', appSecret).update(payload).digest();
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { algorithm?: unknown; user_id?: unknown };
    if (typeof body.algorithm === 'string' && body.algorithm.toUpperCase() !== 'HMAC-SHA256') return null;
    return typeof body.user_id === 'string' && /^[0-9]{1,40}$/.test(body.user_id) ? body.user_id : null;
  } catch {
    return null;
  }
}

async function verifiedUserId(signedRequest: string): Promise<string | null> {
  const secret = await runtimeSecret('meta.appSecret').catch(() => null);
  return secret ? parseFacebookSignedRequest(signedRequest, secret) : null;
}

type Audit = { workspaceId: string; action: string; detail: Record<string, unknown> };

async function audit(tx: Pick<typeof prisma, '$executeRaw'>, entry: Audit) {
  await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${entry.workspaceId}, NULL, ${entry.action}, ${JSON.stringify(entry.detail)}::jsonb, NOW())`;
}

/** Every token we hold for this person is already dead: flag the connections now instead of at the next publish. */
export async function handleFacebookDeauthorize(signedRequest: string): Promise<PlatformDataCallbackResult> {
  const userId = await verifiedUserId(signedRequest);
  if (!userId) return { ok: false, reason: 'invalid_signature' };
  const accounts = await prisma.socialAccount.findMany({ where: { provider: 'facebook', providerUserId: userId, invalidatedAt: null }, select: { id: true, workspaceId: true } });
  for (const account of accounts) {
    await prisma.$transaction(async (tx) => {
      await tx.socialAccount.updateMany({ where: { id: account.id, invalidatedAt: null }, data: { invalidatedAt: new Date(), invalidReason: DEAUTHORIZED_REASON } });
      await audit(tx, { workspaceId: account.workspaceId, action: FACEBOOK_DEAUTHORIZE_ACTION, detail: { provider: 'facebook', socialAccountId: account.id } });
    });
  }
  return { ok: true, affected: accounts.length };
}

/**
 * Erase the credentials the person authorised and stop work that needs them. Published posts, insights and
 * conversations are the workspace's own business records about its Pages, so they stay; the workspace owner
 * can still delete them from Settings. The customer-facing outcome is stored under the confirmation code.
 */
export async function handleFacebookDataDeletion(signedRequest: string): Promise<PlatformDataCallbackResult> {
  const userId = await verifiedUserId(signedRequest);
  if (!userId) return { ok: false, reason: 'invalid_signature' };
  const confirmationCode = randomUUID();
  const accounts = await prisma.socialAccount.findMany({ where: { provider: 'facebook', providerUserId: userId }, select: { id: true, workspaceId: true } });
  for (const account of accounts) {
    await prisma.$transaction(async (tx) => {
      const targets = await tx.target.findMany({ where: { socialAccountId: account.id }, select: { id: true } });
      const targetIds = targets.map(target => target.id);
      const cancelled = targetIds.length
        ? await tx.postTarget.updateMany({ where: { targetId: { in: targetIds }, status: { in: ['pending', 'scheduled_remote'] } }, data: { status: 'cancelled' } })
        : { count: 0 };
      await tx.target.updateMany({ where: { id: { in: targetIds } }, data: { accessToken: null, enabled: false, canPublish: false } });
      await tx.socialAccount.update({ where: { id: account.id }, data: { accessToken: '', refreshToken: null, tokenExpiresAt: null, invalidatedAt: new Date(), invalidReason: DELETION_REASON } });
      await audit(tx, { workspaceId: account.workspaceId, action: FACEBOOK_DATA_DELETION_ACTION, detail: { provider: 'facebook', confirmationCode, socialAccountId: account.id, channels: targetIds.length, cancelledDestinations: cancelled.count } });
    });
  }
  return { ok: true, affected: accounts.length, confirmationCode };
}
