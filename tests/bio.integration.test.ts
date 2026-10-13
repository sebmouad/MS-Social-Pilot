import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let bio: typeof import('../src/lib/bio');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('bio');
  ({ prisma } = await import('../src/lib/prisma'));
  bio = await import('../src/lib/bio');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.bioPage.deleteMany();
  await prisma.workspace.deleteMany();
});

const workspace = (name: string) => prisma.workspace.create({ data: { name, slug: `${name}-${Math.random().toString(36).slice(2, 8)}` } });
const input = (slug: string) => ({ slug, title: 'Shop', enabled: true, links: [{ label: 'Menu', url: 'https://example.test/menu' }, { label: 'Book', url: 'https://example.test/book' }] });

describe('link in bio', () => {
  it('saves a page, keeps click counts for unchanged links, and counts a click on its way out', async () => {
    const w = await workspace('a');
    await bio.saveBio(w.id, bio.bioSchema.parse(input('my-shop')));
    const page = (await bio.getBioBySlug('my-shop'))!;
    expect(page.links.map((link) => link.label)).toEqual(['Menu', 'Book']);

    expect(await bio.followBioLink('my-shop', page.links[0]!.id)).toBe('https://example.test/menu');
    expect(await bio.followBioLink('other-slug', page.links[0]!.id)).toBeNull();

    // Reorder and add: the unchanged link keeps its one click.
    await bio.saveBio(w.id, bio.bioSchema.parse({ ...input('my-shop'), links: [{ label: 'Book', url: 'https://example.test/book' }, { label: 'Menu', url: 'https://example.test/menu' }] }));
    const after = (await bio.getBio(w.id))!;
    expect(after.links.map((link) => [link.label, link.clicks])).toEqual([['Book', 0], ['Menu', 1]]);
  });

  it('refuses another workspace’s address, and does not serve a page that is switched off', async () => {
    const a = await workspace('a');
    const b = await workspace('b');
    await bio.saveBio(a.id, bio.bioSchema.parse(input('shared-name')));
    await expect(bio.saveBio(b.id, bio.bioSchema.parse(input('shared-name')))).rejects.toMatchObject({ status: 409 });
    await bio.saveBio(a.id, bio.bioSchema.parse({ ...input('shared-name'), enabled: false }));
    expect(await bio.getBioBySlug('shared-name')).toBeNull();
    expect(bio.bioSchema.safeParse(input('Bad Slug!')).success).toBe(false);
  });
});
