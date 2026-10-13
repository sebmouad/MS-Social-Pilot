import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Server half: a page is fetched for its JSON-LD and the
 * pictures a template uses are copied into the media library; private
 * addresses and non-pictures are refused, one at a time.
 */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let fetcher: typeof import('../src/lib/structured-data-fetch');
let safeFetch: typeof import('../src/lib/safe-fetch');

// The smallest valid PNG.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('structured_data');
  ({ prisma } = await import('../src/lib/prisma'));
  fetcher = await import('../src/lib/structured-data-fetch');
  safeFetch = await import('../src/lib/safe-fetch');
  safeFetch.setResolverForTests(async () => ['93.184.216.34']);
}, 120_000);

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  safeFetch?.setResolverForTests(null);
  await prisma?.$disconnect();
  database?.drop();
});

describe('structured data fetch', () => {
  it('reads JSON-LD from the page and refuses private addresses', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response('<html><head><script type="application/ld+json">{"@type":"Product","name":"Lamp"}</script></head></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );
    expect((await fetcher.fetchStructuredData('https://shop.example.com/lamp')).map((item) => item.name)).toEqual(['Lamp']);
    await expect(fetcher.fetchStructuredData('http://127.0.0.1/admin')).rejects.toThrow();
  });

  it('copies pictures into the library and names the ones it cannot have', async () => {
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: 'client-a-sd', timezone: 'UTC' } });
    vi.stubGlobal('fetch', async (url: URL) =>
      String(url).endsWith('.png')
        ? new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
        : new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const result = await fetcher.importImages(workspace.id, ['https://cdn.example.com/a.png', 'https://cdn.example.com/page', 'http://10.0.0.1/b.png']);
    expect(result.media).toHaveLength(1);
    expect(result.media[0]).toMatchObject({ kind: 'image', mimeType: 'image/png' });
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toMatch(/^page: /);
    const row = await prisma.media.findUniqueOrThrow({ where: { id: result.media[0]!.id } });
    expect(row).toMatchObject({ workspaceId: workspace.id, filename: 'a.png', url: `/api/media/${row.id}/raw` });
  });
});
