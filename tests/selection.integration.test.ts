import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** The shared profile selection: address first, then the remembered one, always inside the member's Pages. */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let filter: typeof import('../src/lib/page-filter');
let selection: typeof import('../src/lib/selection');
const ids: Record<string, string> = {};
let auth: import('../src/lib/auth').AuthContext;

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('selection');
  ({ prisma } = await import('../src/lib/prisma'));
  filter = await import('../src/lib/page-filter');
  selection = await import('../src/lib/selection');

  const user = await prisma.user.create({ data: { email: 's@example.test', name: 'S', passwordHash: 'x' } });
  const workspace = await prisma.workspace.create({
    data: { name: 'Client A', slug: 'client-a', timezone: 'UTC', memberships: { create: { userId: user.id, role: WorkspaceRole.owner } } },
  });
  const other = await prisma.workspace.create({ data: { name: 'Client B', slug: 'client-b', timezone: 'UTC' } });
  for (const [key, type, ws] of [['one', 'page', workspace.id], ['two', 'page', workspace.id], ['ig', 'instagram', workspace.id], ['foreign', 'page', other.id]] as const) {
    ids[key] = (await prisma.target.create({ data: { workspaceId: ws, type, providerId: key, name: key } })).id;
  }
  auth = {
    user: { id: user.id, email: user.email, name: user.name, locale: 'en' },
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, timezone: 'UTC', requiresApproval: false, defaultLocale: 'en' },
    role: WorkspaceRole.owner,
    isInstanceOwner: false,
    workspaces: [],
    pageScope: { all: true },
  } as unknown as import('../src/lib/auth').AuthContext;
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

describe('the profile selection', () => {
  it('shows every Page of the workspace when nothing is chosen', async () => {
    jar.clear();
    const result = await filter.loadSelection(auth, {});
    expect(result.ids.sort()).toEqual([ids.one, ids.two, ids.ig].sort());
    expect(result.scope).toEqual({ all: true });
  });

  it('drops ids from another workspace, and is never empty', async () => {
    jar.clear();
    expect((await filter.loadSelection(auth, { pages: `${ids.one},${ids.foreign}` })).ids).toEqual([ids.one]);
    const onlyForeign = await filter.loadSelection(auth, { pages: ids.foreign });
    expect(onlyForeign.ids.sort()).toEqual([ids.one, ids.two, ids.ig].sort());
  });

  it('narrows to a network', async () => {
    jar.clear();
    const result = await filter.loadSelection(auth, { net: 'instagram' });
    expect(result.ids).toEqual([ids.ig]);
    expect(result.scope).toEqual({ all: false, ids: [ids.ig] });
  });

  it('comes back from the cookie when the address has none, and the address wins over it', async () => {
    jar.clear();
    jar.set(selection.selectionCookieName(auth.workspace.id), encodeURIComponent(`pages=${ids.two}`));
    expect((await filter.loadSelection(auth, {})).ids).toEqual([ids.two]);
    expect((await filter.loadSelection(auth, { pages: ids.one })).ids).toEqual([ids.one]);
  });

  it('a limited member cannot widen their access with the address', async () => {
    jar.clear();
    const limited = { ...auth, pageScope: { all: false as const, ids: [ids.one!] } };
    expect((await filter.loadSelection(limited, { pages: `${ids.one},${ids.two}` })).ids).toEqual([ids.one]);
  });
});
