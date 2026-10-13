import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let tasks: typeof import('../src/lib/tasks');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('tasks');
  ({ prisma } = await import('../src/lib/prisma'));
  tasks = await import('../src/lib/tasks');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

let n = 0;
const user = () => prisma.user.create({ data: { email: `t-${++n}@example.test`, name: `Person ${n}`, passwordHash: 'x' } });
const workspace = (name: string) => prisma.workspace.create({ data: { name, slug: `${name}-${++n}` } });

describe('tasks', () => {
  it('adds, moves and deletes a task, and gives it only to someone on the team', async () => {
    const [w, other] = [await workspace('a'), await workspace('b')];
    const [member, client, stranger] = [await user(), await user(), await user()];
    await prisma.membership.create({ data: { userId: member.id, workspaceId: w.id, role: 'editor' } });
    await prisma.membership.create({ data: { userId: client.id, workspaceId: w.id, role: 'client' } });
    await prisma.membership.create({ data: { userId: stranger.id, workspaceId: other.id, role: 'editor' } });

    const task = await tasks.createTask(w.id, member.id, { title: ' Write the newsletter ', assigneeId: member.id, dueOn: '2026-10-20' });
    expect([task.title, task.status, task.assigneeId, task.dueOn]).toEqual(['Write the newsletter', 'todo', member.id, '2026-10-20']);

    await expect(tasks.createTask(w.id, member.id, { title: 'x', assigneeId: client.id })).rejects.toMatchObject({ status: 404 });
    await expect(tasks.createTask(w.id, member.id, { title: 'x', assigneeId: stranger.id })).rejects.toMatchObject({ status: 404 });
    await expect(tasks.createTask(w.id, member.id, { title: 'x', dueOn: '20 October' })).rejects.toThrow();

    await tasks.updateTask(w.id, task.id, { status: 'done' });
    expect((await tasks.listTasks(w.id))[0]?.status).toBe('done');

    // Another workspace's task is out of reach.
    await expect(tasks.updateTask(other.id, task.id, { status: 'todo' })).rejects.toMatchObject({ status: 404 });
    await expect(tasks.deleteTask(other.id, task.id)).rejects.toMatchObject({ status: 404 });
    await tasks.deleteTask(w.id, task.id);
    expect(await tasks.listTasks(w.id)).toEqual([]);
  });
});
