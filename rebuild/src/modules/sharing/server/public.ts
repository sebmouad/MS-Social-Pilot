import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import type { ReviewParticipant } from '@/modules/publishing/server/lifecycle';
import { audit, authorizeSharing } from './access';
import { KIND_PUBLISHING_FEATURES, SHARING_MANAGER_ROLES } from '../semantics';
import { resourceAllowed } from './rate';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { DECISION_SCHEMA, TOKEN_SHAPE, hashToken, type ShareKind } from '../contracts';
import { ids } from './links';
import { sharingLimits } from './limits';
import { sharingChannels } from './channels';
import { visitorAllowed } from './rate';
import { REVIEW_NOTE_MAX, getReviewPort } from './review-port';

/**
 * Unauthenticated access. The token is the only credential. Every failure to resolve a link
 * (wrong shape, unknown, revoked, expired, suspended or purging workspace) is the same
 * `not_found`, so a visitor learns nothing about which links exist. Responses contain only
 * scoped, currently enabled channels and post content already intended for review: never
 * author ids, remote ids, errors, approval notes, tokens, drafts or internal status.
 */
export type PublicLink = { id: string; workspaceId: string; kind: ShareKind; title: string; description: string | null; targetIds: string[]; daysBack: number; daysAhead: number; allowComments: boolean; decides: boolean; createdById: string; workspaceName: string; timezone: string; tokenHash: string; creatorScope: string[] | null; providers: readonly string[] };
export type PublicAccess<T> = { ok: true; value: T } | { ok: false; reason: 'not_found' | 'rate_limited' };
type Row = Omit<PublicLink, 'targetIds' | 'workspaceName' | 'tokenHash' | 'creatorScope' | 'providers'> & { targetIds: unknown; workspaceName: string; tokenHash: string };
const notFound = { ok: false, reason: 'not_found' } as const;
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `bucket` separates page opens from image requests: a page of images must not spend the page-open allowance. */
export async function resolvePublicLink(token: string, address: string | null, bucket: 'view' | 'media' = 'view'): Promise<PublicAccess<PublicLink>> {
  // A malformed token never reaches the limiter or the database: there is nothing to protect and nothing to learn.
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return notFound;
  const limits = await sharingLimits();
  const tokenHash = hashToken(token);
  const allowed = () => visitorAllowed(`share:${bucket}`, address, tokenHash.slice(0, 24), bucket === 'media' ? limits.mediaRateLimit! : limits.viewRateLimit!, limits.viewRateWindowMs!, limits.anonymousVisitorFactor!, limits.rateStoreCapacity!);
  // A known address is counted before the lookup. With an unknown address the per-link window is created only once
  // the link is found, so guessed tokens never create windows (the digest lookup itself is then limited at the proxy).
  if (address && !allowed()) return { ok: false, reason: 'rate_limited' };
  const rows = await prisma.$queryRaw<Row[]>`SELECT l.id, l."workspaceId", l.kind, l.title, l.description, l."targetIds", l."daysBack", l."daysAhead", l."allowComments", l.decides, l."createdById", l."tokenHash", w.name AS "workspaceName", w.timezone FROM share_links l JOIN workspaces w ON w.id = l."workspaceId" WHERE l."tokenHash" = ${tokenHash} AND l."revokedAt" IS NULL AND l."expiresAt" IS NOT NULL AND l."expiresAt" > NOW() AND w."suspendedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = w.id AND p.status <> 'completed') LIMIT 1`;
  const row = rows[0]; if (!row) return notFound;
  // Corrupt legacy selections must never normalize into the intentional empty-array all-channels grant.
  if (!Array.isArray(row.targetIds) || row.targetIds.some(id => typeof id !== 'string' || !id.length)) return notFound;
  // The lookup is by digest equality; confirm the stored digest in constant time as defence in depth.
  const stored = Buffer.from(String(row.tokenHash), 'utf8'), given = Buffer.from(tokenHash, 'utf8');
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) return notFound;
  if (!address && !allowed()) return { ok: false, reason: 'rate_limited' };
  // The link only ever carries the authority its creator still holds: active owner/admin, entitled, within their current channel scope.
  let creator: Awaited<ReturnType<typeof authorizeSharing>>;
  try { creator = await authorizeSharing({ userId: row.createdById, workspaceId: row.workspaceId }, 'sharing', 'read'); } catch { return notFound; }
  // Post content is Publishing data: it is served only while the creator can currently read the Publishing features this kind shows.
  const needed: readonly string[] | undefined = KIND_PUBLISHING_FEATURES[row.kind];
  if (!needed || needed.some(feature => !creator.publishing.includes(feature))) return notFound;
  const { tokenHash: _stored, ...rest } = row; void _stored;
  return { ok: true, value: { ...rest, decides: rest.decides && creator.canApprove, targetIds: ids(row.targetIds), tokenHash, providers: creator.providers, creatorScope: creator.scope === null ? null : [...creator.scope] } };
}

export type PublicStatus = 'awaiting_review' | 'planned' | 'published';
export type PublicPost = {
  id: string; message: string; firstComment: string | null; link: string | null;
  /** External https media. */
  media: Array<{ kind: 'image' | 'video'; url: string }>;
  /** Uploaded images, previewed through the token-gated image route; other uploaded files are only counted. */
  uploadedImages: string[]; uploadedMediaCount: number;
  status: PublicStatus; scheduledAt: Date | null; destinations: Array<{ name: string; pictureUrl: string | null }>;
  latestFeedback: { decision: 'approved' | 'rejected' | 'comment'; at: Date } | null; canDecide: boolean;
};
type PostRow = { id: string; message: string; firstComment: string | null; link: string | null; media: unknown; status: string; scheduledAt: Date | null; publishedAt: Date | null };
/** Only states a client can meaningfully see. Drafts, rejected and failed posts are internal and never served. */
const STATUS_MAP: Record<string, PublicStatus> = { pending_approval: 'awaiting_review', scheduled: 'planned', published: 'published' };
/** Review shows only what waits for a decision; planned and published posts are shown by the calendar view alone. */
const REVIEW_STATUSES = ['pending_approval'], CALENDAR_STATUSES = ['scheduled', 'published'];

/** Enabled channels this link can still show right now: its own selection (or all enabled) that remain enabled. */
async function visibleTargets(link: PublicLink) {
  const rows = await sharingChannels(prisma, link.workspaceId, link.providers, link.targetIds.length ? link.targetIds : undefined);
  return new Map(rows.filter(row => link.creatorScope === null || link.creatorScope.includes(row.id)).map(row => [row.id, row]));
}
const httpsOnly = (value: unknown): string | null => { if (typeof value !== 'string') return null; try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null; } catch { return null; } };
function publicMedia(value: unknown) {
  const out: Array<{ kind: 'image' | 'video'; url: string }> = []; const images: string[] = []; let uploaded = 0;
  for (const item of Array.isArray(value) ? value : []) {
    const kind = item?.kind === 'video' ? 'video' : item?.kind === 'image' ? 'image' : null; if (!kind) continue;
    const url = httpsOnly(item?.url);
    if (url) { out.push({ kind, url }); continue; }
    const local = typeof item?.url === 'string' ? /^media:(.+)$/.exec(item.url)?.[1] : undefined;
    if (local !== undefined) { uploaded += 1; if (kind === 'image' && MEDIA_ID.test(local)) images.push(local.toLowerCase()); }
  }
  return { media: out, images, uploaded };
}

type View = { mode: 'review' | 'calendar'; posts: PublicPost[]; truncated: boolean };
async function loadPosts(link: PublicLink, mode: 'review' | 'calendar', max: number, only?: string): Promise<PublicPost[]> {
  const visible = await visibleTargets(link); const allowed = [...visible.keys()];
  if (!allowed.length) return [];
  const statuses = mode === 'review' ? REVIEW_STATUSES : CALENDAR_STATUSES;
  const back = mode === 'review' ? 36500 : link.daysBack, ahead = mode === 'review' ? 36500 : link.daysAhead;
  const posts = await prisma.$queryRaw<PostRow[]>`SELECT p.id, p.message, p."firstComment", p.link, p.media, p.status::text AS status, p."scheduledAt", p."publishedAt" FROM posts p WHERE p."workspaceId" = ${link.workspaceId} AND (${only ?? null}::text IS NULL OR p.id = ${only ?? null}) AND p.status::text = ANY(${statuses}::text[]) AND EXISTS (SELECT 1 FROM post_targets pt WHERE pt."postId" = p.id AND pt."targetId" = ANY(${allowed}::text[])) AND (${mode}::text = 'review' AND (p."scheduledAt" IS NULL OR p."scheduledAt" >= NOW()) OR ${mode}::text = 'calendar' AND COALESCE(p."scheduledAt", p."publishedAt") BETWEEN NOW() - (${back} * INTERVAL '1 day') AND NOW() + (${ahead} * INTERVAL '1 day')) ORDER BY p."scheduledAt" ASC NULLS LAST, p.id ASC LIMIT ${max + 1}`;
  if (!posts.length) return [];
  const postIds = posts.map(p => p.id);
  const [dest, feedback] = await Promise.all([
    prisma.$queryRaw<Array<{ postId: string; targetId: string }>>`SELECT "postId", "targetId" FROM post_targets WHERE "postId" = ANY(${postIds}::text[])`,
    prisma.$queryRaw<Array<{ postId: string; decision: 'approved' | 'rejected' | 'comment'; createdAt: Date }>>`SELECT DISTINCT ON ("postId") "postId", decision, "createdAt" FROM review_decisions WHERE "shareLinkId" = ${link.id} AND "postId" = ANY(${postIds}::text[]) ORDER BY "postId", "createdAt" DESC`,
  ]);
  const byPost = new Map<string, string[]>(); for (const d of dest) byPost.set(d.postId, [...(byPost.get(d.postId) ?? []), d.targetId]);
  const last = new Map(feedback.map(f => [f.postId, f]));
  return posts.map(p => {
    const all = byPost.get(p.id) ?? []; const { media, images, uploaded } = publicMedia(p.media);
    const covers = all.length > 0 && all.every(id => visible.has(id));
    return {
      id: p.id, message: p.message, firstComment: p.firstComment, link: httpsOnly(p.link), media, uploadedImages: images, uploadedMediaCount: uploaded, status: STATUS_MAP[p.status] ?? 'planned', scheduledAt: p.scheduledAt ?? p.publishedAt,
      destinations: all.filter(id => visible.has(id)).map(id => ({ name: visible.get(id)!.name, pictureUrl: httpsOnly(visible.get(id)!.pictureUrl) })),
      latestFeedback: last.get(p.id) ? { decision: last.get(p.id)!.decision, at: last.get(p.id)!.createdAt } : null,
      canDecide: link.decides && mode === 'review' && p.status === 'pending_approval' && covers,
    };
  });
}

/**
 * The annotation Publishing stores on the post and copies into its generic activity log. It is a fixed short
 * lifecycle marker: the client's name and comment live only in `review_decisions` (owner feedback view), so a free-text
 * body never spreads into the generic log, and no comment length can push an approval over the review note limit.
 */
export function reviewNote(decision: 'approved' | 'rejected') {
  const note = decision === 'approved' ? 'Approved by client via share link' : 'Changes requested by client via share link';
  return note.length > REVIEW_NOTE_MAX ? note.slice(0, REVIEW_NOTE_MAX) : note;
}

/** Which tab a link shows. Portal links offer review and calendar; results are not offered. */
export function publicMode(link: Pick<PublicLink, 'kind'>, tab?: string): 'review' | 'calendar' {
  if (link.kind === 'portal') return tab === 'calendar' ? 'calendar' : 'review';
  return link.kind === 'calendar' ? 'calendar' : 'review';
}
export async function loadPublicView(link: PublicLink, mode: 'review' | 'calendar'): Promise<View> {
  const limits = await sharingLimits();
  const posts = await loadPosts(link, mode, limits.maxItemsPerView!);
  return { mode, posts: posts.slice(0, limits.maxItemsPerView!), truncated: posts.length > limits.maxItemsPerView! };
}

/**
 * An uploaded image may be previewed only while a post this link currently shows references it. The caller has
 * already resolved the link (revocation, expiry, creator authority and rate limits applied).
 */
export async function linkShowsImage(link: PublicLink, mediaId: string): Promise<boolean> {
  if (!MEDIA_ID.test(mediaId)) return false;
  const limits = await sharingLimits(); const wanted = mediaId.toLowerCase();
  for (const mode of link.kind === 'review' ? ['review' as const] : link.kind === 'calendar' ? ['calendar' as const] : ['review' as const, 'calendar' as const]) {
    const posts = await loadPosts(link, mode, limits.maxItemsPerView!);
    if (posts.slice(0, limits.maxItemsPerView!).some(post => post.uploadedImages.includes(wanted))) return true;
  }
  return false;
}

/**
 * Re-validate, inside the mutation's own transaction and under row locks, everything `resolvePublicLink` checked
 * earlier: the stored digest still equals the one this request presented (so a rotation between resolve and write
 * wins), the link is neither revoked nor expired (and still decides when it must), the workspace is not suspended
 * or being erased, the creator is still an active owner/admin (their channel scope is therefore unrestricted),
 * and the post is still waiting for review on at least one (for a decision: only) enabled channel the link shows.
 * Every failure is the same `not_found`, so the visitor learns nothing about which check failed.
 */
async function lockPublicLinkForMutation(tx: Prisma.TransactionClient, link: PublicLink, postId: string, decides: boolean) {
  const gone = () => new OperationError('not_found', 'This link is not available.');
  const live = await tx.$queryRaw<Array<{ id: string }>>`SELECT l.id FROM share_links l JOIN memberships m ON m."userId" = l."createdById" AND m."workspaceId" = l."workspaceId" JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = l."workspaceId" WHERE l.id = ${link.id} AND l."workspaceId" = ${link.workspaceId} AND l."tokenHash" = ${link.tokenHash} AND l."revokedAt" IS NULL AND l."expiresAt" IS NOT NULL AND l."expiresAt" > NOW() AND (${decides}::boolean = false OR l.decides = true) AND w."suspendedAt" IS NULL AND u."disabledAt" IS NULL AND m.role::text = ANY(${[...SHARING_MANAGER_ROLES]}::text[]) FOR SHARE OF l, m, u, w`;
  if (!live[0]) throw gone();
  const purge = await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text FROM workspace_data_purges WHERE "workspaceId" = ${link.workspaceId} AND status::text <> 'completed'`;
  if (purge.length) throw gone();
  // Lock the post before resources on both advice and review paths.
  const lockedPost = await tx.$queryRaw<Array<{ id: string }>>`SELECT p.id FROM posts p WHERE p.id = ${postId} AND p."workspaceId" = ${link.workspaceId} FOR NO KEY UPDATE OF p`;
  if (!lockedPost[0]) throw gone();
  const list = link.creatorScope === null ? link.targetIds : link.targetIds.length ? link.targetIds.filter(id => link.creatorScope!.includes(id)) : [...link.creatorScope];
  // Recheck and lock the connection/selection in the same transaction as feedback.
  const currentTargets = await sharingChannels(tx, link.workspaceId, link.providers, link.targetIds.length || link.creatorScope !== null ? list : undefined, undefined, true);
  const eligibleIds = currentTargets.map(target => target.id);
  if (!eligibleIds.length) throw gone();
  const shown = await tx.$queryRaw<Array<{ id: string }>>`SELECT p.id FROM posts p WHERE p.id = ${postId} AND p."workspaceId" = ${link.workspaceId} AND p.status::text = ANY(${REVIEW_STATUSES}::text[]) AND (p."scheduledAt" IS NULL OR p."scheduledAt" >= NOW()) AND EXISTS (SELECT 1 FROM post_targets pt JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = p."workspaceId" WHERE pt."postId" = p.id AND t.enabled = true AND t.id = ANY(${eligibleIds}::text[])) AND (${decides}::boolean = false OR NOT EXISTS (SELECT 1 FROM post_targets pt2 LEFT JOIN targets t2 ON t2.id = pt2."targetId" AND t2."workspaceId" = p."workspaceId" WHERE pt2."postId" = p.id AND NOT COALESCE(t2.enabled = true AND t2.id = ANY(${eligibleIds}::text[]), false))) FOR NO KEY UPDATE OF p`;
  if (!shown[0]) throw gone();
}

export type DecisionResult ={ recorded: true; applied: boolean; decision: 'approved' | 'rejected' | 'comment'; message: string };
/**
 * A client's answer. Approve/request-changes settle the post only when the link decides, the post
 * waits for review and every one of its channels is within the link. The change goes through the review port
 * as the link creator and the stored answer is written in the SAME transaction as the status change, after
 * re-checking under a row lock that the link is still active, so a revocation or rotation racing the answer
 * either wins completely or loses completely. Otherwise the answer is stored as advice for the team.
 */
export async function submitDecision(token: string, address: string | null, input: unknown): Promise<PublicAccess<DecisionResult>> {
  const limits = await sharingLimits();
  const resolved = await resolvePublicLink(token, address); if (!resolved.ok) return resolved;
  const link = resolved.value;
  const key = link.tokenHash.slice(0, 24);
  if (!visitorAllowed('share:decide', address, key, limits.decisionRateLimit!, limits.decisionRateWindowMs!, 1, limits.rateStoreCapacity!)
    || !resourceAllowed('share:decide', key, limits.decisionRateLimit! * limits.decisionLinkFactor!, limits.decisionRateWindowMs!, limits.rateStoreCapacity!)) return { ok: false, reason: 'rate_limited' };
  if (link.kind === 'calendar') return notFound;
  const parsed = DECISION_SCHEMA.safeParse(input); if (!parsed.success) throw new OperationError('invalid_request', 'Enter your name and a valid answer.');
  const data = parsed.data; const comment = data.comment?.trim() || null;
  if (data.authorName.length > limits.authorNameMaxCharacters! || (comment?.length ?? 0) > limits.commentMaxCharacters!) throw new OperationError('invalid_request', 'Your name or comment is too long.');
  if (data.decision !== 'approved' && !comment) throw new OperationError('invalid_request', data.decision === 'rejected' ? 'Tell the team what to change.' : 'Write a comment first.');
  if (comment && !link.allowComments) throw new OperationError('invalid_request', 'Comments are switched off for this link.');
  const [post] = await loadPosts(link, 'review', 1, data.postId);
  if (!post) return notFound;
  const insert = async (tx: Pick<Prisma.TransactionClient, '$executeRaw'>) => {
    const stored = await tx.$executeRaw`INSERT INTO review_decisions (id, "shareLinkId", "postId", decision, comment, "authorName", "createdAt") VALUES (${randomUUID()}, ${link.id}, ${post.id}, ${data.decision}, ${comment}, ${data.authorName}, NOW())`;
    if (stored !== 1) throw new OperationError('unavailable', 'Your answer could not be stored.');
  };
  const unconfirmed = () => new OperationError('upstream_failure', 'Your answer could not be confirmed. Reload the page to see whether it was received before trying again.');
  /** Why an answer was kept as advice instead of settling the post. Audited by code only, never with the body. */
  const advice = async (reason: 'comment' | 'link_cannot_decide' | 'authority_refused'): Promise<PublicAccess<null>> => {
    try {
      // One transaction: fresh link/creator/scope checks, the stored answer and its audit commit together or not at all.
      await prisma.$transaction(async tx => {
        await lockPublicLinkForMutation(tx, link, post.id, false);
        await insert(tx);
        await audit(tx, { userId: link.createdById, workspaceId: link.workspaceId }, 'sharing.client_answer_recorded', { linkId: link.id, postId: post.id, decision: data.decision, applied: false, reason, commentCharacters: comment?.length ?? 0, via: 'share_link' });
      }, { timeout: limits.transactionTimeoutMs!, maxWait: limits.transactionMaxWaitMs! });
      return { ok: true, value: null };
    } catch (error) {
      if (error instanceof OperationError && error.code === 'not_found') return notFound;
      throw unconfirmed();
    }
  };
  let applied = false;
  if (data.decision !== 'comment' && link.decides) {
    if (!post.canDecide) throw new OperationError('conflict', 'This post is no longer waiting for your decision.');
    const participant: ReviewParticipant = {
      // Same transaction as the status change: the link must still carry THIS token, be live and decide, its creator
      // must still be an active manager, and the post must still lie wholly inside the link.
      before: tx => lockPublicLinkForMutation(tx, link, post.id, true),
      after: async tx => {
        await insert(tx);
        await audit(tx, { userId: link.createdById, workspaceId: link.workspaceId }, 'sharing.client_answer_recorded', { linkId: link.id, postId: post.id, decision: data.decision, applied: true, commentCharacters: comment?.length ?? 0, via: 'share_link' });
      },
    };
    let refused = false;
    try {
      // Not inside any sharing transaction: the lifecycle opens its own, and holding a pooled connection here could deadlock the pool.
      await getReviewPort().review({ userId: link.createdById, workspaceId: link.workspaceId }, post.id, data.decision === 'approved' ? 'approve' : 'reject', reviewNote(data.decision), participant);
      applied = true;
    } catch (error) {
      if (!(error instanceof OperationError)) throw unconfirmed();
      if (error.code === 'conflict') throw new OperationError('conflict', 'This post is no longer waiting for your decision.');
      if (error.code === 'not_found') return notFound;
      // Only an authority/policy refusal (the creator may no longer approve) becomes advice. Database, participant and
      // unknown failures rolled the whole review back and are reported as unconfirmed, never as a received answer.
      if (error.code !== 'forbidden' && error.code !== 'unauthorized') throw unconfirmed();
      refused = true;
    }
    if (refused) { const stored = await advice('authority_refused'); if (!stored.ok) return stored; }
  } else {
    const stored = await advice(data.decision === 'comment' ? 'comment' : 'link_cannot_decide'); if (!stored.ok) return stored;
  }
  const message = applied ? (data.decision === 'approved' ? 'Approved. Thank you.' : 'Changes requested. The team has been told.') : data.decision === 'comment' ? 'Comment sent to the team.' : 'Your answer was sent to the team, who will make the final call.';
  return { ok: true, value: { recorded: true, applied, decision: data.decision, message } };
}
