import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ authorize: vi.fn(), selected: vi.fn(), page: vi.fn(), findMany: vi.fn(), config: vi.fn(), ids: vi.fn() }));
vi.mock('../src/modules/publishing/server/access', () => ({ authorizePublishing: state.authorize }));
vi.mock('../src/modules/publishing/server/read-scope', () => ({
  selectedPublishingTargetIds: state.selected,
  publishingPostVisibilityWhere: (workspaceId: string) => ({ workspaceId }),
}));
vi.mock('../src/server/data', () => ({ prisma: { post: { findMany: state.findMany, count: vi.fn() }, target: { findMany: vi.fn(async () => []) } }, listPostPage: state.page, listCalendarRange: vi.fn(), getTargets: vi.fn() }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('../src/modules/installed-post-origins', () => ({ INSTALLED_POST_ORIGIN_SOURCES: [{ kind: 'recipe', matchingPostIds: state.ids }] }));

import { readPublishingPostList, readPublishingPostPage } from '../src/modules/publishing/server/read';
import { parsePostOrigin } from '../src/modules/publishing/server/origin-source';

const actor = { userId: 'reader', workspaceId: 'workspace' };
const configValues: Record<string, number> = { 'publishing.identifierMaxCharacters': 200, 'publishing.postPageSize': 2, 'publishing.readMaxItems': 200, 'publishing.searchMaxCharacters': 200 };

beforeEach(() => {
  vi.clearAllMocks();
  state.authorize.mockImplementation(async (a: typeof actor) => ({ actor: a, entitlements: {} }));
  state.selected.mockResolvedValue(['t1']);
  state.page.mockResolvedValue({ posts: [], total: 0, page: 1, pages: 1 });
  state.findMany.mockResolvedValue([]);
  state.ids.mockResolvedValue(['p1', 'p2', 'p3']);
  state.config.mockImplementation(async (key: string) => configValues[key]);
});

describe('origin filter in the posts query', () => {
  it('puts the origin in the paged query itself so totals and pages come from the filtered set', async () => {
    state.page.mockResolvedValue({ posts: [{ id: 'p3', targets: [] }], total: 3, page: 2, pages: 2 });
    const result = await readPublishingPostPage(actor, { page: 2, status: 'published', origin: 'recipe' });
    expect(state.ids).toHaveBeenCalledWith('workspace');
    const call = state.page.mock.calls[0]!;
    expect(call[1]).toBe(2);
    expect(call[2]).toBe(2);
    expect(call[5].where.AND).toEqual(expect.arrayContaining([{ status: 'published' }, { id: { in: ['p1', 'p2', 'p3'] } }]));
    expect(result).toMatchObject({ total: 3, pages: 2, page: 2, filters: { origin: 'recipe', status: 'published' } });
  });

  it('adds no condition and does not call the source without the filter', async () => {
    await readPublishingPostPage(actor, {});
    expect(state.ids).not.toHaveBeenCalled();
    expect(state.page.mock.calls[0]![5].where.AND).toHaveLength(1);
  });

  it('yields an empty id set (no matches), not the unfiltered list, when nothing has that origin', async () => {
    state.ids.mockResolvedValue([]);
    await readPublishingPostPage(actor, { origin: 'recipe' });
    expect(state.page.mock.calls[0]![5].where.AND).toContainEqual({ id: { in: [] } });
  });

  it('refuses unknown or malformed origins instead of ignoring them', async () => {
    await expect(readPublishingPostPage(actor, { origin: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(() => parsePostOrigin(5)).toThrow();
    expect(parsePostOrigin('')).toBeUndefined();
  });

  it('applies the same filter to the bounded MCP/REST list, combined with the authorization scope', async () => {
    await readPublishingPostList(actor, { origin: 'recipe', status: 'published' });
    const clauses = state.findMany.mock.calls[0]![0].where.AND[0].AND;
    expect(clauses).toContainEqual({ id: { in: ['p1', 'p2', 'p3'] } });
    expect(clauses[0]).toEqual({ workspaceId: 'workspace' });
    await expect(readPublishingPostList(actor, { origin: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
