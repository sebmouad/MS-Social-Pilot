import { prisma } from '@/server/data';
import { PAGE_INTEGRITY, type AutopilotSettings, type PageIntegrity } from '../wordpress/autopilot';

/**
 * Each Page's Facebook integrity status, once a day (2026-11-26, owner: « daily + alert »). The Page Integrity API
 * (GET /{page-id}/page_status, Pages API January 2026) says ok / warning / restricted / suspended, with any violations;
 * on 26 Nov Plaisirs en Cuisine was at « warning » (Facebook told the owner: non-authentic engagement). A change is
 * written in the autopilot's activity log; a move to anything but ok also alerts owners and admins.
 */
export const PAGE_STATUS_EVERY_MS = 24 * 3_600_000;
type Record_ = NonNullable<AutopilotSettings['pageStatus']>;
export type PageStatusRead = { status: PageIntegrity; violations: string[] } | null;
export type PageStatusChange = { targetId: string; name: string; from: PageIntegrity | null; to: PageIntegrity; violations: string[] };

/** What changed since the last read; a Page read for the first time counts only when it is not ok. Unread Pages keep their last status. */
export function pageStatusChanges(previous: Record_ | undefined, pages: ReadonlyArray<{ id: string; name: string }>, reads: ReadonlyMap<string, PageStatusRead>, now: Date): { record: Record_; changes: PageStatusChange[] } {
  const next: Record_['pages'] = { ...(previous?.pages ?? {}) };
  const changes: PageStatusChange[] = [];
  for (const page of pages) {
    const read = reads.get(page.id);
    if (!read) continue;
    const from = previous?.pages[page.id] ?? null;
    next[page.id] = read.status;
    if (from === null ? read.status !== 'ok' : from !== read.status) changes.push({ targetId: page.id, name: page.name, from, to: read.status, violations: read.violations });
  }
  return { record: { checkedAt: now.toISOString(), pages: next }, changes };
}

/** Read every Page's status now (a Page whose read fails is left out, so it keeps its last status). */
export async function readPageStatuses(workspaceId: string, pageIds: readonly string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, PageStatusRead>> {
  const out = new Map<string, PageStatusRead>();
  if (!pageIds.length) return out;
  const rows = await prisma.$queryRaw<Array<{ id: string; providerId: string; token: string | null; accountToken: string | null }>>`
    SELECT t.id, t."providerId", t."accessToken" AS token, sa."accessToken" AS "accountToken" FROM targets t JOIN social_accounts sa ON sa.id = t."socialAccountId"
    WHERE t."workspaceId" = ${workspaceId} AND t.id = ANY(${[...pageIds]}::text[]) AND t.enabled = true AND sa.provider = 'facebook' AND sa."invalidatedAt" IS NULL`;
  const { configuredFacebookConfig } = await import('@/platforms/facebook/runtime');
  const { graphObjectUrl, facebookAppSecretProof } = await import('@/platforms/facebook/protocol');
  const { decryptSecret } = await import('@/server/secret-crypto');
  const config = await configuredFacebookConfig();
  for (const row of rows) {
    const sealed = row.token ?? row.accountToken; if (!sealed) continue;
    try {
      const token = decryptSecret(sealed);
      const url = graphObjectUrl(config, `${encodeURIComponent(row.providerId)}/page_status`);
      url.searchParams.set('access_token', token);
      if (config.appSecretProofEnabled && config.appSecret) url.searchParams.set('appsecret_proof', facebookAppSecretProof(token, config.appSecret));
      const payload = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs) }).then(response => response.json()) as Record<string, unknown>;
      const status = typeof payload.status === 'string' ? payload.status.toLowerCase() : '';
      if (!(PAGE_INTEGRITY as readonly string[]).includes(status)) continue;
      const violations = Array.isArray(payload.violations) ? payload.violations.flatMap(item => item && typeof item === 'object' && typeof (item as { type?: unknown }).type === 'string' ? [String((item as { type: string }).type).slice(0, 60)] : []) : [];
      out.set(row.id, { status: status as PageIntegrity, violations });
    } catch { /* one Page's failed read never stops the others */ }
  }
  return out;
}

/** Owners and admins get one alert per Page, status and day. */
export async function alertPageStatus(workspaceId: string, changes: readonly PageStatusChange[], now: Date): Promise<number> {
  const bad = changes.filter(change => change.to !== 'ok');
  if (!bad.length) return 0;
  const members = await prisma.$queryRaw<Array<{ userId: string }>>`SELECT m."userId" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${workspaceId} AND m.role::text IN ('owner', 'admin') AND u."disabledAt" IS NULL`;
  const { enqueueNotification } = await import('@/modules/settings/notifications/server');
  let sent = 0;
  for (const change of bad) for (const member of members) {
    const eventId = `page_status_${change.targetId}_${change.to}_${now.toISOString().slice(0, 10)}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);
    const result = await prisma.$transaction(tx => enqueueNotification(tx, { eventId, workspaceId, userId: member.userId, kind: 'page_status', targetId: change.targetId })).catch(() => ({ inserted: false }));
    if (result.inserted) sent++;
  }
  return sent;
}
