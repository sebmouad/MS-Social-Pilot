import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_COMMENT_REJECTED } from '../src/modules/publishing/first-comment-state';

const state = vi.hoisted(() => ({
  authorize: vi.fn(), selected: vi.fn(), page: vi.fn(), calendar: vi.fn(), targets: vi.fn(), findMany: vi.fn(), count: vi.fn(),
  config: vi.fn(),
}));
vi.mock('../src/modules/publishing/server/access', () => ({ authorizePublishing: state.authorize }));
vi.mock('../src/modules/publishing/server/read-scope', () => ({
  selectedPublishingTargetIds: state.selected,
  publishingPostVisibilityWhere: (workspaceId: string, targetIds?: readonly string[] | null, authorId?: string) => ({
    workspaceId, OR: [
      { targets: { some: { targetId: { in: [...(targetIds ?? [])] } }, every: { targetId: { in: [...(targetIds ?? [])] } } } },
    ...(authorId ? [{ targets: { none: {} }, authorId }] : targetIds == null ? [] : [{ targets: { none: {} } }]),
    ],
  }),
}));
vi.mock('../src/server/data', () => ({
  prisma: { post: { findMany: state.findMany, count: state.count } }, listPostPage: state.page, listCalendarRange: state.calendar, getTargets: state.targets,
}));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));

import { readPublishingCalendar, readPublishingPostList, readPublishingPostPage, readPublishingSummary } from '../src/modules/publishing/server/read';

const actor = { userId: 'reader', workspaceId: 'workspace' };
const allowedActor = { ...actor, allowedTargetIds: ['selected-a', 'selected-b'] };
const access = (user: { userId: string; workspaceId: string; allowedTargetIds?: string[] } = allowedActor) => ({ actor: user, entitlements: { workspaceId: 'workspace', modules: { publishing: true }, features: { 'publishing/posts': true } } });

beforeEach(() => {
  vi.clearAllMocks();
  state.count.mockReset();
  state.authorize.mockImplementation(async (_actor, _feature, permission) => {
    if (permission === 'read') return access(_actor);
    return access(_actor);
  });
  state.selected.mockResolvedValue(['selected-a', 'selected-b']);
  state.page.mockResolvedValue({ posts: [], total: 0, page: 1, pages: 1 });
  state.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2);
  state.calendar.mockResolvedValue([]); state.targets.mockResolvedValue([]); state.findMany.mockResolvedValue([]);
  state.config.mockImplementation(async (key: string) => ({
    'publishing.identifierMaxCharacters': 200, 'publishing.postPageSize': 50,
    'publishing.readMaxItems': 200, 'publishing.calendarMaxRangeDays': 70, 'publishing.searchMaxCharacters': 200,
  }[key]));
});

describe('shared Publishing read service', () => {
  it('rechecks the requested feature and resolves selected channels with current caller intersection', async () => {
    await readPublishingPostPage(allowedActor, {}, 'publishing/posts');
    expect(state.authorize).toHaveBeenCalledWith(allowedActor, 'publishing/posts', 'read');
    expect(state.selected).toHaveBeenCalledWith('workspace', expect.any(Object), ['selected-a', 'selected-b']);
    expect(state.page).toHaveBeenCalledWith('workspace', 1, 50, ['selected-a', 'selected-b'], 'reader', expect.objectContaining({ where: expect.objectContaining({ AND: expect.any(Array) }) }));

    state.authorize.mockResolvedValueOnce(access({ ...actor, allowedTargetIds: [] }));
    state.selected.mockResolvedValueOnce([]);
    await readPublishingPostPage({ ...actor, allowedTargetIds: [] });
    expect(state.selected).toHaveBeenLastCalledWith('workspace', expect.any(Object), []);
  });

  it('uses unrestricted post permission for connected posts while limiting unconnected drafts to the caller', async () => {
    state.authorize.mockResolvedValueOnce(access(actor));
    await readPublishingPostPage(actor);
    expect(state.page.mock.calls[0]?.[5]?.where.AND?.[0].OR).toEqual(expect.arrayContaining([expect.objectContaining({ targets: { none: {} } })]));
    state.authorize.mockResolvedValueOnce(access({ ...actor, allowedTargetIds: ['selected-a'] }));
    await readPublishingPostPage({ ...actor, allowedTargetIds: ['selected-a'] });
    expect(state.page.mock.calls[1]?.[5]?.where.AND?.[0].OR).toEqual(expect.arrayContaining([expect.objectContaining({ authorId: 'reader' })]));
  });

  it('passes normalized literal text search to the paged data query', async () => {
    await readPublishingPostPage(allowedActor, { q: '  Café 50%  ' });
    const where = state.page.mock.calls[0]?.[5]?.where;
    expect(where.AND).toEqual(expect.arrayContaining([{ OR: [
      { message: { contains: 'Café 50\\%', mode: 'insensitive' } },
      { firstComment: { contains: 'Café 50\\%', mode: 'insensitive' } },
    ] }]));
  });

  it('counts Home posts with the same current selected-channel and member scope as Posts', async () => {
    const result = await readPublishingSummary(allowedActor);
    expect(result).toEqual({ published: 4, scheduled: 2 });
    expect(state.authorize).toHaveBeenCalledWith(allowedActor, 'publishing/posts', 'read');
    expect(state.count).toHaveBeenNthCalledWith(1, { where: { AND: [expect.objectContaining({ workspaceId: 'workspace', OR: expect.any(Array) }), { status: 'published' }] } });
    expect(state.count.mock.calls[0]?.[0].where.AND[0].OR[0].targets.every.targetId.in).toEqual(['selected-a', 'selected-b']);
    expect(state.count).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ AND: expect.arrayContaining([{ status: 'scheduled' }]) }) }));
  });

  it.each(['publishing/calendar', 'publishing/posts'])('denies unavailable %s before selected content reads', async feature => {
    state.authorize.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'forbidden' }));
    const read = feature === 'publishing/calendar'
      ? readPublishingCalendar(actor, { from: new Date('2026-10-01Z'), to: new Date('2026-10-02Z') })
      : readPublishingPostPage(actor);
    await expect(read).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.selected).not.toHaveBeenCalled(); expect(state.page).not.toHaveBeenCalled(); expect(state.calendar).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'PUBLISHED' }, { status: 'published,scheduled' }, { page: 0 }, { page: 1.25 }, { channelId: ' selected-a' },
    { order: 'random' },
  ])('rejects invalid page filters before database reads: %j', async input => {
    await expect(readPublishingPostPage(actor, input as never)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.page).not.toHaveBeenCalled();
  });

  it('validates bounded calendar filters and passes only exact valid status and ISO dates', async () => {
    const from = new Date('2026-10-01T00:00:00.000Z'); const to = new Date('2026-10-31T00:00:00.000Z');
    await readPublishingCalendar(actor, { from, to, channelId: 'selected-a', status: 'scheduled' });
    expect(state.calendar).toHaveBeenCalledWith('workspace', from, to, ['selected-a', 'selected-b'], undefined, { channelId: 'selected-a', status: 'scheduled' });
    for (const range of [
      { from: new Date('2026-10-02Z'), to: new Date('2026-10-01Z') },
      { from: new Date('invalid'), to }, { from, to: new Date(from.getTime() + 70 * 86400000 + 1) },
    ]) await expect(readPublishingCalendar(actor, range)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(readPublishingCalendar(actor, { from, to, status: 'PUBLISHED' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.calendar).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 'published, bogus' }, { from: '2026-02-30' }, { from: 'Oct 1 2026' }, { to: '2026-10-01T00:00:00' },
    { from: '2026-10-02', to: '2026-10-01' }, { limit: '2' }, { channelId: 'x'.repeat(201) }, { unknown: true },
  ])('rejects invalid bounded MCP list input before content queries: %j', async input => {
    await expect(readPublishingPostList(actor, input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.findMany).not.toHaveBeenCalled();
  });

  it('caps trusted caller limits, returns bounded selected-resource rows, and redacts provider error text', async () => {
    state.authorize.mockResolvedValueOnce(access(actor));
    state.findMany.mockResolvedValueOnce([{ id: 'p', targets: [{ firstCommentError: 'provider secret detail' }, { firstCommentError: FIRST_COMMENT_REJECTED }] }]);
    const result = await readPublishingPostList(actor, { status: 'published,scheduled', from: '2026-10-01', to: '2026-10-31', limit: 100, q: '  match  ' }, { maxItems: 25 });
    expect(state.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25, where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ workspaceId: 'workspace' })]) })]) }) }));
    expect(result[0]?.targets).toEqual([{ firstCommentError: 'review_required' }, { firstCommentError: FIRST_COMMENT_REJECTED }]);
    const query = state.findMany.mock.calls[0]?.[0];
    expect(query.where.AND[0].AND[0].OR[0].targets.every.targetId.in).toEqual(['selected-a', 'selected-b']);
    expect(query.where.AND[0].AND).toContainEqual({ OR: [
      { message: { contains: 'match', mode: 'insensitive' } },
      { firstComment: { contains: 'match', mode: 'insensitive' } },
    ] });
    expect(query.where.AND).toEqual(expect.arrayContaining([
      { status: { in: ['published', 'scheduled'] } },
      { scheduledAt: { gte: new Date('2026-10-01T00:00:00Z'), lte: new Date('2026-10-31T00:00:00Z') } },
    ]));
  });
});
