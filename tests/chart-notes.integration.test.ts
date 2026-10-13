import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Notes on charts: a Page's own and the workspace-wide ones, inside the member's Pages. */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let notes: typeof import('../src/lib/chart-notes');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('chart_notes');
  ({ prisma } = await import('../src/lib/prisma'));
  notes = await import('../src/lib/chart-notes');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

async function seed() {
  const stamp = `${Date.now()}-${Math.random()}`;
  const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${stamp}`, timezone: 'UTC' } });
  const user = await prisma.user.create({ data: { email: `editor-${stamp}@example.test`, name: 'Editor', passwordHash: 'x' } });
  const page = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: `a-${stamp}`, name: 'Page A' } });
  const other = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: `b-${stamp}`, name: 'Page B' } });
  return { workspace, user, page, other };
}

describe('chart notes', () => {
  it('lists a Page’s notes and the workspace-wide ones inside the window, not another Page’s', async () => {
    const { workspace, user, page, other } = await seed();
    const add = (targetId: string | null, day: string, label: string) =>
      notes.addChartNote({ workspaceId: workspace.id, scope: { all: true }, authorId: user.id, input: { targetId, day, label, color: 'green' } });
    await add(page.id, '2026-11-03', 'Campaign started');
    await add(null, '2026-11-10', 'Holiday');
    await add(other.id, '2026-11-04', 'Other Page');
    await add(page.id, '2026-10-01', 'Too early');

    const listed = await notes.listChartNotes({ workspaceId: workspace.id, targetId: page.id, firstDay: '2026-11-01', lastDay: '2026-11-30' });
    expect(listed.map((note) => [note.day, note.label, note.pageOnly, note.color])).toEqual([
      ['2026-11-03', 'Campaign started', true, 'green'],
      ['2026-11-10', 'Holiday', false, 'green'],
    ]);
  });

  it('keeps a member limited to some Pages to those Pages', async () => {
    const { workspace, user, page, other } = await seed();
    const limited = { all: false as const, ids: [page.id] };
    const input = (targetId: string | null) => ({ targetId, day: '2026-11-03', label: 'Note', color: 'blue' as const });
    await expect(notes.addChartNote({ workspaceId: workspace.id, scope: limited, authorId: user.id, input: input(other.id) })).rejects.toMatchObject({ status: 404 });
    await expect(notes.addChartNote({ workspaceId: workspace.id, scope: limited, authorId: user.id, input: input(null) })).rejects.toMatchObject({ status: 404 });

    const wide = await notes.addChartNote({ workspaceId: workspace.id, scope: { all: true }, authorId: user.id, input: input(null) });
    await expect(notes.deleteChartNote({ workspaceId: workspace.id, scope: limited, noteId: wide.id })).rejects.toMatchObject({ status: 404 });
    const own = await notes.addChartNote({ workspaceId: workspace.id, scope: limited, authorId: user.id, input: input(page.id) });
    await notes.deleteChartNote({ workspaceId: workspace.id, scope: limited, noteId: own.id });
    expect(await prisma.chartNote.count({ where: { workspaceId: workspace.id } })).toBe(1);
  });
});
