/** Synthetic volume rehearsal. No HTTP server, provider calls or production access.
 * Run from rebuild/: DATABASE_URL=..._rehearsal npx tsx scripts/volume-probe.ts
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

export function guardVolumeDatabase(value: string | undefined, environment = process.env.NODE_ENV): string {
  const reject = () => new Error('Volume probe requires a loopback PostgreSQL database ending in _rehearsal outside production.');
  if (!value || environment === 'production') throw reject();
  try {
    const url = new URL(value);
    // No connection-string overrides, alternate schemas, socket paths or driver
    // options: all can defeat the visible host/database check.
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !/^\/[A-Za-z0-9][A-Za-z0-9_]*_rehearsal$/.test(decodeURIComponent(url.pathname))
      || url.search || url.hash) throw reject();
    return value;
  } catch { throw reject(); }
}

type Captured = { query: string; params: string; duration: number };
const heavy = /\b(root_activities|posts|post_targets|post_comments|conversations|conversation_messages|page_reviews|page_insights|ad_insights)\b/;
const rollback = new Error('volume-probe-rollback');

async function main() {
  // Guard before importing application modules, constructing Prisma or connecting.
  const url = guardVolumeDatabase(process.env.DATABASE_URL);
  const scale = Number(process.env.VOLUME_PROBE_SCALE ?? '1');
  if (!Number.isFinite(scale) || scale < 0.01 || scale > 10) throw new Error('VOLUME_PROBE_SCALE must be between 0.01 and 10.');
  const { PrismaClient, Prisma } = await import('../generated/client');
  const db = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  let capture: Captured[] | null = null;
  db.$on('query', event => { if (capture && /^\s*SELECT\b/i.test(event.query) && heavy.test(event.query)) capture.push(event); });
  const global = globalThis as typeof globalThis & { rebuildPrisma?: InstanceType<typeof PrismaClient> };
  const previous = global.rebuildPrisma;
  const prefix = `volume_${randomUUID().replaceAll('-', '')}`;
  const count = (base: number) => Math.floor(base * scale);
  const volumes = { audit: count(1_000_000), posts: count(100_000), conversations: count(200_000), comments: count(200_000), reviews: count(20_000), insights: count(1_000_000), adInsights: count(100_000) };
  const report: unknown[] = [];
  let stage = 'connection preflight';
  try {
    await db.$transaction(async tx => {
      const [identity] = await tx.$queryRaw<Array<{ database: string; local: boolean }>>`
        SELECT current_database() AS database,
          (inet_server_addr() = '127.0.0.1'::inet OR inet_server_addr() = '::1'::inet) AS local`;
      if (!identity?.local || identity.database !== decodeURIComponent(new URL(url).pathname.slice(1))) throw new Error('Connected database identity or loopback address did not match.');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '120s'");
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      // All fixtures and statistics changes roll back together, even on failure.
      // The singleton is set before dynamic service imports so their real reads
      // execute in this same transaction, preserving current authorization.
      global.rebuildPrisma = tx as unknown as InstanceType<typeof PrismaClient>;
      stage = 'synthetic seeding';
      const userId = `${prefix}_root`, workspaceId = `${prefix}_w0`;
      await tx.user.create({ data: { id: userId, name: 'Volume rehearsal owner', email: `${prefix}@example.test`, passwordHash: 'unusable', isInstanceOwner: true } });
      for (let w = 0; w < 20; w++) {
        const id = `${prefix}_w${w}`;
        await tx.workspace.create({ data: { id, slug: id, name: `Synthetic volume workspace ${w}`, timezone: 'UTC' } });
        await tx.membership.create({ data: { id: `${id}_member`, userId, workspaceId: id, role: 'owner' } });
        await tx.socialAccount.create({ data: { id: `${id}_social`, workspaceId: id, provider: 'facebook', providerUserId: id, name: 'Synthetic connection', accessToken: 'synthetic-no-credential' } });
        await tx.adAccount.create({ data: { id: `${id}_ad`, workspaceId: id, socialAccountId: `${id}_social`, actId: id, name: 'Synthetic ad account', currency: 'USD', enabled: true } });
        for (let c = 0; c < 10; c++) await tx.target.create({ data: { id: `${id}_t${c}`, workspaceId: id, socialAccountId: `${id}_social`, providerId: `${id}_${c}`, name: `Synthetic channel ${c}`, type: 'page', enabled: true, canPublish: true, createdAt: new Date() } });
      }
      // Synthetic plan/policy only; modifications remain inside the rollback.
      await tx.$executeRaw`UPDATE users SET "planId" = NULL WHERE id = ${userId}`;
      const { CONFIG_REGISTRY } = await import('../src/lib/config/registry');
      for (const entry of CONFIG_REGISTRY) {
        if (entry.kind === 'secret') continue;
        const value = entry.key.startsWith('entitlements.') || entry.key === 'platforms.facebook.enabled' || entry.key === 'platforms.facebook.includedByDefault' ? true : entry.defaultValue;
        await tx.appSetting.upsert({ where: { key: entry.key }, create: { key: entry.key, value: value as import('../generated/client').Prisma.InputJsonValue, encrypted: false }, update: { value: value as import('../generated/client').Prisma.InputJsonValue, encrypted: false } });
      }
      await tx.$executeRaw`INSERT INTO root_activities (id,"actorId",action,detail,"createdAt")
        SELECT ${prefix} || '_a' || n, ${userId}, CASE WHEN n % 1000 = 0 THEN 'volume.needle' ELSE 'volume.read' END,
          jsonb_build_object('workspaceId', ${prefix} || '_w' || (n % 20)), NOW() - n * INTERVAL '1 second'
        FROM generate_series(1, ${volumes.audit}::int) n`;
      await tx.$executeRaw`INSERT INTO posts (id,"workspaceId","authorId",message,"firstComment",status,"createdAt","updatedAt","scheduledAt")
        SELECT ${prefix} || '_p' || n, ${prefix} || '_w' || (n % 20), ${userId},
          CASE WHEN n % 101 = 0 THEN 'Synthetic needle campaign' ELSE 'Synthetic campaign ' || n END,
          CASE WHEN n % 103 = 0 THEN 'Synthetic needle follow-up' ELSE NULL END,
          (CASE WHEN n % 5 = 0 THEN 'draft' WHEN n % 5 = 1 THEN 'scheduled' ELSE 'published' END)::"PostStatus",
          NOW() - n * INTERVAL '1 minute', NOW(), NOW() - n * INTERVAL '1 minute'
        FROM generate_series(1, ${volumes.posts}::int) n`;
      await tx.$executeRaw`INSERT INTO post_targets (id,"postId","targetId",status,"updatedAt")
        SELECT ${prefix} || '_pt' || n, ${prefix} || '_p' || n, ${prefix} || '_w' || (n % 20) || '_t' || ((n / 20) % 10), 'published'::"PostTargetStatus", NOW()
        FROM generate_series(1, ${volumes.posts}::int) n WHERE n % 7 <> 0`;
      await tx.$executeRaw`INSERT INTO conversations (id,"targetId","remoteId",snippet,"updatedTime","fetchedAt")
        SELECT ${prefix} || '_c' || n, ${prefix} || '_w' || (n % 20) || '_t' || ((n / 20) % 10), ${prefix} || n,
          CASE WHEN n % 101 = 0 THEN 'Synthetic needle message' ELSE 'Synthetic conversation' END, NOW() - n * INTERVAL '1 second', NOW()
        FROM generate_series(1, ${volumes.conversations}::int) n`;
      await tx.$executeRaw`INSERT INTO conversation_messages (id,"conversationId","remoteId",message,"fromName","createdTime")
        SELECT ${prefix} || '_m' || n, ${prefix} || '_c' || n, ${prefix} || n, 'Synthetic message', 'Example visitor', NOW() - n * INTERVAL '1 second'
        FROM generate_series(1, ${volumes.conversations}::int) n`;
      await tx.$executeRaw`INSERT INTO post_comments (id,"postTargetId","remoteId",message,"fromName","createdTime")
        SELECT ${prefix} || '_comment' || n, ${prefix} || '_pt' || (1 + ((n - 1) % ${volumes.posts}::int)), ${prefix} || n,
          'Synthetic comment', 'Example visitor', NOW() - n * INTERVAL '1 second'
        FROM generate_series(1, ${volumes.comments}::int) n WHERE (1 + ((n - 1) % ${volumes.posts}::int)) % 7 <> 0`;
      await tx.$executeRaw`INSERT INTO page_reviews (id,"targetId","remoteId","reviewerName","reviewText","createdTime","fetchedAt")
        SELECT ${prefix} || '_r' || n, ${prefix} || '_w' || (n % 20) || '_t' || ((n / 20) % 10), ${prefix} || n,
          'Example reviewer', 'Synthetic review', NOW() - n * INTERVAL '1 second', NOW()
        FROM generate_series(1, ${volumes.reviews}::int) n`;
      await tx.$executeRaw`INSERT INTO page_insights (id,"targetId",metric,period,"endTime",value,numeric,"fetchedAt")
        SELECT ${prefix} || '_i' || n, ${prefix} || '_w' || (n % 20) || '_t' || ((n / 20) % 10),
          CASE WHEN (n / 200) % 5 = 0 THEN 'page_fans' ELSE 'page_impressions' END, 'day',
          date_trunc('day', NOW()) - (n / 200) * INTERVAL '1 hour', to_jsonb(n % 1000), n % 1000, NOW()
        FROM generate_series(1, ${volumes.insights}::int) n`;
      await tx.$executeRaw`INSERT INTO ad_insights (id,"adAccountId",level,"objectId",date,spend,impressions,clicks,reach,"fetchedAt")
        SELECT ${prefix} || '_ai' || n, ${prefix} || '_w' || (n % 20) || '_ad',
          CASE WHEN n % 3 = 0 THEN 'account' ELSE 'campaign' END, ${prefix} || '_obj' || ((n / 20) % 10),
          date_trunc('day', NOW()) - (n / 200) * INTERVAL '1 day', 12.5, 500, 10, 400, NOW()
        FROM generate_series(1, ${volumes.adInsights}::int) n`;
      for (const table of ['users', 'workspaces', 'memberships', 'targets', 'social_accounts', 'ad_accounts', 'root_activities', 'posts', 'post_targets', 'conversations', 'conversation_messages', 'post_comments', 'page_reviews', 'page_insights', 'ad_insights']) {
        await tx.$executeRawUnsafe(`ANALYZE "${table}"`); // fixed identifier allowlist
      }
      const { listRootActivity, readRootActivityForExport } = await import('../src/server/root/activity');
      const { readPublishingPostPage } = await import('../src/modules/publishing/server/read');
      const { readInboxList } = await import('../src/modules/inbox/server/read');
      const { readAnalyticsSnapshot } = await import('../src/modules/analytics/server/read');
      const actor = { userId, workspaceId };
      async function probe(name: string, run: () => Promise<unknown>) {
        stage = name;
        capture = [];
        const start = performance.now();
        await run();
        const elapsedMs = performance.now() - start;
        const queries = capture;
        capture = null;
        if (!queries.length) throw new Error('No heavy SQL captured.');
        // Dedupe exact SQL AND bindings: relation hydration and per-resource
        // queries can have the same SQL with different scopes.
        const unique = new Map(queries.map(query => [`${query.query}\n${query.params}`, query]));
        const plans = [];
        for (const query of unique.values()) {
          const params: unknown[] = JSON.parse(query.params);
          const plan = await tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.query}`, ...params);
          plans.push({ sql: query.query, prismaMs: query.duration, plan });
        }
        report.push({ name, elapsedMs, statements: queries.length, plans });
        console.error(`Volume probe: ${name} (${elapsedMs.toFixed(1)} ms)`);
      }
      let rootCursor: string | null = null, inboxCursor: string | null = null;
      await probe('Root activity paging', async () => { const page = await listRootActivity(userId, { workspaceId }); if (!page.items.length) throw new Error('Empty Root fixture scope.'); rootCursor = page.olderCursor; });
      if (rootCursor) await probe('Root activity continuation', () => listRootActivity(userId, { workspaceId, cursor: rootCursor }));
      await probe('Root activity search', () => listRootActivity(userId, { workspaceId, q: 'needle' }));
      await probe('Root activity export', () => readRootActivityForExport(userId, { workspaceId, q: 'needle' }, 100_000));
      await probe('Posts paging', async () => { const page = await readPublishingPostPage(actor, { page: 20 }); if (!page.posts.length) throw new Error('Empty Posts fixture scope.'); });
      await probe('Posts search', () => readPublishingPostPage(actor, { q: 'needle' }));
      await probe('Inbox activity paging', async () => { const page = await readInboxList(actor); if (!page.items.length) throw new Error('Empty Inbox fixture scope.'); inboxCursor = page.olderCursor; });
      if (inboxCursor) await probe('Inbox activity continuation', () => readInboxList(actor, { cursor: inboxCursor }));
      await probe('Inbox activity search', () => readInboxList(actor, { q: 'needle' }));
      await probe('Analytics snapshot reads', () => readAnalyticsSnapshot(actor, {}));
      throw rollback;
    }, { timeout: 1_800_000, maxWait: 5_000 });
  } catch (error) {
    if (error !== rollback) {
      // Never serialize Prisma errors: they can include URLs, SQL or records.
      throw new Error(`Volume probe failed during ${stage}; fixtures rolled back. No complete timing evidence is available.`);
    }
  } finally {
    global.rebuildPrisma = previous;
    await db.$disconnect();
  }
  console.log(JSON.stringify({ kind: 'synthetic-rehearsal', scale, volumes, workspaces: 20, channels: 200, cleanup: 'transaction rolled back', indexDecision: 'Review plans before proposing additive indexes; timings are not production evidence.', results: report }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Volume probe failed.'); process.exitCode = 1; });
}
