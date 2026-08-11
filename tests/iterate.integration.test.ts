import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Walking every workspace, or every destination, a page at a time.
 *
 * Two properties matter and neither is visible from reading the call sites.
 * The walk has to cross a page boundary correctly — an off-by-one in the cursor
 * silently skips or repeats a tenant, and a job that quietly misses every
 * hundredth client is the kind of bug found by a customer. And one tenant's
 * failure must not end the pass for everyone behind it in the list.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let iterate: typeof import('../src/lib/scheduler/iterate');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('iterate');

  ({ prisma } = await import('../src/lib/prisma'));
  iterate = await import('../src/lib/scheduler/iterate');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.target.deleteMany();
  await prisma.workspace.deleteMany();
});

async function makeWorkspaces(count: number) {
  const suffix = randomBytes(3).toString('hex');
  await prisma.workspace.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      // Padded so lexical id order is stable and predictable across pages.
      name: `client-${index}`,
      slug: `client-${suffix}-${String(index).padStart(4, '0')}`,
      timezone: 'UTC',
    })),
  });
}

describe('forEachWorkspace', () => {
  it('visits every workspace exactly once across page boundaries', async () => {
    // 250 crosses the 100-row page size twice, so an off-by-one in the cursor
    // shows up as a duplicate or a gap rather than passing by luck.
    await makeWorkspaces(250);

    const seen: string[] = [];
    const result = await iterate.forEachWorkspace(async (id) => {
      seen.push(id);
    });

    expect(result.visited).toBe(250);
    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
    expect(result.failures).toEqual([]);
  });

  it('visits every workspace when the count lands exactly on a page boundary', async () => {
    await makeWorkspaces(100);

    const result = await iterate.forEachWorkspace(async () => undefined);
    expect(result.visited).toBe(100);
  });

  it('does nothing, without error, when there are none', async () => {
    const result = await iterate.forEachWorkspace(async () => {
      throw new Error('should never run');
    });

    expect(result).toEqual({ visited: 0, failures: [] });
  });

  it('keeps going after one workspace throws', async () => {
    // A single tenant with a broken connection must not end the pass for
    // everyone behind it in the list.
    await makeWorkspaces(5);

    const visited: string[] = [];
    const result = await iterate.forEachWorkspace(async (id) => {
      visited.push(id);
      if (visited.length === 2) throw new Error('Facebook says no');
    });

    expect(result.visited).toBe(5);
    expect(visited).toHaveLength(5);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.message).toMatch(/Facebook says no/);
  });

  it('names the workspace that failed', async () => {
    await makeWorkspaces(2);

    const result = await iterate.forEachWorkspace(async (id) => {
      throw new Error(`broke on ${id}`);
    });

    expect(result.failures).toHaveLength(2);
    for (const failure of result.failures) {
      expect(failure.message).toContain(failure.id);
    }
  });
});

describe('forEachEnabledPage', () => {
  async function makeTargets(workspaceId: string, specs: Array<{ type: 'page' | 'group'; enabled: boolean }>) {
    const suffix = randomBytes(3).toString('hex');
    await prisma.target.createMany({
      data: specs.map((spec, index) => ({
        workspaceId,
        type: spec.type,
        enabled: spec.enabled,
        providerId: `${suffix}-${index}`,
        name: `target ${index}`,
      })),
    });
  }

  it('visits only enabled Pages', async () => {
    await makeWorkspaces(1);
    const workspace = await prisma.workspace.findFirstOrThrow();

    await makeTargets(workspace.id, [
      { type: 'page', enabled: true },
      { type: 'page', enabled: false },
      { type: 'group', enabled: true },
    ]);

    const result = await iterate.forEachEnabledPage(async () => undefined);
    expect(result.visited).toBe(1);
  });

  it('crosses workspaces as one list', async () => {
    // The edge sync is instance-wide, not per tenant, so the walk must not
    // stop at the first workspace's last page.
    await makeWorkspaces(2);
    const workspaces = await prisma.workspace.findMany();

    for (const workspace of workspaces) {
      await makeTargets(workspace.id, [{ type: 'page', enabled: true }]);
    }

    const result = await iterate.forEachEnabledPage(async () => undefined);
    expect(result.visited).toBe(2);
  });
});
