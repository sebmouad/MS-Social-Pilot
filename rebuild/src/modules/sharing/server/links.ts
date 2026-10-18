import { randomUUID } from 'node:crypto';
import type { ZodError } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import {
  ACCESS_FIELDS, CREATE_LINK_SCHEMA, FEEDBACK_QUERY_SCHEMA, LINK_ACTION_SCHEMA, LIST_QUERY_SCHEMA, UPDATE_LINK_SCHEMA, createLinkConfirmation, deleteLinkConfirmation, hashToken,
  linkStatus, linkVersion, newToken, revokeLinkConfirmation, rotateLinkConfirmation, sharePath, updateLinkConfirmation, type LinkStatus, type ShareKind, type SharingActor, type SharingReadOptions,
} from '../contracts';
import { KIND_PUBLISHING_FEATURES } from '../semantics';
import { audit, authorizeSharing, bad, exact, lockActor, missing, pageSize, protect, transact, type SharingAuthorization } from './access';
import { sharingLimits } from './limits';

type Row = { id: string; kind: ShareKind; title: string; description: string | null; targetIds: unknown; daysBack: number; daysAhead: number; allowComments: boolean; decides: boolean; revokedAt: Date | null; expiresAt: Date | null; createdAt: Date; createdById: string; decisions: bigint | number; tokenHash?: string };
export type ShareLinkSummary = { id: string; kind: ShareKind; title: string; description: string | null; targetIds: string[]; daysBack: number; daysAhead: number; allowComments: boolean; decides: boolean; status: LinkStatus; expiresAt: Date | null; createdAt: Date; createdById: string; feedbackCount: number; /** Pass back as expectedVersion when editing; changes whenever the link or its address changes. */ version: string };
export type ShareFeedback = { id: string; postId: string; decision: 'approved' | 'rejected' | 'comment'; comment: string | null; authorName: string; createdAt: Date; postStatus: string | null; postPreview: string | null };

export const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
const summary = (row: Row): ShareLinkSummary => ({ id: row.id, kind: row.kind, title: row.title, description: row.description, targetIds: ids(row.targetIds), daysBack: row.daysBack, daysAhead: row.daysAhead, allowComments: row.allowComments, decides: row.decides, status: linkStatus(row), expiresAt: row.expiresAt, createdAt: row.createdAt, createdById: row.createdById, feedbackCount: Number(row.decisions), version: linkVersion({ ...row, targetIds: ids(row.targetIds) }, row.tokenHash ?? '') });
/** Customer-readable reasons for the few input mistakes a person can fix; everything else stays generic. */
const explain = (error: ZodError) => {
  if (error.issues.some(i => i.path[0] === 'targetIds' && i.code === 'invalid_type' && i.received === 'undefined')) return bad('Choose at least one channel for this link.');
  const issue = error.issues.find(i => (i.path[0] === 'targetIds' && i.code === 'too_small') || i.path[0] === 'expectedVersion');
  return bad(issue ? issue.message : undefined);
};
/** A link is manageable when it names channels and all lie inside the actor's scope; unrestricted actors manage all. */
const inScope = (auth: SharingAuthorization, targets: string[]) => auth.scope === null || (targets.length > 0 && targets.every(id => auth.scope!.includes(id)));

export async function listShareLinks(actor: SharingActor, input: unknown = {}, options: SharingReadOptions = {}) {
  const query = LIST_QUERY_SCHEMA.safeParse(input); if (!query.success) throw bad('Choose a valid result page.');
  const auth = await authorizeSharing(actor, 'sharing', 'read'); const limits = await sharingLimits();
  const page = query.data.page ?? 1, size = pageSize(limits.pageSize!, options.maxItems), offset = (page - 1) * size;
  const rows = await protect(auth.scope === null
    ? prisma.$queryRaw<Row[]>`SELECT l.id, l.kind, l.title, l.description, l."targetIds", l."daysBack", l."daysAhead", l."allowComments", l.decides, l."revokedAt", l."expiresAt", l."createdAt", l."createdById", l."tokenHash", (SELECT COUNT(*) FROM review_decisions d WHERE d."shareLinkId" = l.id) AS decisions FROM share_links l WHERE l."workspaceId" = ${actor.workspaceId} ORDER BY l."createdAt" DESC, l.id ASC LIMIT ${size + 1} OFFSET ${offset}`
    : prisma.$queryRaw<Row[]>`SELECT l.id, l.kind, l.title, l.description, l."targetIds", l."daysBack", l."daysAhead", l."allowComments", l.decides, l."revokedAt", l."expiresAt", l."createdAt", l."createdById", l."tokenHash", (SELECT COUNT(*) FROM review_decisions d WHERE d."shareLinkId" = l.id) AS decisions FROM share_links l WHERE l."workspaceId" = ${actor.workspaceId} AND jsonb_array_length(l."targetIds") > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(l."targetIds") e WHERE e <> ALL(${[...auth.scope]}::text[])) ORDER BY l."createdAt" DESC, l.id ASC LIMIT ${size + 1} OFFSET ${offset}`);
  return { links: rows.slice(0, size).map(summary), page, pageSize: size, hasMore: rows.length > size };
}

/** Channels the actor may put on a link (enabled, in-workspace, within scope); the owner picker reads this. */
export async function listShareableChannels(actor: SharingActor, options: SharingReadOptions = {}) {
  const auth = await authorizeSharing(actor, 'sharing', 'read');
  const rows = await protect(prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM targets WHERE "workspaceId" = ${actor.workspaceId} AND enabled = true ORDER BY name ASC, id ASC LIMIT 500`);
  return rows.filter(row => auth.scope === null || auth.scope.includes(row.id)).slice(0, pageSize(500, options.maxItems));
}

/** The client answers recorded through one link, newest first, with the post's current status (the actual approval effect). */
export async function listShareFeedback(actor: SharingActor, input: unknown, options: SharingReadOptions = {}) {
  const query = FEEDBACK_QUERY_SCHEMA.safeParse(input); if (!query.success) throw bad('Choose a valid link.');
  const auth = await authorizeSharing(actor, 'sharing', 'read'); const limits = await sharingLimits();
  const page = query.data.page ?? 1, size = pageSize(limits.feedbackPageSize!, options.maxItems), offset = (page - 1) * size;
  return protect((async () => {
    const found = await prisma.$queryRaw<Array<{ id: string; targetIds: unknown }>>`SELECT id, "targetIds" FROM share_links WHERE id = ${query.data.id} AND "workspaceId" = ${actor.workspaceId}`;
    if (!found[0] || !inScope(auth, ids(found[0].targetIds))) throw missing();
    const rows = await prisma.$queryRaw<Array<{ id: string; postId: string; decision: ShareFeedback['decision']; comment: string | null; authorName: string; createdAt: Date; postStatus: string | null; postPreview: string | null }>>`SELECT d.id, d."postId", d.decision, d.comment, d."authorName", d."createdAt", p.status::text AS "postStatus", LEFT(p.message, 140) AS "postPreview" FROM review_decisions d LEFT JOIN posts p ON p.id = d."postId" AND p."workspaceId" = ${actor.workspaceId} WHERE d."shareLinkId" = ${found[0].id} ORDER BY d."createdAt" DESC, d.id ASC LIMIT ${size + 1} OFFSET ${offset}`;
    // Post status and preview are Publishing data: withheld unless the actor (and any key ceiling) can currently read Publishing.
    const publishingVisible = auth.publishing.includes('publishing/approvals') || auth.publishing.includes('publishing/posts');
    const visible = publishingVisible ? rows : rows.map(row => ({ ...row, postStatus: null, postPreview: null }));
    return { linkId: found[0].id, feedback: visible.slice(0, size) as ShareFeedback[], page, pageSize: size, hasMore: rows.length > size };
  })());
}

export async function createShareLink(actor: SharingActor, input: unknown) {
  const parsed = CREATE_LINK_SCHEMA.safeParse(input); if (!parsed.success) throw explain(parsed.error);
  const data = parsed.data; exact(data.confirmation, createLinkConfirmation(data.title));
  const auth = await authorizeSharing(actor, 'sharing', 'write'); const limits = await sharingLimits();
  if (data.title.length > limits.titleMaxCharacters! || (data.description?.length ?? 0) > limits.descriptionMaxCharacters! || data.targetIds.length > limits.maxTargetsPerLink! || data.daysBack > limits.maxDaysBack! || data.daysAhead > limits.maxDaysAhead!) throw bad();
  const days = data.expiresInDays ?? limits.defaultExpiryDays!; if (days > limits.maxExpiryDays!) throw bad(`Links can last at most ${limits.maxExpiryDays} days.`);
  // A link serves Publishing content, so it can only be minted with current Publishing read (and any key ceiling); a Settings-only key cannot gift it.
  const needed = KIND_PUBLISHING_FEATURES[data.kind];
  if (needed.some(feature => !auth.publishing.includes(feature))) throw new OperationError('forbidden', 'You need Publishing access to share posts.');
  if (data.decides && data.kind === 'calendar') throw bad('Calendar links cannot approve posts.');
  if (data.decides && !auth.canApprove) throw new OperationError('forbidden', 'You need approval permission to create a link that lets clients decide.');
  const requested = [...new Set(data.targetIds)];
  const token = newToken();
  return protect(transact(actor.workspaceId, limits, async tx => {
    await lockActor(tx, actor, 'sharing', needed, data.decides ? ['publishing/approvals'] : []);
    const owned = requested.length ? (await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM targets WHERE "workspaceId" = ${actor.workspaceId} AND enabled = true AND id = ANY(${requested}::text[])`).map(r => r.id) : [];
    if (owned.length !== requested.length) throw bad('Choose channels that are enabled in this workspace.');
    // A scoped member can only name channels inside their own access; an empty list is already refused by the schema.
    if (auth.scope !== null && requested.some(id => !auth.scope!.includes(id))) throw new OperationError('forbidden', 'You can only share channels you have access to.');
    const count = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM share_links WHERE "workspaceId" = ${actor.workspaceId}`;
    if (Number(count[0]?.count ?? 0) >= limits.maxLinksPerWorkspace!) throw new OperationError('conflict', 'This workspace has reached its share link limit. Delete old links first.');
    const id = `shl_${randomUUID()}`;
    const inserted = await tx.$executeRaw`INSERT INTO share_links (id, "workspaceId", kind, "tokenHash", title, description, "targetIds", "daysBack", "daysAhead", "allowComments", decides, "expiresAt", "createdById", "createdAt") VALUES (${id}, ${actor.workspaceId}, ${data.kind}, ${hashToken(token)}, ${data.title}, ${data.description ?? null}, ${JSON.stringify(requested)}::jsonb, ${data.daysBack}, ${data.daysAhead}, ${data.allowComments}, ${data.decides}, NOW() + (${days} * INTERVAL '1 day'), ${actor.userId}, NOW())`;
    if (inserted !== 1) throw new OperationError('unavailable', 'The share link could not be created.');
    await audit(tx, actor, 'sharing.link_created', { linkId: id, kind: data.kind, decides: data.decides, expiresInDays: days, channelCount: requested.length });
    // The path carries the only copy of the secret; it is shown once and never stored in plain text.
    return { id, path: sharePath(token), expiresInDays: days };
  }), 'A share link could not be created.');
}

async function lockLink(tx: Parameters<Parameters<typeof transact>[2]>[0], auth: SharingAuthorization, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; kind: ShareKind; decides: boolean; title: string; targetIds: unknown; revokedAt: Date | null; expiresAt: Date | null }>>`SELECT id, kind, decides, title, "targetIds", "revokedAt", "expiresAt" FROM share_links WHERE id = ${id} AND "workspaceId" = ${auth.actor.workspaceId} FOR UPDATE`;
  const row = rows[0]; if (!row || !inScope(auth, ids(row.targetIds))) throw missing();
  return row;
}

type EditRow = Omit<Row, 'decisions' | 'createdAt' | 'createdById'> & { tokenHash: string };
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(id => b.includes(id));

/**
 * Edit a link in place. Title and description are metadata and keep the address. Anything that changes who can see or
 * do what (kind, channels, calendar window, comments, deciding, lifetime) replaces the secret in the same transaction,
 * because public answers are bound to the secret they were opened with: the old address and any open page stop working.
 * The caller must present the `version` it read; a mismatch is a conflict, never an overwrite. A revoked link stays
 * revoked (only its title and description may change). The creator is never changed.
 */
export async function updateShareLink(actor: SharingActor, input: unknown) {
  const parsed = UPDATE_LINK_SCHEMA.safeParse(input); if (!parsed.success) throw explain(parsed.error);
  const data = parsed.data;
  const auth = await authorizeSharing(actor, 'sharing', 'write'); const limits = await sharingLimits();
  if ((data.title?.length ?? 0) > limits.titleMaxCharacters! || (data.description?.length ?? 0) > limits.descriptionMaxCharacters!) throw bad('The title or message is too long.');
  if (data.daysBack !== undefined && data.daysBack > limits.maxDaysBack!) throw bad(`A link can show at most ${limits.maxDaysBack} days back.`);
  if (data.daysAhead !== undefined && data.daysAhead > limits.maxDaysAhead!) throw bad(`A link can show at most ${limits.maxDaysAhead} days ahead.`);
  if (data.expiresInDays !== undefined && data.expiresInDays > limits.maxExpiryDays!) throw bad(`Links can last at most ${limits.maxExpiryDays} days.`);
  const requested = data.targetIds ? [...new Set(data.targetIds)] : undefined;
  if (requested && requested.length > limits.maxTargetsPerLink!) throw bad(`Choose at most ${limits.maxTargetsPerLink} channels for one link.`);
  const token = newToken();
  return protect(transact(actor.workspaceId, limits, async tx => {
    await lockActor(tx, actor, 'sharing');
    const rows = await tx.$queryRaw<EditRow[]>`SELECT id, kind, title, description, "targetIds", "daysBack", "daysAhead", "allowComments", decides, "revokedAt", "expiresAt", "tokenHash" FROM share_links WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    const row = rows[0]; if (!row || !inScope(auth, ids(row.targetIds))) throw missing();
    const stored = ids(row.targetIds);
    if (linkVersion({ ...row, targetIds: stored }, row.tokenHash) !== data.expectedVersion) throw new OperationError('conflict', 'This link was changed by someone else. Reload it to see the latest settings, then make your change again.');

    const next = { kind: row.kind, title: row.title, description: row.description, targetIds: stored, daysBack: row.daysBack, daysAhead: row.daysAhead, allowComments: row.allowComments, decides: row.decides };
    const changed: string[] = [];
    const description = data.description === undefined ? undefined : data.description === '' ? null : data.description;
    if (data.title !== undefined && data.title !== row.title) { changed.push('title'); next.title = data.title; }
    if (description !== undefined && description !== row.description) { changed.push('description'); next.description = description; }
    if (data.kind !== undefined && data.kind !== row.kind) { changed.push('kind'); next.kind = data.kind; }
    if (requested && !sameSet(requested, stored)) { changed.push('targetIds'); next.targetIds = requested; }
    if (data.daysBack !== undefined && data.daysBack !== row.daysBack) { changed.push('daysBack'); next.daysBack = data.daysBack; }
    if (data.daysAhead !== undefined && data.daysAhead !== row.daysAhead) { changed.push('daysAhead'); next.daysAhead = data.daysAhead; }
    if (data.allowComments !== undefined && data.allowComments !== row.allowComments) { changed.push('allowComments'); next.allowComments = data.allowComments; }
    if (data.decides !== undefined && data.decides !== row.decides) { changed.push('decides'); next.decides = data.decides; }
    if (data.expiresInDays !== undefined) changed.push('expiresInDays');
    if (!changed.length) throw bad('Nothing was changed.');
    const rotates = changed.some(field => (ACCESS_FIELDS as readonly string[]).includes(field));

    if (rotates) {
      if (row.revokedAt) throw new OperationError('conflict', 'This link was revoked and stays revoked. Create a new link to share again.');
      if (data.confirmation !== updateLinkConfirmation(row.id)) throw bad(`Changing access replaces the link address. Confirm with: ${updateLinkConfirmation(row.id)}`);
      const needed = KIND_PUBLISHING_FEATURES[next.kind];
      if (needed.some(feature => !auth.publishing.includes(feature))) throw new OperationError('forbidden', 'You need Publishing access to share posts.');
      // A new secret is a new bearer capability: a link that decides (before or after this edit) is only re-issued by someone who may approve now.
      const deciding = row.decides || next.decides;
      if (deciding && !auth.canApprove) throw new OperationError('forbidden', 'You need approval permission to change a link that lets clients decide.');
      await lockActor(tx, actor, 'sharing', needed, deciding ? ['publishing/approvals'] : []);
      if (next.decides && next.kind === 'calendar') throw bad('Calendar links cannot approve posts.');
      if (changed.includes('targetIds')) {
        if (auth.scope !== null && next.targetIds.some(id => !auth.scope!.includes(id))) throw new OperationError('forbidden', 'You can only share channels you have access to.');
        const owned = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM targets WHERE "workspaceId" = ${actor.workspaceId} AND enabled = true AND id = ANY(${next.targetIds}::text[])`;
        if (owned.length !== next.targetIds.length) throw bad('Choose channels that are enabled in this workspace.');
      }
    }

    const days = data.expiresInDays;
    const expiresAt = days !== undefined ? new Date(Date.now() + days * 86_400_000) : row.expiresAt;
    const tokenHash = rotates ? hashToken(token) : row.tokenHash;
    const updated = rotates
      ? await tx.$executeRaw`UPDATE share_links SET kind = ${next.kind}, title = ${next.title}, description = ${next.description}, "targetIds" = ${JSON.stringify(next.targetIds)}::jsonb, "daysBack" = ${next.daysBack}, "daysAhead" = ${next.daysAhead}, "allowComments" = ${next.allowComments}, decides = ${next.decides}, "expiresAt" = ${expiresAt}, "tokenHash" = ${tokenHash} WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId} AND "revokedAt" IS NULL`
      : await tx.$executeRaw`UPDATE share_links SET title = ${next.title}, description = ${next.description} WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId}`;
    if (updated !== 1) throw new OperationError('unavailable', 'The link could not be updated.');
    await audit(tx, actor, 'sharing.link_updated', { linkId: row.id, changed, rotated: rotates, ...(days !== undefined ? { renewedForDays: days } : {}) });
    const version = linkVersion({ ...next, expiresAt, revokedAt: row.revokedAt }, tokenHash);
    // The new secret path exists only in this response, exactly once; it is never stored or audited in plain text.
    return { id: row.id, changed, rotated: rotates, version, ...(rotates ? { path: sharePath(token) } : {}), ...(days !== undefined ? { expiresInDays: days } : {}) };
  }));
}

export async function revokeShareLink(actor: SharingActor, input: unknown) {
  const parsed = LINK_ACTION_SCHEMA.safeParse(input); if (!parsed.success) throw bad(); exact(parsed.data.confirmation, revokeLinkConfirmation(parsed.data.id));
  const auth = await authorizeSharing(actor, 'sharing', 'write'); const limits = await sharingLimits();
  return protect(transact(actor.workspaceId, limits, async tx => {
    await lockActor(tx, actor, 'sharing'); const row = await lockLink(tx, auth, parsed.data.id);
    if (!row.revokedAt) await tx.$executeRaw`UPDATE share_links SET "revokedAt" = NOW() WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId} AND "revokedAt" IS NULL`;
    await audit(tx, actor, 'sharing.link_revoked', { linkId: row.id });
    return { id: row.id, status: 'revoked' as const };
  }));
}

/** Replace the secret: the old address stops working in the same transaction; the new one is shown once. */
export async function rotateShareLink(actor: SharingActor, input: unknown) {
  const parsed = LINK_ACTION_SCHEMA.safeParse(input); if (!parsed.success) throw bad(); exact(parsed.data.confirmation, rotateLinkConfirmation(parsed.data.id));
  const auth = await authorizeSharing(actor, 'sharing', 'write'); const limits = await sharingLimits(); const token = newToken();
  return protect(transact(actor.workspaceId, limits, async tx => {
    await lockActor(tx, actor, 'sharing'); const row = await lockLink(tx, auth, parsed.data.id);
    // The new secret serves this link's Publishing data (and its decision right), so the caller needs those rights now, not just Sharing write.
    const needed = KIND_PUBLISHING_FEATURES[row.kind];
    if (!needed) throw new OperationError('unavailable', 'The link could not be rotated.');
    if (needed.some(feature => !auth.publishing.includes(feature))) throw new OperationError('forbidden', 'You need Publishing access to share posts.');
    if (row.decides && !auth.canApprove) throw new OperationError('forbidden', 'You need approval permission to change a link that lets clients decide.');
    await lockActor(tx, actor, 'sharing', needed, row.decides ? ['publishing/approvals'] : []);
    // A migrated legacy link has no expiry and is never served. Rotating it is the one renewal path: it gets the Root default lifetime with its new secret.
    const legacyWithoutExpiry = !row.revokedAt && row.expiresAt === null;
    if (linkStatus(row) !== 'active' && !legacyWithoutExpiry) throw new OperationError('conflict', 'Only an active link can be rotated. Create a new link instead.');
    const days = limits.defaultExpiryDays!;
    const changed = legacyWithoutExpiry
      ? await tx.$executeRaw`UPDATE share_links SET "tokenHash" = ${hashToken(token)}, "expiresAt" = NOW() + (${days} * INTERVAL '1 day') WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId} AND "expiresAt" IS NULL AND "revokedAt" IS NULL`
      : await tx.$executeRaw`UPDATE share_links SET "tokenHash" = ${hashToken(token)} WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId}`;
    if (changed !== 1) throw new OperationError('unavailable', 'The link could not be rotated.');
    await audit(tx, actor, 'sharing.link_rotated', { linkId: row.id, ...(legacyWithoutExpiry ? { renewedForDays: days } : {}) });
    return { id: row.id, path: sharePath(token), ...(legacyWithoutExpiry ? { expiresInDays: days } : {}) };
  }));
}

/** Delete the link and the feedback recorded through it. Posts are untouched. */
export async function deleteShareLink(actor: SharingActor, input: unknown) {
  const parsed = LINK_ACTION_SCHEMA.safeParse(input); if (!parsed.success) throw bad(); exact(parsed.data.confirmation, deleteLinkConfirmation(parsed.data.id));
  const auth = await authorizeSharing(actor, 'sharing', 'write'); const limits = await sharingLimits();
  return protect(transact(actor.workspaceId, limits, async tx => {
    await lockActor(tx, actor, 'sharing'); const row = await lockLink(tx, auth, parsed.data.id);
    const removed = await tx.$executeRaw`DELETE FROM review_decisions WHERE "shareLinkId" = ${row.id}`;
    await tx.$executeRaw`DELETE FROM share_links WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId}`;
    await audit(tx, actor, 'sharing.link_deleted', { linkId: row.id, feedbackRemoved: Number(removed) });
    return { id: row.id, deleted: true as const, feedbackRemoved: Number(removed) };
  }));
}
