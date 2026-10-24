import { randomUUID } from 'node:crypto';
import { sharingError } from './messages';
import { prisma } from '@/server/data';
import { visitorAllowed } from './rate';
import { BIO_DELETE_SCHEMA, BIO_SAVE_SCHEMA, SLUG_SCHEMA, deleteBioConfirmation, safeUrl, saveBioConfirmation, type SharingActor, type SharingReadOptions } from '../contracts';
import { audit, authorizeSharing, bad, exact, lockActor, pageSize, protect, transact } from './access';
import { sharingLimits } from './limits';

type PageRow = { id: string; slug: string; title: string; description: string | null; avatarUrl: string | null; enabled: boolean };
type LinkRow = { id: string; label: string; url: string; position: number; clicks: number };
const MAX_CLICKS = 2_147_483_647;

/** Owner view: the page plus per-link click totals. */
export async function readBioPage(actor: SharingActor, options: SharingReadOptions = {}) {
  await authorizeSharing(actor, 'bio', 'read');
  const limits = await sharingLimits(); const maxLinks = pageSize(limits.bio_maxLinks!, options.maxItems);
  const pages = await protect(prisma.$queryRaw<PageRow[]>`SELECT id, slug, title, description, "avatarUrl", enabled FROM bio_pages WHERE "workspaceId" = ${actor.workspaceId} LIMIT 1`);
  const page = pages[0]; if (!page) return { page: null, links: [] as LinkRow[], limits: { maxLinks: limits.bio_maxLinks! }, truncated: false };
  const links = await protect(prisma.$queryRaw<LinkRow[]>`SELECT id, label, url, position, clicks FROM bio_links WHERE "pageId" = ${page.id} ORDER BY position ASC, id ASC LIMIT ${maxLinks + 1}`);
  return { page, links: links.slice(0, maxLinks), limits: { maxLinks: limits.bio_maxLinks! }, truncated: links.length > maxLinks };
}

export async function saveBioPage(actor: SharingActor, input: unknown) {
  const parsed = BIO_SAVE_SCHEMA.safeParse(input); if (!parsed.success) throw await bad();
  const data = parsed.data; await exact(data.confirmation, saveBioConfirmation(data.slug));
  await authorizeSharing(actor, 'bio', 'write'); const limits = await sharingLimits();
  if (data.title.length > limits.bio_titleMaxCharacters! || (data.description?.length ?? 0) > limits.bio_descriptionMaxCharacters! || data.links.length > limits.bio_maxLinks!) throw await bad();
  const avatar = data.avatarUrl ? safeUrl(data.avatarUrl, limits.bio_urlMaxCharacters!, true) : null;
  if (data.avatarUrl && !avatar) throw await bad('Use a secure (https) picture address.');
  const links: Array<{ label: string; url: string }> = [];
  for (const link of data.links) {
    const url = safeUrl(link.url, limits.bio_urlMaxCharacters!);
    if (!url || link.label.length > limits.bio_linkLabelMaxCharacters!) throw await bad('Each link needs a short label and a valid web address.');
    links.push({ label: link.label, url });
  }
  return protect(transact(actor.workspaceId, limits, async tx => {
    await lockActor(tx, actor, 'bio');
    const taken = await tx.$queryRaw<Array<{ workspaceId: string }>>`SELECT "workspaceId" FROM bio_pages WHERE slug = ${data.slug} AND "workspaceId" <> ${actor.workspaceId} LIMIT 1`;
    if (taken[0]) throw await sharingError('conflict', 'That address is taken. Choose another.');
    const pageId = `bio_${randomUUID()}`;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`INSERT INTO bio_pages (id, "workspaceId", slug, title, description, "avatarUrl", enabled, "createdAt", "updatedAt") VALUES (${pageId}, ${actor.workspaceId}, ${data.slug}, ${data.title}, ${data.description ?? null}, ${avatar}, ${data.enabled}, NOW(), NOW()) ON CONFLICT ("workspaceId") DO UPDATE SET slug = EXCLUDED.slug, title = EXCLUDED.title, description = EXCLUDED.description, "avatarUrl" = EXCLUDED."avatarUrl", enabled = EXCLUDED.enabled, "updatedAt" = NOW() RETURNING id`;
    const id = rows[0]?.id; if (!id) throw await sharingError('unavailable', 'The bio page could not be saved.');
    // A link keeps its id (so printed redirect addresses survive an edit) and click total when its label and address are unchanged.
    // Duplicate label+address pairs are matched one-to-one in order.
    const before = await tx.$queryRaw<Array<{ id?: string; label: string; url: string; clicks: number }>>`SELECT id, label, url, clicks FROM bio_links WHERE "pageId" = ${id} ORDER BY position ASC, id ASC FOR UPDATE`;
    const kept = new Map<string, Array<{ id?: string; clicks: number }>>();
    for (const b of before) kept.set(`${b.label}\n${b.url}`, [...(kept.get(`${b.label}\n${b.url}`) ?? []), { id: b.id, clicks: b.clicks }]);
    await tx.$executeRaw`DELETE FROM bio_links WHERE "pageId" = ${id}`;
    for (const [position, link] of links.entries()) {
      const previous = kept.get(`${link.label}\n${link.url}`)?.shift();
      await tx.$executeRaw`INSERT INTO bio_links (id, "pageId", label, url, position, clicks) VALUES (${previous?.id ?? `bl_${randomUUID()}`}, ${id}, ${link.label}, ${link.url}, ${position}, ${previous?.clicks ?? 0})`;
    }
    await audit(tx, actor, 'sharing.bio_saved', { pageId: id, slug: data.slug, enabled: data.enabled, linkCount: links.length });
    return { id, slug: data.slug, path: `/bio/${data.slug}`, enabled: data.enabled, linkCount: links.length };
  }), 'That address is taken. Choose another.');
}

export async function deleteBioPage(actor: SharingActor, input: unknown) {
  const parsed = BIO_DELETE_SCHEMA.safeParse(input); if (!parsed.success) throw await bad();
  await authorizeSharing(actor, 'bio', 'write'); const limits = await sharingLimits();
  return protect(transact(actor.workspaceId, limits, async tx => {
    await lockActor(tx, actor, 'bio');
    const rows = await tx.$queryRaw<Array<{ id: string; slug: string }>>`SELECT id, slug FROM bio_pages WHERE "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    const page = rows[0]; if (!page) throw await sharingError('not_found', 'This workspace has no bio page.');
    await exact(parsed.data.confirmation, deleteBioConfirmation(page.slug));
    await tx.$executeRaw`DELETE FROM bio_links WHERE "pageId" = ${page.id}`;
    await tx.$executeRaw`DELETE FROM bio_pages WHERE id = ${page.id} AND "workspaceId" = ${actor.workspaceId}`;
    await audit(tx, actor, 'sharing.bio_deleted', { pageId: page.id, slug: page.slug });
    return { id: page.id, deleted: true as const };
  }));
}

export type PublicBio = { title: string; description: string | null; avatarUrl: string | null; links: Array<{ id: string; label: string }> };
export type BioAccess<T> = { ok: true; value: T } | { ok: false; reason: 'not_found' | 'rate_limited' };

/**
 * A public bio page has no creator, so it stays served only while some active workspace owner still holds the
 * Bio page entitlement and permission (the same "any active owner" rule as automatic sync). Only refusals are cached
 * for the Root-managed interval. Successful authority is always rebuilt so revocation cannot retain a stale grant.
 */
const availability = new Map<string, { until: number }>();
export function resetBioAvailability() { availability.clear(); }
export async function workspaceOffersBio(workspaceId: string, policy: { ttlMs: number; owners: number; capacity: number }, now = Date.now()): Promise<boolean> {
  const { ttlMs } = policy;
  const cached = availability.get(workspaceId);
  if (ttlMs > 0 && cached && cached.until > now) return false;
  let ok = false;
  try {
    const owners = await prisma.$queryRaw<Array<{ userId: string }>>`SELECT m."userId" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${workspaceId} AND m.role::text = 'owner' AND u."disabledAt" IS NULL ORDER BY m."userId" ASC LIMIT ${policy.owners}`;
    for (const owner of owners) {
      try { await authorizeSharing({ userId: owner.userId, workspaceId }, 'bio', 'read'); ok = true; break; } catch { /* try the next owner */ }
    }
  } catch { return false; }
  if (ok) availability.delete(workspaceId);
  else if (ttlMs > 0) { if (availability.size >= policy.capacity) availability.clear(); availability.set(workspaceId, { until: now + ttlMs }); }
  return ok;
}

/** Public page: label-only links (addresses are reached through the counted redirect). */
export async function openPublicBio(slug: string, address: string | null, bucket: 'view' | 'render' = 'view'): Promise<BioAccess<PublicBio>> {
  const checked = SLUG_SCHEMA.safeParse(slug); if (!checked.success) return { ok: false, reason: 'not_found' };
  const limits = await sharingLimits();
  const allowed = () => visitorAllowed(`bio:${bucket}`, address, checked.data, limits.viewRateLimit!, limits.viewRateWindowMs!, limits.anonymousVisitorFactor!, limits.rateStoreCapacity!);
  // A known address is counted before the lookup. An unknown one is counted per page only after the page exists, so guessed slugs create no windows.
  if (address && !allowed()) return { ok: false, reason: 'rate_limited' };
  const pages = await prisma.$queryRaw<Array<{ id: string; workspaceId: string; title: string; description: string | null; avatarUrl: string | null }>>`SELECT b.id, b."workspaceId", b.title, b.description, b."avatarUrl" FROM bio_pages b JOIN workspaces w ON w.id = b."workspaceId" WHERE b.slug = ${checked.data} AND b.enabled = true AND w."suspendedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = w.id AND p.status <> 'completed') LIMIT 1`;
  const page = pages[0]; if (!page || !(await workspaceOffersBio(page.workspaceId, { ttlMs: limits.bio_availabilityCacheMs!, owners: limits.bio_ownerScanLimit!, capacity: limits.bio_availabilityCacheEntries! }))) return { ok: false, reason: 'not_found' };
  if (!address && !allowed()) return { ok: false, reason: 'rate_limited' };
  const links = await prisma.$queryRaw<Array<{ id: string; label: string }>>`SELECT id, label FROM bio_links WHERE "pageId" = ${page.id} ORDER BY position ASC, id ASC LIMIT ${limits.bio_maxLinks!}`;
  return { ok: true, value: { title: page.title, description: page.description, avatarUrl: page.avatarUrl ? safeUrl(page.avatarUrl, limits.bio_urlMaxCharacters!, true) : null, links } };
}

/**
 * Follow a bio link. The visitor is always sent on if the link is live; the counter only moves while
 * the per-address, per-page window allows it. No address, agent or referrer is stored: the
 * only record is a capped integer.
 */
export async function followBioLink(slug: string, linkId: string, address: string | null): Promise<string | null> {
  const checked = SLUG_SCHEMA.safeParse(slug);
  if (!checked.success || !/^[A-Za-z0-9_-]{1,80}$/.test(linkId)) return null;
  const limits = await sharingLimits();
  const owner = await prisma.$queryRaw<Array<{ workspaceId: string }>>`SELECT b."workspaceId" FROM bio_pages b JOIN workspaces w ON w.id = b."workspaceId" WHERE b.slug = ${checked.data} AND b.enabled = true AND w."suspendedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = w.id AND p.status <> 'completed') LIMIT 1`;
  if (!owner[0] || !(await workspaceOffersBio(owner[0].workspaceId, { ttlMs: limits.bio_availabilityCacheMs!, owners: limits.bio_ownerScanLimit!, capacity: limits.bio_availabilityCacheEntries! }))) return null;
  const count = visitorAllowed(`bio:click:${checked.data}`, address, checked.data, limits.bio_clickRateLimit!, limits.bio_clickRateWindowMs!, limits.anonymousVisitorFactor!, limits.rateStoreCapacity!);
  const rows = count
    ? await prisma.$queryRaw<Array<{ url: string }>>`UPDATE bio_links l SET clicks = LEAST(l.clicks + 1, ${MAX_CLICKS}) FROM bio_pages b, workspaces w WHERE l.id = ${linkId} AND l."pageId" = b.id AND b.slug = ${checked.data} AND b.enabled = true AND w.id = b."workspaceId" AND w."suspendedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = w.id AND p.status <> 'completed') RETURNING l.url`
    : await prisma.$queryRaw<Array<{ url: string }>>`SELECT l.url FROM bio_links l JOIN bio_pages b ON b.id = l."pageId" JOIN workspaces w ON w.id = b."workspaceId" WHERE l.id = ${linkId} AND b.slug = ${checked.data} AND b.enabled = true AND w."suspendedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = w.id AND p.status <> 'completed') LIMIT 1`;
  const url = rows[0]?.url; return url ? safeUrl(url, limits.bio_urlMaxCharacters!) : null;
}
