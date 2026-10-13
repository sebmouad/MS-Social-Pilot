import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

vi.mock('../src/lib/ai', async (original) => ({
  ...(await original<typeof import('../src/lib/ai')>()),
  aiAvailable: () => true,
  planWeek: async (options: { count: number }) =>
    Array.from({ length: options.count }, (_, index) => ({ day: index, time: '09:00', text: `Draft ${index + 1}` })),
}));

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let agents: typeof import('../src/lib/ai-agents');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('ai-agents');
  ({ prisma } = await import('../src/lib/prisma'));
  agents = await import('../src/lib/ai-agents');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.post.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

let n = 0;

async function seed(role: 'editor' | 'viewer' = 'editor') {
  const user = await prisma.user.create({ data: { email: `a-${++n}@example.test`, name: 'Person', passwordHash: 'x' } });
  const workspace = await prisma.workspace.create({ data: { name: 'W', slug: `w-${n}`, timezone: 'UTC' } });
  await prisma.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role } });
  const page = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: `p-${n}`, name: 'Page 1' } });
  return { user, workspace, page };
}

// 2026-10-19 is a Monday (weekday 1).
const MONDAY = new Date('2026-10-19T08:00:00Z');

describe('AI agents', () => {
  it('writes a week of drafts on its day, once, and only for a Page in the workspace', async () => {
    const { user, workspace, page } = await seed();
    const other = await seed();
    await expect(agents.createAgent(workspace.id, user.id, { targetId: other.page.id, brief: 'Tips', weekday: 1 })).rejects.toThrow();

    await agents.createAgent(workspace.id, user.id, { targetId: page.id, brief: 'Weekly tips', weekday: 1, count: 3 });
    expect(await agents.runDueAgents(new Date('2026-10-20T08:00:00Z'))).toBe(0);
    expect(await agents.runDueAgents(MONDAY)).toBe(3);
    expect(await agents.runDueAgents(MONDAY)).toBe(0);

    const posts = await prisma.post.findMany({ where: { workspaceId: workspace.id } });
    expect(posts).toHaveLength(3);
    expect(posts.every((post) => post.status === 'draft')).toBe(true);
  });

  it('skips an agent whose creator can no longer compose', async () => {
    const { user, workspace, page } = await seed('viewer');
    await agents.createAgent(workspace.id, user.id, { targetId: page.id, brief: 'Tips', weekday: 1 });
    expect(await agents.runDueAgents(MONDAY)).toBe(0);
  });
});
