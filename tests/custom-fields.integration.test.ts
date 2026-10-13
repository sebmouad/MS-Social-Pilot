import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let fields: typeof import('../src/lib/custom-fields');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('customfields');
  ({ prisma } = await import('../src/lib/prisma'));
  fields = await import('../src/lib/custom-fields');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.post.deleteMany();
  await prisma.customField.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

let n = 0;
const workspace = (name: string) => prisma.workspace.create({ data: { name, slug: `${name}-${++n}` } });

describe('custom fields', () => {
  it('defines fields, fills them on a post, and keeps a choice to its options', async () => {
    const [w, other] = [await workspace('a'), await workspace('b')];
    const author = await prisma.user.create({ data: { email: `cf-${++n}@example.test`, name: 'A', passwordHash: 'x' } });
    const code = await fields.createCustomField(w.id, { name: 'Campaign code', kind: 'text' });
    const stage = await fields.createCustomField(w.id, { name: 'Stage', kind: 'choice', options: ['Draft', 'Final', 'Draft'] });
    expect(stage.options).toEqual(['Draft', 'Final']);
    await expect(fields.createCustomField(w.id, { name: 'Stage', kind: 'text' })).rejects.toMatchObject({ status: 409 });
    expect(() => fields.customFieldSchema.parse({ name: 'X', kind: 'choice', options: ['one'] })).toThrow();

    const post = await prisma.post.create({ data: { workspaceId: w.id, authorId: author.id, message: 'Hello' } });
    await fields.setPostFields(w.id, post.id, { [code.id]: ' SPRING ', [stage.id]: 'Final' });
    const read = (await fields.readPostFields(w.id, [post.id])).get(post.id);
    expect(read?.map((entry) => [entry.name, entry.value])).toEqual([['Campaign code', 'SPRING'], ['Stage', 'Final']]);

    await expect(fields.setPostFields(w.id, post.id, { [stage.id]: 'Nonsense' })).rejects.toMatchObject({ status: 400 });
    // An empty value clears it; another workspace's fields are ignored.
    await fields.setPostFields(w.id, post.id, { [code.id]: '' });
    await fields.setPostFields(other.id, post.id, { [stage.id]: 'Draft' });
    expect((await fields.readPostFields(w.id, [post.id])).get(post.id)?.map((entry) => entry.name)).toEqual(['Stage']);

    await expect(fields.deleteCustomField(other.id, code.id)).rejects.toMatchObject({ status: 404 });
    await fields.deleteCustomField(w.id, stage.id);
    expect((await fields.readPostFields(w.id, [post.id])).get(post.id)).toBeUndefined();
  });
});
