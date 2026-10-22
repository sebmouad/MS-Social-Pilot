import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if (c === '\n' && !quoted) { row.push(value.endsWith('\r') ? value.slice(0, -1) : value); rows.push(row); row = []; value = ''; }
    else value += c;
  }
  check(!quoted && row.length === 0 && value === '', 'CSV must terminate complete quoted rows.');
  return rows;
}

async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL; const rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin && process.env.NODE_ENV !== 'production' && process.env.DATABASE_URL === rawDatabase, 'Explicit matching preview database/origin required.');
  const database = new URL(rawDatabase); const origin = new URL(rawOrigin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only an isolated loopback _preview database is permitted.');
  check(origin.origin === rawOrigin && rawOrigin === 'http://localhost:3200', 'Only the explicit localhost:3200 preview is permitted.');
  const client = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const prefix = `preview_post_export_${randomUUID().replaceAll('-', '')}`;
  const workspaceId = 'preview_workspace'; const userId = `${prefix}_user`; const membershipId = `${prefix}_member`;
  const keyId = `${prefix}_key`; const sessionId = `${prefix}_session`; const foreignWorkspaceId = `${prefix}_foreign`;
  const ids = ['north', 'comment', 'own_draft', 'lookalike', 'mixed', 'studio', 'unselected', 'other_draft', 'foreign'].map(name => `${prefix}_${name}`);
  const [northId, commentId, ownDraftId, lookalikeId, mixedId, studioId, unselectedId, otherDraftId, foreignId] = ids;
  const needle = `${prefix} 100%_\\`; const now = new Date(); const expiresAt = new Date(Date.now() + 600_000);
  const token = randomBytes(32).toString('base64url'); const bearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const cookie = `msp_session=${token}; sp_workspace=${workspaceId}`;
  type Snapshot = { value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date } | null;
  const snapshots = new Map<string, Snapshot>(); const changed = new Set<string>();
  const restore = async (key: string) => {
    check(snapshots.has(key), 'Settings must be snapshotted before restoration.');
    const old = snapshots.get(key);
    if (old) await client.appSetting.upsert({ where: { key }, create: { key, value: old.value as Prisma.InputJsonValue, encrypted: old.encrypted, updatedAt: old.updatedAt }, update: { value: old.value as Prisma.InputJsonValue, encrypted: old.encrypted, updatedAt: old.updatedAt } });
    else await client.appSetting.deleteMany({ where: { key } });
  };
  const setting = async (key: string, value: Prisma.InputJsonValue) => {
    check(snapshots.has(key), 'Settings must be snapshotted before change.'); changed.add(key);
    await client.appSetting.upsert({ where: { key }, create: { key, value, encrypted: false, updatedAt: new Date() }, update: { value, encrypted: false, updatedAt: new Date() } });
  };
  const get = (path: string) => fetch(new URL(path, origin), { headers: { cookie }, redirect: 'manual' });
  const rpc = async (name: string, args: object = {}) => {
    const response = await fetch(new URL('/api/mcp?scope=workspace', origin), { method: 'POST', headers: { authorization: `Bearer ${bearer}`, origin: origin.origin, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }) });
    return { response, body: await response.json() };
  };
  const query = (extra: Record<string, string> = {}) => new URLSearchParams({ q: needle, ...extra });
  try {
    check(await client.user.count({ where: { id: 'preview_qa_user', isInstanceOwner: true, disabledAt: null } }) === 1, 'Seeded preview owner required.');
    check(await client.target.count({ where: { workspaceId, id: { in: ['preview_target_north', 'preview_target_studio', 'preview_target_unselected'] } } }) === 3, 'Seeded preview destinations required.');
    for (const key of ['mcp.authenticatedRoles', 'publishing.postPageSize', 'publishing.exportMaxPosts', 'publishing.exportMaxBytes', 'publishing.exportBatchSize']) snapshots.set(key, await client.appSetting.findUnique({ where: { key }, select: { value: true, encrypted: true, updatedAt: true } }));
    const roles = CONFIG_BY_KEY.get('mcp.authenticatedRoles')!.schema.parse(snapshots.get('mcp.authenticatedRoles')?.value ?? CONFIG_BY_KEY.get('mcp.authenticatedRoles')!.defaultValue) as string[];
    await client.user.create({ data: { id: userId, email: `${prefix}@example.test`, name: 'Disposable scoped export reader', passwordHash: 'unusable-test-password' } });
    await client.membership.create({ data: { id: membershipId, workspaceId, userId, role: 'editor' } });
    await client.$executeRaw`UPDATE memberships SET "allPages" = false WHERE id = ${membershipId}`;
    await client.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${membershipId}, 'preview_target_north')`;
    await client.session.create({ data: { id: sessionId, userId, tokenHash: hashSessionToken(token)!, pending: null, expiresAt } });
    await client.mcpApiKey.create({ data: { id: keyId, workspaceId, createdById: userId, name: 'Temporary post export read probe', tokenHash: createHash('sha256').update(bearer).digest('hex'), tokenPrefix: bearer.slice(0, 12), readFeatures: ['publishing/posts'], writeFeatures: [], expiresAt } });
    if (!roles.includes('editor')) { check((await rpc('export_posts')).response.status === 401, 'Original MCP policy must deny editor authentication.'); await setting('mcp.authenticatedRoles', [...roles, 'editor']); }
    await setting('publishing.exportBatchSize', 1);
    await setting('publishing.postPageSize', 1);
    await client.workspace.create({ data: { id: foreignWorkspaceId, name: 'Disposable export foreign workspace', slug: foreignWorkspaceId, timezone: 'UTC' } });
    const create = async (id: string, message: string, targetIds: string[], options: { firstComment?: string; status?: 'draft' | 'published'; workspace?: string; author?: string; media?: Prisma.InputJsonValue } = {}) => client.post.create({ data: {
      id, workspaceId: options.workspace ?? workspaceId, authorId: options.author ?? userId, message, firstComment: options.firstComment ?? null, media: options.media ?? [], status: options.status ?? 'draft', createdAt: now, updatedAt: now,
      publishedAt: options.status === 'published' ? now : null,
      targets: { create: targetIds.map((targetId, i) => ({ id: `${id}_target_${i}`, targetId, status: options.status === 'published' ? 'published' : 'pending', remotePostId: options.status === 'published' ? `${id}_synthetic_remote` : null, firstCommentError: 'private-provider-token-must-not-export' })) },
    } });
    await create(northId!, ` =SUM(1,1) ${needle}\n${'é😊'.repeat(350)}`, ['preview_target_north'], { status: 'published', firstComment: ' @SUM(1,1) synthetic first comment' });
    await create(commentId!, 'First-comment-only search example', ['preview_target_north'], { firstComment: needle, media: [{ kind: 'image', url: 'https://example.test/one.jpg' }, { kind: 'image', url: 'https://example.test/two.jpg' }] });
    await create(ownDraftId!, needle, []);
    await create(lookalikeId!, `${prefix} 100ab\\`, ['preview_target_north']);
    await create(mixedId!, needle, ['preview_target_north', 'preview_target_studio']);
    await create(studioId!, needle, ['preview_target_studio']);
    await create(unselectedId!, needle, ['preview_target_unselected']);
    await create(otherDraftId!, needle, [], { author: 'preview_qa_user' });
    await create(foreignId!, needle, [], { workspace: foreignWorkspaceId });

    const listingResponse = await get(`/api/publishing/posts?${query()}`); const listing = await listingResponse.json();
    check(listingResponse.ok && listingResponse.headers.get('cache-control') === 'no-store' && listing.total === 3 && listing.pages === 3 && listing.posts.length === 1,
      'Literal search counts must precede pagination and use the configured page size.');
    const pageIds = [...listing.posts.map((post: { id: string }) => post.id)];
    for (const page of [2, 3]) {
      const result = await get(`/api/publishing/posts?${query({ page: String(page) })}`); const body = await result.json();
      check(result.ok && body.total === 3 && body.page === page && body.posts.length === 1, 'All matching result pages must preserve the scoped literal query.');
      pageIds.push(...body.posts.map((post: { id: string }) => post.id));
    }
    check(new Set(pageIds).size === 3 && [northId, commentId, ownDraftId].every(id => pageIds.includes(id)), 'Search must exclude hidden, mixed, foreign, unselected and wildcard-lookalike posts on every page.');
    const http = await get(`/api/publishing/posts/export?${query({ channel: 'preview_target_north' })}`); const csv = await http.text();
    check(http.ok && http.headers.get('content-type')?.startsWith('text/csv') && http.headers.get('cache-control') === 'no-store'
      && http.headers.get('x-msp-post-count') === '2' && Number(http.headers.get('x-msp-export-bytes')) === Buffer.byteLength(csv), 'HTTP must export exactly the two scoped North matches and actual UTF-8 bytes.');
    const rows = parseCsv(csv); check(rows.length === 3 && rows[0]?.length === 11 && rows.every(row => row.length === rows[0]!.length), 'CSV must have a complete schema and two complete quoted rows.');
    const north = rows.find(row => row[0] === northId)!; const comment = rows.find(row => row[0] === commentId)!;
    check(north?.[2]?.startsWith("' =SUM") && north[2].includes('\n') && north[2].includes('é😊') && north[3]?.startsWith("' @SUM"), 'Spreadsheet formula prefixes must be escaped while Unicode/newlines survive.');
    check(JSON.parse(comment[5]!).length === 2 && comment[3] === needle && !csv.includes('private-provider-token-must-not-export'), 'All media and first comments must export without raw provider error text.');
    const mcp = await rpc('export_posts', { q: needle, channelId: 'preview_target_north' });
    check(mcp.response.ok && !mcp.body.result?.isError && mcp.body.result?.structuredContent?.csv === csv && mcp.body.result.structuredContent.postCount === 2, 'Read-only MCP export must return exactly the same scoped CSV.');
    const mcpSearch = await rpc('list_posts', { q: needle });
    check(!mcpSearch.body.result?.isError && mcpSearch.body.result.structuredContent.items.length === 3, 'MCP list must share the literal text/first-comment search.');
    const published = await get(`/api/publishing/posts/export?${query({ status: 'published' })}`);
    check(published.ok && published.headers.get('x-msp-post-count') === '1', 'Status must constrain the exported set.');
    for (const suffix of ['&workspaceId=forged', '&q=duplicate']) check((await get(`/api/publishing/posts/export?${query()}${suffix}`)).status === 400, 'Unknown/repeated export fields must be denied.');

    await setting('publishing.exportMaxPosts', 1);
    const rowRefusal = await get(`/api/publishing/posts/export?${query({ channel: 'preview_target_north' })}`);
    check(rowRefusal.status === 400 && rowRefusal.headers.get('content-type')?.startsWith('application/json') && (await rowRefusal.json()).code === 'invalid_request', 'Row limit must refuse the full export without sending partial CSV.');
    await restore('publishing.exportMaxPosts');
    await setting('publishing.exportMaxBytes', 1024);
    const byteRefusal = await get(`/api/publishing/posts/export?${query({ status: 'published' })}`);
    check(byteRefusal.status === 400 && (await byteRefusal.json()).code === 'invalid_request', 'Byte limit must refuse oversized UTF-8 CSV.');
    await restore('publishing.exportMaxBytes');
    await client.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
    const revoked = await rpc('export_posts', { q: needle, channelId: 'preview_target_north' });
    check(!revoked.body.result?.isError && revoked.body.result.structuredContent.postCount === 0 && revoked.body.result.structuredContent.channelUnavailable === true, 'Current grant revocation must immediately exclude North even for the same read key.');
    console.log(JSON.stringify({ literalSearchAndFirstComments: true, wholePostScope: true, httpAndMcpSameCsv: true, readKeyExport: true, spreadsheetProtection: true,
      unicodeAndMultimedia: true, searchAcrossPages: true, exportIgnoresPageSize: true, multiBatchSnapshot: true, rowAndByteRefusal: true, statusFilter: true, currentRevocation: true, providerDispatch: false }));
  } finally {
    try {
      let failed = false;
      try { await client.$transaction(async tx => {
        await tx.postTarget.deleteMany({ where: { postId: { in: ids } } }); await tx.post.deleteMany({ where: { id: { in: ids } } });
        await tx.mcpApiKey.deleteMany({ where: { id: keyId } }); await tx.session.deleteMany({ where: { id: sessionId } });
        await tx.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
        await tx.membership.deleteMany({ where: { id: membershipId } }); await tx.workspace.deleteMany({ where: { id: foreignWorkspaceId } }); await tx.user.deleteMany({ where: { id: userId } });
      }); } catch { failed = true; }
      for (const key of changed) { try { await restore(key); } catch { failed = true; } }
      for (const [key, old] of snapshots) check(JSON.stringify(await client.appSetting.findUnique({ where: { key }, select: { value: true, encrypted: true, updatedAt: true } })) === JSON.stringify(old), 'Original local settings must be restored exactly.');
      check(!failed && await client.post.count({ where: { id: { in: ids } } }) === 0 && await client.user.count({ where: { id: userId } }) === 0
        && await client.session.count({ where: { id: sessionId } }) === 0 && await client.mcpApiKey.count({ where: { id: keyId } }) === 0
        && await client.membership.count({ where: { id: membershipId } }) === 0 && await client.workspace.count({ where: { id: foreignWorkspaceId } }) === 0, 'All disposable export fixtures and credentials must be removed.');
      console.log(JSON.stringify({ fixturesCleaned: true, settingsRestoredExactly: true }));
    } finally { await client.$disconnect(); }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Local Posts search/export probe failed; inspect isolated preview logs without exposing credentials.'); process.exitCode = 1; });
