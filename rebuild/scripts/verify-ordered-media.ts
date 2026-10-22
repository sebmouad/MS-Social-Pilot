import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }

/** Opt-in synthetic local HTTP/MCP probe; never publishes or contacts a provider. */
async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL; const rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin && process.env.NODE_ENV !== 'production' && process.env.DATABASE_URL === rawDatabase, 'Explicit matching preview database and origin required.');
  const database = new URL(rawDatabase); const origin = new URL(rawOrigin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only an isolated loopback _preview database is permitted.');
  check(origin.origin === rawOrigin && rawOrigin === 'http://localhost:3200', 'Only explicit localhost:3200 preview is permitted.');
  const client = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const prefix = `preview_ordered_media_${randomUUID().replaceAll('-', '')}`;
  const workspaceId = 'preview_workspace'; const userId = `${prefix}_user`; const membershipId = `${prefix}_member`;
  const foreignWorkspaceId = `${prefix}_foreign`; const foreignMembershipId = `${prefix}_foreign_member`;
  const sessionId = `${prefix}_session`; const keyIds = [`${prefix}_write`, `${prefix}_read`];
  const token = randomBytes(32).toString('base64url');
  const writeBearer = `mcp_${randomBytes(32).toString('base64url')}`; const readBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + 600_000);
  const cookie = (workspace = workspaceId) => `msp_session=${token}; sp_workspace=${workspace}`;
  type Snapshot = { value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date } | null;
  const snapshots = new Map<string, Snapshot>(); const changed = new Set<string>();
  const images: Array<{ id: string; workspaceId: string }> = [];
  let grantRemoved = false;
  const setting = async (key: string, value: Prisma.InputJsonValue) => {
    check(snapshots.has(key), 'Setting snapshot required before change.'); changed.add(key);
    await client.appSetting.upsert({ where: { key }, create: { key, value, encrypted: false, updatedAt: new Date() }, update: { value, encrypted: false, updatedAt: new Date() } });
  };
  const rpc = async (name: string, args: object = {}, bearer = writeBearer) => {
    const response = await fetch(new URL('/api/mcp?scope=workspace', origin), { method: 'POST', headers: { authorization: `Bearer ${bearer}`, origin: origin.origin, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }) });
    const body = await response.json() as { error?: unknown; result?: { isError?: boolean; structuredContent?: Record<string, unknown> } };
    return { ok: response.ok && !body.error && body.result?.isError !== true, data: body.result?.structuredContent, response };
  };
  const upload = async (workspace: string, fixture: string) => {
    const bytes = await readFile(new URL(`./fixtures/${fixture}`, import.meta.url));
    const body = new FormData(); body.append('imageFile', new File([bytes], `${prefix}.png`, { type: 'image/png' }));
    const response = await fetch(new URL('/api/media', origin), { method: 'POST', headers: { cookie: cookie(workspace), origin: origin.origin }, body });
    const result = await response.json() as { id?: string; reference?: string };
    check(response.ok && typeof result.id === 'string' && result.reference === `media:${result.id}`, 'Synthetic image upload must return a matching reference.');
    images.push({ id: result.id, workspaceId: workspace });
    return result.reference;
  };
  const row = () => client.post.findFirst({ where: { workspaceId, authorId: userId }, select: { id: true, media: true, link: true, firstComment: true, message: true, targets: { select: { targetId: true } } } });
  try {
    check(await client.user.count({ where: { id: 'preview_qa_user', isInstanceOwner: true, disabledAt: null } }) === 1, 'Seeded preview owner required.');
    const graphSetting = await client.appSetting.findUnique({ where: { key: 'meta.graphBaseUrl' } });
    check(graphSetting?.encrypted === false && graphSetting.value === 'https://provider-preview.invalid', 'Only the seeded unusable provider endpoint is permitted.');
    check(await client.target.count({ where: { workspaceId, id: { in: ['preview_target_north', 'preview_target_studio'] } } }) === 2, 'Seeded synthetic destinations required.');
    for (const key of ['mcp.authenticatedRoles', 'meta.appSecretProofEnabled', 'publishing.maxRemoteMediaPerPost']) snapshots.set(key, await client.appSetting.findUnique({ where: { key }, select: { value: true, encrypted: true, updatedAt: true } }));
    const roles = CONFIG_BY_KEY.get('mcp.authenticatedRoles')!.schema.parse(snapshots.get('mcp.authenticatedRoles')?.value ?? CONFIG_BY_KEY.get('mcp.authenticatedRoles')!.defaultValue) as string[];
    await client.user.create({ data: { id: userId, email: `${prefix}@example.test`, name: 'Disposable ordered-media editor', passwordHash: 'unusable-test-password' } });
    await client.membership.create({ data: { id: membershipId, workspaceId, userId, role: 'editor' } });
    await client.$executeRaw`UPDATE memberships SET "allPages" = false WHERE id = ${membershipId}`;
    await client.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${membershipId}, 'preview_target_north')`;
    await client.workspace.create({ data: { id: foreignWorkspaceId, name: 'Disposable media isolation workspace', slug: foreignWorkspaceId, timezone: 'UTC' } });
    await client.membership.create({ data: { id: foreignMembershipId, workspaceId: foreignWorkspaceId, userId, role: 'owner' } });
    await client.session.create({ data: { id: sessionId, userId, tokenHash: hashSessionToken(token)!, pending: null, expiresAt } });
    for (const [index, bearer] of [writeBearer, readBearer].entries()) await client.mcpApiKey.create({ data: { id: keyIds[index]!, workspaceId, createdById: userId, name: 'Temporary ordered-media probe', tokenHash: createHash('sha256').update(bearer).digest('hex'), tokenPrefix: bearer.slice(0, 12), readFeatures: ['publishing/posts', 'publishing/media', 'settings/connections'], writeFeatures: index === 0 ? ['publishing/posts', 'publishing/media'] : [], expiresAt } });
    if (!roles.includes('editor')) await setting('mcp.authenticatedRoles', [...roles, 'editor']);
    await setting('meta.appSecretProofEnabled', false);
    await setting('publishing.maxRemoteMediaPerPost', 2);
    const first = await upload(workspaceId, 'preview-market.png');
    const second = await upload(workspaceId, 'preview-studio.png');
    const foreign = await upload(foreignWorkspaceId, 'preview-market.png');
    const choices = await rpc('list_pages');
    const north = (choices.data?.items as Array<Record<string, unknown>> | undefined)?.find(item => item.id === 'preview_target_north');
    check(choices.ok && north?.canPublish === true && north.publishingMedia && north.localImageUpload, 'MCP must expose current safe media capabilities for the selected synthetic destination.');
    const media = [{ kind: 'image', url: first, altText: 'Example market image first' }, { kind: 'image', url: second, altText: 'Example studio image second' }];
    const base = { message: `${prefix} two-image draft`, firstComment: 'Example first comment survives media edits', targetIds: ['preview_target_north'] };
    const created = await rpc('create_post', { ...base, media, confirmation: 'CREATE POST' });
    check(created.ok && typeof created.data?.id === 'string', 'MCP ordered-media creation must return a draft receipt.');
    const postId = created.data.id;
    let saved = await row(); check(saved?.id === postId && isDeepStrictEqual(saved.media, media) && saved.firstComment === base.firstComment, 'Persisted draft must retain every ordered image and description plus first comment.');
    const reversed = [{ ...media[1]!, altText: 'Studio now first' }, { ...media[0]!, altText: 'Market now second' }];
    const updated = await rpc('update_post', { ...base, postId, media: reversed, confirmation: `UPDATE POST ${postId}` });
    check(updated.ok, 'MCP reorder must succeed.');
    saved = await row(); check(isDeepStrictEqual(saved?.media, reversed) && saved?.firstComment === base.firstComment, 'Reorder must preserve item/description association.');
    check((await rpc('update_post', { ...base, message: '', postId, media: reversed, confirmation: `UPDATE POST ${postId}` })).ok, 'An image-only edit must accept an empty caption.');
    saved = await row(); check(saved?.message === '' && isDeepStrictEqual(saved.media, reversed) && saved.firstComment === base.firstComment, 'Image-only edits must persist media, descriptions and first comment without filler text.');
    check((await rpc('update_post', { ...base, message: '', link: 'https://example.test/article', postId, media: [], confirmation: `UPDATE POST ${postId}` })).ok, 'A link-only edit must accept an empty caption.');
    saved = await row(); check(saved?.message === '' && saved.link === 'https://example.test/article' && isDeepStrictEqual(saved.media, []), 'Link-only edit must remove previous media and retain its link.');
    check(!(await rpc('update_post', { ...base, message: ' ', postId, media: [], confirmation: `UPDATE POST ${postId}` })).ok, 'First comment alone must not replace all post content.');
    saved = await row(); check(saved?.message === '' && saved.link === 'https://example.test/article', 'Refused empty edit must preserve the existing link-only post.');
    check(!(await rpc('create_post', { ...base, message: '', media: [], confirmation: 'CREATE POST' })).ok, 'Empty or first-comment-only creates must be refused.');
    const captionless = await rpc('create_post', { ...base, message: '', media: [{ kind: 'image', url: first }], confirmation: 'CREATE POST' });
    check(captionless.ok && typeof captionless.data?.id === 'string', 'Image-only creation must return a receipt.');
    const imageOnly = await client.post.findUnique({ where: { id: captionless.data.id }, select: { message: true, media: true } });
    check(imageOnly?.message === '' && isDeepStrictEqual(imageOnly.media, [{ kind: 'image', url: first }]), 'Image-only creation must persist the actual content.');
    check((await rpc('delete_post', { postId: captionless.data.id, deleteRemote: false, confirmation: `DELETE POST ${captionless.data.id} LOCAL` })).ok, 'Disposable image-only draft must be removed through the authorized service.');
    for (const content of [{ media: [], link: 'https://example.test/another-article' }, { media: [{ kind: 'video', url: 'https://example.test/video.mp4' }] }]) {
      const only = await rpc('create_post', { ...base, message: '', ...content, confirmation: 'CREATE POST' });
      check(only.ok && typeof only.data?.id === 'string', 'Captionless link/video creation must return a receipt.');
      const stored = await client.post.findUnique({ where: { id: only.data.id }, select: { message: true, media: true, link: true } });
      check(stored?.message === '' && isDeepStrictEqual(stored.media, content.media) && stored.link === ('link' in content ? content.link : null), 'Captionless link/video content must persist exactly.');
      check((await rpc('delete_post', { postId: only.data.id, deleteRemote: false, confirmation: `DELETE POST ${only.data.id} LOCAL` })).ok, 'Disposable captionless draft must be removed through the authorized service.');
    }
    check((await rpc('update_post', { ...base, postId, media: reversed, confirmation: `UPDATE POST ${postId}` })).ok, 'Original ordered draft must be restored for scope checks.');
    for (const extra of [
      { media: [{ kind: 'image', url: foreign }] },
      { media: [{ kind: 'image', url: first, localFile: { bytes: [1, 2] } }] },
      { media: reversed, imageUrl: 'https://example.test/ambiguous.png' },
      { media: reversed, link: 'https://example.test/link' },
      { media: [{ kind: 'image', url: first }, { kind: 'video', url: 'https://example.test/video.mp4' }] },
      { media: reversed, targetIds: ['preview_target_studio'] },
    ]) {
      const denied = await rpc('create_post', { ...base, ...extra, confirmation: 'CREATE POST' });
      check(!denied.ok, 'Unsafe, unsupported, foreign or out-of-scope media must be denied.');
    }
    await setting('publishing.maxRemoteMediaPerPost', 1);
    check(!(await rpc('create_post', { ...base, media, confirmation: 'CREATE POST' })).ok, 'Current Root count ceiling must apply through MCP.');
    await setting('publishing.maxRemoteMediaPerPost', 2);
    check(!(await rpc('update_post', { ...base, postId, media: [], confirmation: `UPDATE POST ${postId}` }, readBearer)).ok, 'A read-only MCP key must not edit attachments.');
    await client.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`; grantRemoved = true;
    check(!(await rpc('update_post', { ...base, postId, media: [], confirmation: `UPDATE POST ${postId}` })).ok, 'Revoked destination access must prevent attachment changes.');
    saved = await row(); check(isDeepStrictEqual(saved?.media, reversed), 'Denied writes must preserve stored media.');
    check(await client.post.count({ where: { workspaceId, authorId: userId } }) === 1, 'Rejected creates must leave no extra posts.');
    console.log(JSON.stringify({ uploadIsolation: true, currentCapabilities: true, orderedCreateAndEdit: true, captionlessCreateAndEdit: true, linkOnlyEdit: true, emptyContentDenied: true, descriptionsAndFirstComment: true, foreignAndMalformedDenied: true, providerCombinationsDenied: true, rootCountApplied: true, scopedAndReadOnlyWritesDenied: true, providerWrites: false }));
  } finally {
    let cleanupFailed = false;
    try {
      if (grantRemoved) await client.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${membershipId}, 'preview_target_north') ON CONFLICT DO NOTHING`;
      await client.post.deleteMany({ where: { workspaceId, authorId: userId } });
      for (const image of images) {
        const response = await fetch(new URL(`/api/media/${encodeURIComponent(image.id)}`, origin), { method: 'DELETE', headers: { cookie: cookie(image.workspaceId), origin: origin.origin } });
        if (!response.ok) cleanupFailed = true;
        const absent = await fetch(new URL(`/api/media/${encodeURIComponent(image.id)}`, origin), { headers: { cookie: cookie(image.workspaceId) } });
        if (absent.status !== 404) cleanupFailed = true;
      }
      await client.$executeRaw`DELETE FROM root_activities WHERE "actorId" = ${userId} AND detail->>'workspaceId' IN (${workspaceId}, ${foreignWorkspaceId})`;
      await client.mcpApiKey.deleteMany({ where: { id: { in: keyIds }, createdById: userId } });
      await client.session.deleteMany({ where: { id: sessionId, userId } });
      await client.membership.deleteMany({ where: { id: { in: [membershipId, foreignMembershipId] }, userId } });
      await client.workspace.deleteMany({ where: { id: foreignWorkspaceId } });
      await client.user.deleteMany({ where: { id: userId } });
    } catch { cleanupFailed = true; }
    try {
      for (const key of changed) {
        const old = snapshots.get(key);
        if (old) await client.appSetting.upsert({ where: { key }, create: { key, value: old.value as Prisma.InputJsonValue, encrypted: old.encrypted, updatedAt: old.updatedAt }, update: { value: old.value as Prisma.InputJsonValue, encrypted: old.encrypted, updatedAt: old.updatedAt } });
        else await client.appSetting.deleteMany({ where: { key } });
        const restored = await client.appSetting.findUnique({ where: { key }, select: { value: true, encrypted: true, updatedAt: true } });
        check(JSON.stringify(restored) === JSON.stringify(old), 'Temporary setting must be restored exactly.');
      }
      check(!cleanupFailed && await client.user.count({ where: { id: userId } }) === 0
        && await client.post.count({ where: { workspaceId, authorId: userId } }) === 0
        && await client.workspace.count({ where: { id: foreignWorkspaceId } }) === 0, 'Disposable probe fixtures and media must be removed.');
      console.log(JSON.stringify({ fixturesAndImagesCleaned: true, settingsRestoredExactly: true, noSecretsPrinted: true }));
    } finally { await client.$disconnect(); }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Ordered-media preview probe failed; sensitive details withheld.'); process.exitCode = 1; });
