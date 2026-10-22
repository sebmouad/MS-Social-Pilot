import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';
import { instantToWall, isValidTimeZone, wallTimeToInstant, weekdayOfKey } from '@/lib/calendar-dates';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { platformAnalytics } from '@/server/platforms/registry';
import { checkUrlShape, defaultFetchDeps, guardedFetch, NetGuardError, type FetchDeps } from '@/modules/publishing/server/media/network/net-guard';
import { authorizeAi, type AiActor } from '../../server/access';
import { linkPreviewCacheSchema, linkPreviewPolicySchema, outlookPolicySchema, spamPolicySchema } from '../../config';
import { assessSpamRisk, formatOfAppPost, parseOpenGraphHtml, POST_FORMATS, predictEngagement, previewIsUsable, type LinkPreview, type Outlook, type PastPost, type SpamRisk } from '../pure';
import { toolsCopy, type Locale } from './copy-loader';

const COMPOSER = 'publishing/posts';
export type ChecksActor = AiActor & { apiKeyId?: string };
export type ChecksDeps = { net?: FetchDeps; now?: () => Date; locale?: Locale };
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Errors already carrying customer wording; the outer boundary must not translate them a second time. */
const localisedErrors = new WeakSet<OperationError>();
async function failure(code: OperationErrorCode, locale: Locale, link = false) {
  const c = await toolsCopy(locale);
  const text = link ? c.errLink : { invalid_request: c.errInvalid, unauthorized: c.errUnauthorized, forbidden: c.errForbidden, not_found: c.errNotFound, unavailable: c.errUnavailable, reconnect_required: c.errReconnect, conflict: c.errConflict, upstream_failure: c.errUpstream }[code];
  const error = new OperationError(code, text);
  localisedErrors.add(error);
  return error;
}
const boundary = (error: unknown, locale: Locale) => error instanceof OperationError && localisedErrors.has(error) ? error : failure(error instanceof OperationError ? error.code : 'upstream_failure', locale);
const policyOf = async <S extends z.ZodTypeAny>(key: 'ai.linkPreviewPolicy' | 'ai.outlookPolicy' | 'ai.spamGuardPolicy' | 'ai.linkPreviewCache', schema: S): Promise<z.output<S>> => {
  const parsed = schema.safeParse(await runtimeConfig(key));
  if (!parsed.success || !(parsed.data as { enabled: boolean }).enabled) throw new OperationError('unavailable', 'unavailable');
  return parsed.data;
};
const workspaceClock = async (workspaceId: string) => {
  const rows = await prisma.$queryRaw<Array<{ timezone: string; spamGapMinutes: number }>>`SELECT timezone, "spamGapMinutes" FROM workspaces WHERE id = ${workspaceId}`;
  if (!rows[0] || !isValidTimeZone(rows[0].timezone)) throw new OperationError('unavailable', 'unavailable');
  return rows[0];
};
/** A typed wall-clock time ("2026-11-02T09:30") in a time zone; null when it cannot be read. */
function instantOf(localInput: string | null | undefined, timeZone: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(localInput ?? '');
  if (!match) return null;
  const at = wallTimeToInstant(match[1]!, match[2]!, timeZone);
  return at.ok ? at.instant : null;
}
const localInput = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullish();
const zone = z.string().min(1).max(64).optional();

/** The member's channel grants, narrowed by any key ceiling, must contain every channel asked about. */
function scopedChannel(auth: { allowedTargetIds?: string[] | undefined }, ids: string[]) {
  if (auth.allowedTargetIds && ids.some(id => !auth.allowedTargetIds!.includes(id))) throw new OperationError('forbidden', 'forbidden');
  return auth;
}

// ------------------------------------------------------------------ link preview

const cachedPreviewSchema = z.object({ url: z.string(), title: z.string().nullable(), description: z.string().nullable(), imageUrl: z.string().nullable(), siteName: z.string().nullable(), fetchedAt: z.string() }).strict();
const cacheKeyOf = (url: string) => createHash('sha256').update(url).digest('hex');
async function cachePolicy() {
  const parsed = linkPreviewCacheSchema.safeParse(await runtimeConfig('ai.linkPreviewCache').catch(() => null));
  return parsed.success ? parsed.data : { enabled: false, ttlMinutes: 1440 };
}
/** Fresh cached preview, or null on a miss, an expired entry, an unreadable row or a missing table. */
async function readPreviewCache(url: string, now: Date): Promise<LinkPreview | null> {
  try {
    const [row] = await prisma.$queryRaw<Array<{ preview: unknown }>>`SELECT preview FROM link_preview_cache WHERE "urlHash" = ${cacheKeyOf(url)} AND "expiresAt" > ${now}`;
    const parsed = cachedPreviewSchema.safeParse(row?.preview);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
async function storePreviewCache(url: string, preview: LinkPreview, ttlMinutes: number, now: Date) {
  try {
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
    await prisma.$executeRaw`INSERT INTO link_preview_cache ("urlHash", url, preview, "fetchedAt", "expiresAt") VALUES (${cacheKeyOf(url)}, ${url}, ${JSON.stringify(preview)}::jsonb, ${now}, ${expiresAt})
      ON CONFLICT ("urlHash") DO UPDATE SET url = ${url}, preview = ${JSON.stringify(preview)}::jsonb, "fetchedAt" = ${now}, "expiresAt" = ${expiresAt}`;
    await prisma.$executeRaw`DELETE FROM link_preview_cache WHERE "urlHash" IN (SELECT "urlHash" FROM link_preview_cache WHERE "expiresAt" < ${now} LIMIT 100)`;
  } catch { /* a cache write never fails the preview */ }
}

/**
 * Title, description and picture of a public web address, fetched by the server under the Root network policy.
 * A fresh cached entry is served without fetching (and without spending the hourly budget); misses fetch,
 * then cache usable previews for the Root TTL. "No preview" answers are never cached.
 */
export async function linkPreview(actor: ChecksActor, raw: unknown, deps: ChecksDeps = {}): Promise<{ preview: LinkPreview | null; cached: boolean }> {
  const locale = deps.locale ?? 'en';
  try {
    await authorizeAi(actor, COMPOSER, 'write');
    const policy = await policyOf('ai.linkPreviewPolicy', linkPreviewPolicySchema);
    const parsed = z.object({ url: z.string().trim().min(1).max(policy.urlMaxCharacters).refine(v => !CONTROL.test(v)) }).strict().safeParse(raw);
    if (!parsed.success) throw new OperationError('invalid_request', 'invalid_request');
    const fetchPolicy = { timeoutMs: policy.timeoutMs, maxBytes: policy.maxBytes, maxRedirects: policy.maxRedirects, allowHttp: policy.allowHttp, hostAllowlist: policy.hostAllowlist };
    try { checkUrlShape(parsed.data.url, fetchPolicy); } catch (error) { if (error instanceof NetGuardError) throw await failure('invalid_request', locale, true); throw error; }
    const now = (deps.now ?? (() => new Date()))();
    const cache = await cachePolicy();
    if (cache.enabled) {
      const hit = await readPreviewCache(parsed.data.url, now);
      if (hit) return { preview: hit, cached: true };
    }
    // Hourly allowance per workspace, counted from the audit trail; the claim is the audit record (host only, never the full address).
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`linkpreview:${actor.workspaceId}`}))::text`;
      const used = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND action = 'linkPreview.fetched' AND "createdAt" > ${new Date(now.getTime() - 3_600_000)}`;
      if (Number(used[0]?.count ?? 0) >= policy.hourlyPerWorkspace) throw new OperationError('conflict', 'conflict');
      const host = new URL(parsed.data.url).hostname;
      const detail = JSON.stringify({ host, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId, authSource: 'api_key' } : {}) });
      if (await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'linkPreview.fetched', ${detail}::jsonb, ${now})` !== 1) throw new OperationError('unavailable', 'unavailable');
    });
    let preview: LinkPreview;
    try {
      const result = await guardedFetch(parsed.data.url, fetchPolicy, deps.net ?? defaultFetchDeps(), { headers: { 'user-agent': policy.userAgent, accept: policy.accept } });
      if (result.notModified || !result.contentType.includes('html')) return { preview: null, cached: false };
      preview = parseOpenGraphHtml(result.bytes.toString('utf8'), result.finalUrl, policy, now);
    } catch (error) {
      // An address that cannot be read is "no preview", not a failure of the product.
      if (error instanceof NetGuardError) return { preview: null, cached: false };
      throw error;
    }
    const usable = previewIsUsable(preview) ? preview : null;
    if (usable && cache.enabled) await storePreviewCache(parsed.data.url, usable, cache.ttlMinutes, now);
    return { preview: usable, cached: false };
  } catch (error) { throw await boundary(error, locale); }
}

/** Cached preview reads only: never fetches, never spends the hourly budget. Renders use this. */
export async function linkPreviewCache(actor: ChecksActor, raw: unknown, deps: ChecksDeps = {}): Promise<{ preview: LinkPreview | null; cached: boolean }> {
  const locale = deps.locale ?? 'en';
  try {
    await authorizeAi(actor, COMPOSER, 'write');
    const parsed = z.object({ url: z.string().trim().min(1).max(4000).refine(v => !CONTROL.test(v)) }).strict().safeParse(raw);
    if (!parsed.success) throw new OperationError('invalid_request', 'invalid_request');
    try { new URL(parsed.data.url); } catch { throw await failure('invalid_request', locale, true); }
    const now = (deps.now ?? (() => new Date()))();
    const hit = await readPreviewCache(parsed.data.url, now);
    return { preview: hit, cached: hit !== null };
  } catch (error) { throw await boundary(error, locale); }
}

// ------------------------------------------------------------------ engagement outlook

const outlookInput = (maxText: number) => z.object({ targetId: z.string().min(1).max(200), format: z.enum(POST_FORMATS), length: z.number().int().min(0).max(maxText), scheduledAtLocal: localInput, timezone: zone }).strict();

/** How a draft compares with the channel's own past posts. Advice only: stored figures, no provider request. */
export async function engagementOutlook(actor: ChecksActor, raw: unknown, deps: ChecksDeps = {}): Promise<Outlook & { channel: string | null }> {
  const locale = deps.locale ?? 'en';
  try {
    const auth = await authorizeAi(actor, COMPOSER, 'write');
    const policy = await policyOf('ai.outlookPolicy', outlookPolicySchema);
    const parsed = outlookInput(policy.maxTextCharacters).safeParse(raw);
    if (!parsed.success) throw new OperationError('invalid_request', 'invalid_request');
    const input = parsed.data;
    if (input.timezone && !isValidTimeZone(input.timezone)) throw new OperationError('invalid_request', 'invalid_request');
    scopedChannel(auth, [input.targetId]);
    const clock = await workspaceClock(actor.workspaceId);
    const target = await prisma.target.findFirst({ where: { id: input.targetId, workspaceId: actor.workspaceId, enabled: true }, select: { id: true, name: true, socialAccount: { select: { provider: true } } } });
    if (!target) throw new OperationError('not_found', 'not_found');
    const now = (deps.now ?? (() => new Date()))();
    const wall = (instant: Date) => { const w = instantToWall(instant, clock.timezone); return { hour: Number(w.time.slice(0, 2)), weekday: weekdayOfKey(w.date) }; };
    const at = instantOf(input.scheduledAtLocal, input.timezone ?? clock.timezone);
    const planned = at ? wall(at) : { hour: null, weekday: null };
    const unknown: Outlook & { channel: string | null } = { outlook: 'unknown', basis: 0, reasons: [], channel: target.name };
    const provider = target.socialAccount?.provider;
    const host = provider ? await platformAnalytics(provider) : null;
    if (!host?.postPerformance) return unknown;
    const from = new Date(now.getTime() - policy.lookbackDays * 86_400_000);
    const posts = await host.postPerformance({ workspaceId: actor.workspaceId, targetId: target.id, from, to: now, limit: policy.maxPosts, sort: 'publishedAt', direction: 'desc' });
    const measured = posts.filter(p => p.publishedAt && p.publishedAt >= from && p.publishedAt < now && p.rankValue !== null);
    const ids = measured.map(p => p.postId);
    const local = ids.length ? await prisma.$queryRaw<Array<{ id: string; link: string | null; media: unknown }>>`SELECT id, link, media FROM posts WHERE "workspaceId" = ${actor.workspaceId} AND id = ANY(${ids}::text[])` : [];
    const formats = new Map(local.map(row => [row.id, formatOfAppPost(Array.isArray(row.media) ? row.media as Array<{ kind?: unknown }> : [], row.link)] as const));
    const history: PastPost[] = measured.map(p => ({ format: formats.get(p.postId) ?? null, length: p.text.length, ...wall(p.publishedAt!), interactions: p.rankValue! }));
    return { ...predictEngagement(history, { format: input.format, length: input.length, ...planned }, policy), channel: target.name };
  } catch (error) { throw await boundary(error, locale); }
}

// ------------------------------------------------------------------ spam risk

type NearbyRow = { message: string; link: string | null; channels: Array<{ id: string; provider: string | null }> };
const spamInput = (p: { maxChannels: number; maxTextCharacters: number }) => z.object({
  message: z.string().max(p.maxTextCharacters).default(''), link: z.string().max(2000).nullish(), targetIds: z.array(z.string().min(1).max(200)).min(1).max(p.maxChannels),
  scheduledAtLocal: localInput, timezone: zone, postId: z.string().min(1).max(200).optional(),
}).strict();

/** Would this post put the same link or text on too many channels of one network at once? Advice only; it never blocks. */
export async function spamCheck(actor: ChecksActor, raw: unknown, deps: ChecksDeps = {}): Promise<{ risk: SpamRisk | null; gapMinutes: number }> {
  const locale = deps.locale ?? 'en';
  try {
    const auth = await authorizeAi(actor, COMPOSER, 'write');
    const policy = await policyOf('ai.spamGuardPolicy', spamPolicySchema);
    const parsed = spamInput(policy).safeParse(raw);
    if (!parsed.success) throw new OperationError('invalid_request', 'invalid_request');
    const input = parsed.data;
    if (input.timezone && !isValidTimeZone(input.timezone)) throw new OperationError('invalid_request', 'invalid_request');
    const ids = [...new Set(input.targetIds)];
    scopedChannel(auth, ids);
    const clock = await workspaceClock(actor.workspaceId);
    if (clock.spamGapMinutes <= 0) return { risk: null, gapMinutes: 0 };
    const now = (deps.now ?? (() => new Date()))();
    const at = input.scheduledAtLocal ? instantOf(input.scheduledAtLocal, input.timezone ?? clock.timezone) : now;
    if (!at) return { risk: null, gapMinutes: clock.spamGapMinutes };
    const gap = clock.spamGapMinutes * 60_000;
    const from = new Date(at.getTime() - gap); const to = new Date(at.getTime() + gap);
    const own = await prisma.target.findMany({ where: { workspaceId: actor.workspaceId, id: { in: ids }, enabled: true }, select: { id: true, socialAccount: { select: { provider: true } } } });
    if (own.length !== ids.length) throw new OperationError('not_found', 'not_found');
    const excluded = input.postId ?? '';
    const rows = await prisma.$queryRaw<NearbyRow[]>`
      SELECT p.message, p.link, COALESCE(json_agg(json_build_object('id', t.id, 'provider', sa.provider)) FILTER (WHERE t.id IS NOT NULL), '[]'::json) AS channels
      FROM posts p LEFT JOIN post_targets pt ON pt."postId" = p.id LEFT JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = p."workspaceId" LEFT JOIN social_accounts sa ON sa.id = t."socialAccountId"
      WHERE p."workspaceId" = ${actor.workspaceId} AND p.id <> ${excluded}
        AND p.status::text IN ('pending_approval', 'scheduled', 'publishing', 'published')
        AND ((p."scheduledAt" >= ${from} AND p."scheduledAt" <= ${to}) OR (p."scheduledAt" IS NULL AND p."createdAt" >= ${from} AND p."createdAt" <= ${to}))
      GROUP BY p.id ORDER BY p."createdAt" DESC LIMIT ${policy.nearbyPostLimit}`;
    // A member limited to some channels is told only about those: counting hidden channels would disclose them.
    const visible = (id: string) => !auth.allowedTargetIds || auth.allowedTargetIds.includes(id);
    const nearby = rows.map(row => ({ message: row.message, link: row.link, channels: row.channels.filter(c => visible(c.id)).map(c => ({ id: c.id, network: c.provider ?? 'unknown' })) }));
    const risk = assessSpamRisk({ message: input.message, link: input.link ?? null, own: own.map(t => ({ id: t.id, network: t.socialAccount?.provider ?? 'unknown' })), nearby, gapMinutes: clock.spamGapMinutes }, policy);
    return { risk, gapMinutes: clock.spamGapMinutes };
  } catch (error) { throw await boundary(error, locale); }
}
