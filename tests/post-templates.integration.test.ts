import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Post templates: names unique per workspace, labels only from it. */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let store: typeof import('../src/lib/post-templates-store');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('post_templates');
  ({ prisma } = await import('../src/lib/prisma'));
  store = await import('../src/lib/post-templates-store');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

describe('post template store', () => {
  it('saves, lists by category, refuses a taken name and a label from elsewhere', async () => {
    const [mine, theirs] = await Promise.all(
      ['Client A', 'Client B'].map((name, index) => prisma.workspace.create({ data: { name, slug: `templates-${index}-${Date.now()}` } })),
    );
    const label = await prisma.label.create({ data: { workspaceId: mine!.id, name: 'Promo' } });
    const foreign = await prisma.label.create({ data: { workspaceId: theirs!.id, name: 'Promo' } });

    const input = (fields: Record<string, unknown>) => store.templateSchema.parse({ name: 'Weekly offer', body: 'This week: {product}', ...fields });
    const created = await store.createTemplate(mine!.id, input({ category: 'Promo', hashtags: 'offer, #new', labelId: label.id }));
    expect(created).toMatchObject({ hashtags: '#offer #new', labelId: label.id });
    await store.createTemplate(mine!.id, input({ name: 'Quick tip', category: 'Advice' }));

    expect((await store.listTemplates(mine!.id)).map((template) => template.name)).toEqual(['Quick tip', 'Weekly offer']);
    await expect(store.createTemplate(mine!.id, input({}))).rejects.toMatchObject({ status: 409 });
    await expect(store.createTemplate(mine!.id, input({ name: 'Other', labelId: foreign.id }))).rejects.toMatchObject({ status: 404 });
    // The same name is free in another workspace.
    await expect(store.createTemplate(theirs!.id, input({}))).resolves.toMatchObject({ name: 'Weekly offer' });

    await store.updateTemplate(mine!.id, created.id, input({ name: 'Weekly offer', body: 'Changed' }));
    expect(await prisma.postTemplate.findUnique({ where: { id: created.id } })).toMatchObject({ body: 'Changed', labelId: null });
    await expect(store.updateTemplate(theirs!.id, created.id, input({ name: 'Hijacked' }))).rejects.toMatchObject({ status: 404 });

    // Removing the label keeps the template.
    await store.updateTemplate(mine!.id, created.id, input({ labelId: label.id }));
    await prisma.label.delete({ where: { id: label.id } });
    expect(await prisma.postTemplate.findUnique({ where: { id: created.id } })).toMatchObject({ labelId: null });
  });
});
