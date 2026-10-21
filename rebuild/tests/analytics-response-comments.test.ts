import { describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ target: { findFirst: vi.fn() }, $queryRaw: vi.fn(), postComment: { findMany: vi.fn() }, conversationMessage: { findMany: vi.fn() }, user: { findMany: vi.fn() } }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', async () => { const { responseTimeCopyDefaults } = await import('../src/modules/analytics/reports/generation/response-copy'); return { runtimeConfig: async (key: string) => key === 'analytics.reports.responseMessageLimit' ? 100 : key === 'analytics.reports.responseEventLimit' ? 100 : key === 'analytics.reports.responseMemberLimit' ? 1 : responseTimeCopyDefaults }; });
import { commentResponseMessages, readResponseTime, summarizeResponseTimes, type ResponseComment } from '../src/modules/analytics/reports/generation/response-time';
const at = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour));
const end = at(24);
const row = (remoteId: string, hour: number, patch: Partial<ResponseComment> = {}): ResponseComment => ({ postTargetId: 'post-a', remoteId, parentRemoteId: null, fromId: 'visitor', sentById: null, createdTime: at(hour), resolvedAt: null, ...patch });
describe('comment first-response report coverage', () => {
  it('counts only the first direct channel reply, recognizes app replies, and excludes visitor nested replies', () => {
    const messages = commentResponseMessages([
      row('root', 9), row('visitor-reply', 10, { parentRemoteId: 'root' }),
      row('late', 12, { parentRemoteId: 'root', fromId: 'channel' }),
      row('first', 11, { parentRemoteId: 'root', fromId: null, sentById: 'member' }),
      row('root-unanswered', 10), row('channel-root', 10, { fromId: 'channel' }),
    ], 'channel', end);
    expect(summarizeResponseTimes(messages)).toMatchObject({ answered: 1, unanswered: 1, medianMs: 2 * 3600000, members: [{ memberId: 'member', answered: 1 }] });
  });
  it('separates identical remote IDs on different posts and ignores replies before the question', () => {
    const messages = commentResponseMessages([row('same', 9), row('same', 10, { postTargetId: 'post-b' }), row('reply', 11, { parentRemoteId: 'same', postTargetId: 'post-b', fromId: 'channel' }), row('old', 8, { parentRemoteId: 'same', fromId: 'channel' })], 'channel', end);
    expect(summarizeResponseTimes(messages)).toMatchObject({ answered: 1, unanswered: 1, medianMs: 3600000 });
  });
  it('does not count responses or resolutions at or after the report boundary', () => {
    const messages = commentResponseMessages([row('root', 9, { resolvedAt: end }), row('reply', 24, { parentRemoteId: 'root', fromId: 'channel' })], 'channel', end);
    expect(summarizeResponseTimes(messages)).toMatchObject({ answered: 0, unanswered: 1, resolve: { resolved: 0, unresolved: 1, medianMs: null } });
  });
  it('combines comments and conversations and computes slowest and resolution business durations', () => {
    const comments = commentResponseMessages([row('root', 8, { resolvedAt: at(12) }), row('reply', 11, { parentRemoteId: 'root', fromId: 'channel' })], 'channel', end);
    const summary = summarizeResponseTimes([...comments, { conversationId: 'conversation:x', createdTime: at(10), fromChannel: false, resolvedAt: at(11) }, { conversationId: 'conversation:x', createdTime: at(11), fromChannel: true }], false, { hours: { days: [4], start: 9, end: 18 }, timeZone: 'UTC' });
    expect(summary).toMatchObject({ answered: 2, medianMs: 2 * 3600000, slowestMs: 3 * 3600000, businessSlowestMs: 2 * 3600000, businessMedianMs: 1.5 * 3600000, resolve: { businessMedianMs: 2 * 3600000 } });
  });
});

it('reads both sources under tenant/channel bounds, flags source truncation and excludes later conversation resolution', async () => {
  db.target.findFirst.mockResolvedValue({ providerId: 'channel' });
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('root_activities') ? [] : [{ timezone: 'UTC', businessDays: [] }]);
  db.conversationMessage.findMany.mockResolvedValue([{ conversationId: 'c', createdTime: at(8), fromId: 'visitor', sentById: null, conversation: { resolvedAt: at(25) } }]);
  db.postComment.findMany.mockResolvedValue([row('root', 9), row('reply', 11, { parentRemoteId: 'root', fromId: 'channel' }), ...Array.from({ length: 99 }, (_, i) => row(`own-${i}`, 12, { fromId: 'channel' }))]);
  const summary = await readResponseTime('workspace', 'target', { start: '2026-10-01', end: '2026-10-01' });
  expect(summary).toMatchObject({ answered: 0, unanswered: 1, partial: true, comments: { answered: 0, unanswered: 0 }, conversations: { answered: 0, unanswered: 1 }, resolve: { resolved: 0, unresolved: 1 } });
  expect(db.postComment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { createdTime: { lt: end }, postTarget: { targetId: 'target', target: { workspaceId: 'workspace' } } }, take: 101 }));
});

it('reads separate source durations and member business medians through the shared scoped reader', async () => {
  db.target.findFirst.mockResolvedValue({ providerId: 'channel' });
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('').includes('root_activities') ? [] : [{ timezone: 'UTC', businessDays: [4], businessStart: 9, businessEnd: 18 }]);
  db.user.findMany.mockResolvedValue([{ id: 'member', name: 'Example member' }]);
  db.conversationMessage.findMany.mockResolvedValue([
    { conversationId: 'c', createdTime: at(8), fromId: 'visitor', sentById: null, conversation: { resolvedAt: at(12) } },
    { conversationId: 'c', createdTime: at(10), fromId: 'channel', sentById: 'member', conversation: { resolvedAt: at(12) } },
  ]);
  db.postComment.findMany.mockResolvedValue([row('root', 17), row('reply', 20, { parentRemoteId: 'root', fromId: 'channel', sentById: 'member' })]);
  const summary = await readResponseTime('workspace', 'target', { start: '2026-10-01', end: '2026-10-01' });
  expect(summary.conversations).toMatchObject({ total: 1, answeredPercent: 100, medianMs: 2 * 3600000, businessMedianMs: 3600000, resolve: { resolved: 1, businessMedianMs: 3 * 3600000 } });
  expect(summary.comments).toMatchObject({ total: 1, answeredPercent: 100, medianMs: 3 * 3600000, businessMedianMs: 3600000, resolve: { unresolved: 1, medianMs: null } });
  expect(summary.members).toMatchObject([{ memberId: 'member', answered: 2, medianMs: 2.5 * 3600000, businessMedianMs: 3600000 }]);
});
