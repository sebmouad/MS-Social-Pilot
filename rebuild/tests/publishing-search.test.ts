import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/client';

const state = vi.hoisted(() => ({ authorize: vi.fn(), selected: vi.fn(), config: vi.fn() }));
vi.mock('../src/modules/publishing/server/access', () => ({ authorizePublishing: state.authorize }));
vi.mock('../src/modules/publishing/server/read-scope', () => ({
  selectedPublishingTargetIds: state.selected,
  publishingPostVisibilityWhere: (workspaceId: string, targetIds?: readonly string[] | null, authorId?: string) => ({ workspaceId, OR: [
    { targets: { some: { targetId: { in: [...(targetIds ?? [])] } }, every: { targetId: { in: [...(targetIds ?? [])] } } } },
    ...(authorId ? [{ targets: { none: {} }, authorId }] : targetIds == null ? [] : [{ targets: { none: {} } }]),
  ] }),
}));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));

import { publishingPostReadQuery, publishingPostSearch, publishingPostSearchWhere } from '../src/modules/publishing/server/read-query';

const actor = { userId: 'reader', workspaceId: 'workspace' };
const allowedActor = { ...actor, allowedTargetIds: ['selected-a'] };
const access = (who: typeof actor | typeof allowedActor = allowedActor) => ({ actor: who, entitlements: { workspaceId: 'workspace', modules: { publishing: true }, features: { 'publishing/posts': true } } });

beforeEach(() => {
  vi.clearAllMocks();
  state.authorize.mockImplementation(async who => access(who));
  state.selected.mockResolvedValue(['selected-a', 'selected-b']);
  state.config.mockImplementation(async (key: string) => ({ 'publishing.identifierMaxCharacters': 200, 'publishing.searchMaxCharacters': 200 }[key]));
});

describe('Publishing literal search query', () => {
  it('trims search text and escapes PostgreSQL LIKE metacharacters', () => {
    expect(publishingPostSearchWhere('50%_\\')).toEqual({ OR: [
      { message: { contains: '50\\%\\_\\\\', mode: 'insensitive' } },
      { firstComment: { contains: '50\\%\\_\\\\', mode: 'insensitive' } },
    ] });
  });

  it('normalizes absent and whitespace-only searches and rejects invalid text', async () => {
    await expect(publishingPostSearch(undefined)).resolves.toBe('');
    await expect(publishingPostSearch('  \t  ')).resolves.toBe('');
    await expect(publishingPostSearch('💬'.repeat(100))).resolves.toBe('💬'.repeat(100));
    for (const value of [4, 'a\nb', 'a\u0000b', '\nneedle', 'needle\n']) {
      await expect(publishingPostSearch(value)).rejects.toMatchObject({ code: 'invalid_request' });
    }
    await expect(publishingPostSearch('a\nb')).rejects.toMatchObject({ message: 'Search must fit on one line.' });
    await expect(publishingPostSearch('x'.repeat(201))).rejects.toMatchObject({
      code: 'invalid_request', message: 'Search must be 200 characters or fewer.',
    });
    await expect(publishingPostSearch('💬'.repeat(101))).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('rejects unknown filters and malformed status/channel/search inputs', async () => {
    for (const input of [
      { unknown: 'value' }, { status: 'published,scheduled' }, { status: 'PUBLISHED' },
      { channelId: ' selected-a' }, { channelId: 'x'.repeat(201) }, { q: 'x'.repeat(201) },
    ]) await expect(publishingPostReadQuery(allowedActor, input as never)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.selected).not.toHaveBeenCalled();
  });

  it('composes visibility, status, selected channel and text under AND without replacing visibility OR', async () => {
    const result = await publishingPostReadQuery(allowedActor, { status: 'published', channelId: 'selected-a', q: ' Café ' });
    expect(result.filters).toEqual({ status: 'published', channelId: 'selected-a', q: 'Café' });
    expect(result.channelUnavailable).toBe(false);
    expect(result.where.AND).toEqual([
      expect.objectContaining({ workspaceId: 'workspace', OR: expect.any(Array) }),
      { status: 'published' },
      { targets: { some: { targetId: 'selected-a' } } },
      { OR: [{ message: { contains: 'Café', mode: 'insensitive' } }, { firstComment: { contains: 'Café', mode: 'insensitive' } }] },
    ]);
    expect(result.where.OR).toBeUndefined();
    expect(state.authorize).toHaveBeenCalledWith(allowedActor, 'publishing/posts', 'read');
  });

  it('keeps author-scoped unconnected drafts and marks an unavailable selected channel', async () => {
    state.authorize.mockResolvedValueOnce(access(allowedActor));
    const result = await publishingPostReadQuery(actor, { channelId: 'unselected' });
    expect(result.channelUnavailable).toBe(true);
    const visibility = (result.where.AND as Prisma.PostWhereInput[])[0];
    expect(visibility).toEqual(expect.objectContaining({ OR: expect.arrayContaining([
      { targets: { none: {} }, authorId: 'reader' },
    ]) }));
    expect(result.where.AND).toContainEqual({ targets: { some: { targetId: 'unselected' } } });
  });
});
