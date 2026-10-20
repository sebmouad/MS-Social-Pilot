import { randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { applyUtm, type UtmSettings } from '@/modules/settings/workspace-operations';

const DAY = 86_400_000;
export function validShortLinkDestination(value: string) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !/[\u0000-\u0020\u007f]/.test(value); }
  catch { return false; }
}

/** Internal publish hook. Caller holds the current-authorized workspace/post/destination guard. */
export async function preparePublicationLinks(input: {
  workspaceId: string; postId: string; targetId: string; message: string; link: string | null;
  settings: UtmSettings & { shortenerEnabled?: boolean }; targetName?: string; date?: Date;
}) {
  if (!input.link && !/https?:\/\//.test(input.message)) return { message: input.message, link: input.link };
  const replacements = new Map<string, string>();
  const hasUtm = Boolean(input.settings.utmSource || input.settings.utmMedium || input.settings.utmCampaignTemplate);
  let base = '', days = 0;
  if (input.settings.shortenerEnabled) {
    [base, days] = await Promise.all([runtimeConfig('publishing.shortLinkBaseUrl'), runtimeConfig('publishing.shortLinkRetentionDays')]);
    if (!base) throw new OperationError('unavailable', 'Link shortening is unavailable. Try again later.');
  }
  const transform = async (raw: string) => {
    if (replacements.has(raw)) return replacements.get(raw)!;
    if (!validShortLinkDestination(raw)) return raw;
    const tagged = hasUtm ? applyUtm(raw, input.settings, input) : raw;
    let replacement = tagged;
    if (input.settings.shortenerEnabled && !(new URL(raw).origin === base && new URL(raw).pathname.startsWith('/s/'))) {
      const [timeout, maxWait] = await Promise.all([runtimeConfig('publishing.transactionTimeoutMs'), runtimeConfig('publishing.transactionMaxWaitMs')]);
      const slug = await prisma.$transaction(async tx => {
        const identity = JSON.stringify([input.workspaceId, input.postId, input.targetId, tagged]);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))::text`;
        const existing = await tx.$queryRaw<Array<{ slug: string }>>`SELECT slug FROM short_links
          WHERE "workspaceId"=${input.workspaceId} AND "postId"=${input.postId} AND "targetId"=${input.targetId}
          AND "targetUrl"=${tagged} AND "createdAt">${new Date(Date.now() - days * DAY)} ORDER BY "createdAt" DESC LIMIT 1`;
        if (existing[0]) return existing[0].slug;
        const slug = randomBytes(18).toString('base64url');
        await tx.$executeRaw`INSERT INTO short_links (id,"workspaceId",slug,"targetUrl","postId","targetId","clickCount","createdAt")
          VALUES (${randomUUID()},${input.workspaceId},${slug},${tagged},${input.postId},${input.targetId},0,CURRENT_TIMESTAMP)`;
        return slug;
      }, { timeout, maxWait });
      replacement = `${base}/s/${slug}`;
    }
    replacements.set(raw, replacement);
    return replacement;
  };
  // Replace original tokens once so overlapping URLs cannot corrupt one another.
  const tokens = [...input.message.matchAll(/https?:\/\/[^\s<>"')]+/g)];
  let message = '', end = 0;
  for (const token of tokens) {
    const raw = token[0].replace(/[.,;:!?]+$/, '');
    message += input.message.slice(end, token.index) + await transform(raw) + token[0].slice(raw.length);
    end = token.index! + token[0].length;
  }
  message += input.message.slice(end);
  return { message, link: input.link ? await transform(input.link) : input.link };
}

/** Public capability URL: no visitor metadata is stored. Atomic increments prevent lost clicks. */
export async function resolveShortLink(slug: string, count: boolean): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(slug)) return null;
  const days = await runtimeConfig('publishing.shortLinkRetentionDays');
  const rows = await prisma.$queryRaw<Array<{ id: string; targetUrl: string }>>`SELECT sl.id, sl."targetUrl" FROM short_links sl
    JOIN workspaces w ON w.id=sl."workspaceId" WHERE sl.slug=${slug} AND w."suspendedAt" IS NULL
    AND sl."createdAt">${new Date(Date.now() - days * DAY)} LIMIT 1`;
  const row = rows[0];
  if (!row || !validShortLinkDestination(row.targetUrl)) return null;
  if (count) {
    const changed = await prisma.$executeRaw`UPDATE short_links sl SET "clickCount"=sl."clickCount"+1
      FROM workspaces w WHERE sl.id=${row.id} AND w.id=sl."workspaceId" AND w."suspendedAt" IS NULL
      AND sl."createdAt">${new Date(Date.now() - days * DAY)}`;
    if (changed !== 1) return null;
  }
  return row.targetUrl;
}
export function countShortLinkRequest(userAgent: string | null) {
  return Boolean(userAgent && !/bot|crawler|spider|preview|externalhit|curl|wget|headless|monitor|whatsapp|telegram/i.test(userAgent));
}
