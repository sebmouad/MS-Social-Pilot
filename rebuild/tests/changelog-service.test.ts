import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: { $queryRaw: vi.fn() }, batch: vi.fn(), assertRoot: vi.fn(), lock: vi.fn(), audit: vi.fn(), tx: { $executeRaw: vi.fn() },
}));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfigBatch: mocks.batch, runtimeConfig: vi.fn() }));
vi.mock('../src/server/root/legacy/authz', () => ({ assertRootActor: mocks.assertRoot, lockRootActor: mocks.lock }));
vi.mock('../src/server/root/legacy/audit', () => ({ writeRootAudit: mocks.audit }));
vi.mock('../src/server/root/legacy/policy', () => ({
  rootResultLimit: (configured: number, requested?: number) => requested === undefined ? configured : Math.min(configured, requested),
  rootTransaction: async (run: (tx: unknown) => unknown) => run(mocks.tx),
}));

import { addRootChangelogEntry, listPublicChangelog, listRootChangelog, removeRootChangelogEntry } from '../src/modules/history/server/changelog';
import { executeRootChangelogTool, rootChangelogToolDefinitions } from '../src/modules/history/root-mcp';

const policy: Record<string, number> = { 'public.changelogPageSize': 2, 'public.changelogTitleMaxCharacters': 20, 'public.changelogBodyMaxCharacters': 50, 'root.confirmationMaxCharacters': 200, 'root.identifierMaxCharacters': 50 };
const rows = [{ id: 'c1', publishedOn: new Date('2026-10-20T00:00:00Z'), title: 'One', body: 'b' }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.batch.mockImplementation(async (keys: string[]) => Object.fromEntries(keys.map(key => [key, policy[key]])));
  mocks.assertRoot.mockResolvedValue(undefined); mocks.lock.mockResolvedValue(undefined); mocks.audit.mockResolvedValue(undefined);
  mocks.tx.$executeRaw.mockResolvedValue(1);
  mocks.prisma.$queryRaw.mockResolvedValue(rows);
});

describe('changelog reads', () => {
  it('public list needs no actor and is bounded by Root', async () => {
    await expect(listPublicChangelog()).resolves.toEqual([{ id: 'c1', publishedOn: '2026-10-20', title: 'One', body: 'b' }]);
    expect(mocks.assertRoot).not.toHaveBeenCalled();
  });
  it('Root list requires an installation owner and honours a smaller ceiling', async () => {
    mocks.assertRoot.mockRejectedValueOnce(Object.assign(new Error('Installation-owner access is required.'), { code: 'forbidden' }));
    await expect(listRootChangelog('member')).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
    await expect(listRootChangelog('root', 1)).resolves.toMatchObject({ pageSize: 1 });
  });
});

describe('changelog writes (Root only, exact confirmation, audited in the same transaction)', () => {
  const entry = { publishedOn: '2026-10-21', title: ' New release ', body: 'Text', confirmation: 'ADD CHANGELOG ENTRY New release' };
  it('adds an entry, rechecks the Root actor and writes the audit row', async () => {
    const result = await addRootChangelogEntry('root', entry);
    expect(result.entry).toMatchObject({ publishedOn: '2026-10-21', title: 'New release', body: 'Text' });
    expect(mocks.lock).toHaveBeenCalledWith(mocks.tx, 'root');
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, 'root', 'changelog.added', expect.objectContaining({ title: 'New release' }));
  });
  it('refuses a wrong confirmation, an impossible date, extra fields and over-long text before writing', async () => {
    for (const bad of [{ ...entry, confirmation: 'yes' }, { ...entry, publishedOn: '2026-02-31' }, { ...entry, extra: 1 }, { ...entry, title: 'x'.repeat(21), confirmation: `ADD CHANGELOG ENTRY ${'x'.repeat(21)}` }, { ...entry, body: 'x'.repeat(51) }]) {
      await expect(addRootChangelogEntry('root', bad)).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('a non-Root actor is refused inside the transaction and nothing is written', async () => {
    mocks.lock.mockRejectedValueOnce(Object.assign(new Error('Installation-owner access is required.'), { code: 'forbidden' }));
    await expect(addRootChangelogEntry('member', entry)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('removes by id with the exact confirmation and audits; a missing entry is not found', async () => {
    await expect(removeRootChangelogEntry('root', 'c1', 'REMOVE CHANGELOG ENTRY c1')).resolves.toEqual({ removed: true, id: 'c1' });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, 'root', 'changelog.removed', { id: 'c1' });
    await expect(removeRootChangelogEntry('root', 'c1', 'REMOVE c1')).rejects.toMatchObject({ code: 'invalid_request' });
    mocks.tx.$executeRaw.mockResolvedValueOnce(0);
    await expect(removeRootChangelogEntry('root', 'c9', 'REMOVE CHANGELOG ENTRY c9')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('Root MCP changelog tools use the same services', () => {
  it('declares one read and two confirmed writes', () => {
    expect(rootChangelogToolDefinitions.map(tool => tool.name)).toEqual(['list_root_changelog', 'add_root_changelog_entry', 'remove_root_changelog_entry']);
  });
  it('dispatches and rejects stray arguments', async () => {
    await expect(executeRootChangelogTool('root', 'list_root_changelog', {})).resolves.toMatchObject({ items: [{ id: 'c1' }] });
    await expect(executeRootChangelogTool('root', 'list_root_changelog', { q: 'x' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeRootChangelogTool('root', 'remove_root_changelog_entry', { id: 'c1', confirmation: 'REMOVE CHANGELOG ENTRY c1', extra: true })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeRootChangelogTool('root', 'add_root_changelog_entry', { publishedOn: '2026-10-21', title: 'A', confirmation: 'ADD CHANGELOG ENTRY A' })).resolves.toMatchObject({ entry: { title: 'A' } });
  });
});
