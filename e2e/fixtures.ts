import { PrismaClient } from '@prisma/client';

// Static, not `await import()`: Playwright compiles TypeScript it loads
// through its require hook, and a dynamic import goes around the hook to
// Node's own loader, which failed on the first `import` statement and took
// every spec that seeds a Page down with it. The key is only read when a
// value is encrypted, so setting it below still comes first.
import { encryptSecret } from '../src/lib/crypto';

/**
 * A connected Page, invented rather than connected.
 *
 * Every screen worth walking is a list of something, and an empty list renders
 * a different — much simpler — branch than a full one. Connecting a real Page
 * needs a real Facebook login, so the walk puts one in the database directly:
 * enough of a Page for the composer to offer it and for a scheduled post to
 * have somewhere to go. Nothing here ever talks to Facebook.
 */

const databaseUrl = (() => {
  const url = new URL(
    process.env.E2E_DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:5432/social_pilot_test',
  );
  url.searchParams.set('schema', 'e2e');
  return url.toString();
})();

export const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

export const PAGE_NAME = 'Halloway Bakery';

export async function connectPretendPage(workspaceName: string): Promise<string> {
  // The token is opaque to everything the walk touches; it is only ever read on
  // the way to a Graph call, and the walk never makes one.
  process.env.ENCRYPTION_KEY ??= 'c3aCfAcoo9L+9hMqSB+2x2mSjeyLwAyhNamW5DsCikc=';

  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: workspaceName } });

  const account = await prisma.socialAccount.upsert({
    where: {
      workspaceId_provider_providerUserId: {
        workspaceId: workspace.id,
        provider: 'facebook',
        providerUserId: '10000000000000001',
      },
    },
    create: {
      workspaceId: workspace.id,
      providerUserId: '10000000000000001',
      name: 'Wren Halloway',
      accessToken: encryptSecret('pretend-user-token'),
      scopes: 'pages_show_list,pages_manage_posts,pages_read_engagement',
      tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    },
    update: {},
  });

  const existing = await prisma.target.findFirst({
    where: { workspaceId: workspace.id, providerId: '20000000000000002' },
  });
  if (existing) return existing.id;

  const target = await prisma.target.create({
    data: {
      workspaceId: workspace.id,
      socialAccountId: account.id,
      type: 'page',
      providerId: '20000000000000002',
      name: PAGE_NAME,
      category: 'Bakery',
      accessToken: encryptSecret('pretend-page-token'),
      fanCount: 1234,
      followersCount: 1301,
    },
  });

  return target.id;
}
