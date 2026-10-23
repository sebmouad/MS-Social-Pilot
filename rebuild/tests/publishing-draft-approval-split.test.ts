import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  queryRaw: vi.fn(async (_sql: unknown): Promise<Array<{ drafts: string; approved: string }>> => [{ drafts: '7', approved: '3' }]),
  readQuery: vi.fn(async (): Promise<{ scope: { targetIds: string[]; authorId?: string }; channelUnavailable: boolean }> => ({ scope: { targetIds: ['c1', 'c2'], authorId: 'u1' }, channelUnavailable: false })),
  profiles: vi.fn(async () => ({ groups: [{ id: 'g1', channelIds: ['c1'] }] })),
}));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: m.queryRaw } }));
vi.mock('@/modules/publishing/server/read-query', () => ({ publishingPostReadQuery: m.readQuery }));
vi.mock('@/modules/settings/channel-profiles/service', () => ({ readChannelProfiles: m.profiles }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn(async () => 50) }));
vi.mock('@/platforms', async original => ({ ...await original<typeof import('@/platforms')>(), platformModule: vi.fn() }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: vi.fn() }));

import { readDraftApprovalSplit } from '@/modules/publishing/server/read';

const actor = { userId: 'u1', workspaceId: 'w1' };
const sqlOf = () => m.queryRaw.mock.calls[0]?.[0] as unknown as { strings: TemplateStringsArray; values: unknown[] };

beforeEach(() => { vi.clearAllMocks(); });

describe('readDraftApprovalSplit', () => {
  it('maps the stored counts and reads through the drafts query scope', async () => {
    await expect(readDraftApprovalSplit(actor)).resolves.toEqual({ drafts: 7, approved: 3 });
    expect(m.readQuery).toHaveBeenCalledWith(actor, { status: 'draft' }, 'publishing/approvals');
    const sql = sqlOf();
    expect(sql.strings.join(' ')).toContain('approvalStatus');
    expect(sql.values).toEqual(expect.arrayContaining(['w1', ['c1', 'c2'], 'u1']));
  });

  it('omits the channel filter when no channel is given', async () => {
    await readDraftApprovalSplit(actor);
    // workspace + scope targets twice + author id; no channel values.
    expect(sqlOf().values).toHaveLength(4);
    expect(m.profiles).not.toHaveBeenCalled();
  });

  it('filters a single channel', async () => {
    await readDraftApprovalSplit(actor, 'c9');
    expect(m.readQuery).toHaveBeenCalledWith(actor, { status: 'draft', channelId: 'c9' }, 'publishing/approvals');
    expect(sqlOf().values).toEqual(expect.arrayContaining([['c9']]));
    expect(m.profiles).not.toHaveBeenCalled();
  });

  it('expands channel groups to their channels', async () => {
    await readDraftApprovalSplit(actor, 'channel-group:g1');
    expect(m.profiles).toHaveBeenCalledWith(
      { userId: 'u1', workspaceId: 'w1', allowedChannelIds: ['c1', 'c2'] },
      'publishing/posts',
    );
    expect(sqlOf().values).toEqual(expect.arrayContaining([['c1']]));
  });

  it('splits multi-channel scope', async () => {
    await readDraftApprovalSplit(actor, 'c1, c2');
    expect(sqlOf().values).toEqual(expect.arrayContaining([['c1', 'c2']]));
  });

  it('omits the author constraint for unrestricted scopes', async () => {
    m.readQuery.mockResolvedValueOnce({ scope: { targetIds: ['c1'] }, channelUnavailable: false });
    await readDraftApprovalSplit(actor);
    expect(sqlOf().values).toHaveLength(3);
  });

  it('propagates query validation failures', async () => {
    m.readQuery.mockRejectedValueOnce(new Error('bad channel'));
    await expect(readDraftApprovalSplit(actor, 'c9')).rejects.toThrow('bad channel');
  });

  it('treats unreadable counts as zero', async () => {
    m.queryRaw.mockResolvedValueOnce([{ drafts: 'nope', approved: '-1' }]);
    await expect(readDraftApprovalSplit(actor)).resolves.toEqual({ drafts: 0, approved: 0 });
    m.queryRaw.mockResolvedValueOnce([]);
    await expect(readDraftApprovalSplit(actor)).resolves.toEqual({ drafts: 0, approved: 0 });
  });
});
