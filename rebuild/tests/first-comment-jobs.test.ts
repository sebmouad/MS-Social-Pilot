import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<{ postId: string; postTargetId: string; workspaceId: string; authorId: string; provider: string; publishedAt: Date; firstCommentDelayMinutes: number }>,
  cursor: '' as string,
  limit: 3,
  maxDelay: 10080,
  send: vi.fn(),
  access: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('@/server/data', () => ({ prisma: {
  appSetting: {
    findUnique: vi.fn(async () => state.cursor ? { value: state.cursor } : null),
    upsert: vi.fn(async ({ update }: { update: { value: string } }) => { state.cursor = update.value; }),
  },
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => state.queryRaw(strings, ...values),
} }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'sync.maxItemsPerJob' ? state.limit : key === 'publishing.maxFirstCommentDelayMinutes' ? state.maxDelay : undefined }));
vi.mock('@/modules/publishing/server/first-comment', () => ({ sendDueFirstComment: state.send }));
vi.mock('@/server/jobs/access', () => ({ assertWorkspaceJobAccess: state.access }));

import { decodeFirstCommentCursor, encodeFirstCommentCursor, runDueFirstComments } from '@/modules/publishing/server/first-comment-jobs';

describe('due first-comment job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.cursor = '';
    state.limit = 3;
    state.maxDelay = 10080;
    state.rows = [
      { postId: 'post-1', postTargetId: 'destination-1', workspaceId: 'workspace-a', authorId: 'original-author-a', provider: 'synthetic-provider', publishedAt: new Date('2026-10-19T10:00:00.000Z'), firstCommentDelayMinutes: 0 },
      { postId: 'post-2', postTargetId: 'destination-2', workspaceId: 'workspace-b', authorId: 'original-author-b', provider: 'synthetic-provider', publishedAt: new Date('2026-10-19T10:05:00.000Z'), firstCommentDelayMinutes: 5 },
      { postId: 'post-3', postTargetId: 'destination-3', workspaceId: 'workspace-c', authorId: 'original-author-c', provider: 'synthetic-provider', publishedAt: new Date('2026-10-19T10:10:00.000Z'), firstCommentDelayMinutes: 30 },
    ];
    state.queryRaw.mockImplementation(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const now = values[1] as Date;
      const cursorTime = values[2] as Date | string | null;
      const cursorId = values[4] as string | null;
      const take = values[5] as number;
      return state.rows.filter(row => row.firstCommentDelayMinutes <= (values[0] as number) &&
        row.publishedAt.getTime() + row.firstCommentDelayMinutes * 60000 <= now.getTime() &&
        (!cursorTime || row.publishedAt.getTime() > new Date(cursorTime).getTime() || row.publishedAt.getTime() === new Date(cursorTime).getTime() && row.postTargetId > (cursorId ?? '')))
        .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime() || a.postTargetId.localeCompare(b.postTargetId)).slice(0, take);
    });
    state.send.mockImplementation(async (actor: { userId: string }, input: { postTargetId: string }) => ({ state: input.postTargetId === 'destination-1' ? 'sent' : input.postTargetId === 'destination-2' ? 'needs_review' : 'ready', actor }));
    state.access.mockResolvedValue(undefined);
  });

  it('uses the original author and bounds scans by due time and configured batch size', async () => {
    const now = new Date('2026-10-19T10:20:00.000Z');
    const result = await runDueFirstComments(now);
    expect(result).toEqual({ examined: 2, sent: 1, held: 1, skipped: 0, failed: 0 });
    expect(state.send).toHaveBeenCalledTimes(2);
    expect(state.send).toHaveBeenNthCalledWith(1, { userId: 'original-author-a', workspaceId: 'workspace-a' }, { postId: 'post-1', postTargetId: 'destination-1' }, now);
    expect(state.send).toHaveBeenNthCalledWith(2, { userId: 'original-author-b', workspaceId: 'workspace-b' }, { postId: 'post-2', postTargetId: 'destination-2' }, now);
    expect(state.access).toHaveBeenNthCalledWith(1, 'workspace-a', { provider: 'synthetic-provider', anyFeatureOf: ['publishing/posts'] });
    expect(state.access).toHaveBeenNthCalledWith(2, 'workspace-b', { provider: 'synthetic-provider', anyFeatureOf: ['publishing/posts'] });
    expect(JSON.parse(state.cursor)).toEqual(['2026-10-19T10:05:00.000Z', 'destination-2']);
  });

  it('counts a ready rejection as skipped and never dispatches it again in the same scan', async () => {
    state.rows = state.rows.slice(0, 1);
    state.send.mockResolvedValue({ state: 'ready' });
    await expect(runDueFirstComments(new Date('2026-10-19T10:20:00.000Z'))).resolves.toEqual({ examined: 1, sent: 0, held: 0, skipped: 1, failed: 0 });
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it('wraps the ordered cursor and deduplicates rows on the wrapped edge', async () => {
    state.limit = 2;
    state.cursor = JSON.stringify([state.rows[1]!.publishedAt.toISOString(), state.rows[1]!.postTargetId]);
    const now = new Date('2026-10-19T11:00:00.000Z');
    await expect(runDueFirstComments(now)).resolves.toEqual({ examined: 2, sent: 1, held: 0, skipped: 1, failed: 0 });
    expect(state.send).toHaveBeenNthCalledWith(1, { userId: 'original-author-c', workspaceId: 'workspace-c' }, { postId: 'post-3', postTargetId: 'destination-3' }, now);
    expect(state.send).toHaveBeenNthCalledWith(2, { userId: 'original-author-a', workspaceId: 'workspace-a' }, { postId: 'post-1', postTargetId: 'destination-1' }, now);
    expect(JSON.parse(state.cursor)).toEqual(['2026-10-19T10:00:00.000Z', 'destination-1']);
  });

  it('encodes a bounded ordered cursor without truncating destination IDs', () => {
    const row = { publishedAt: new Date('2026-10-19T12:00:00.000Z'), postTargetId: 'destination' };
    expect(encodeFirstCommentCursor(row)).toBe('["2026-10-19T12:00:00.000Z","destination"]');
    expect(decodeFirstCommentCursor(encodeFirstCommentCursor(row))).toEqual({ publishedAt: '2026-10-19T12:00:00.000Z', postTargetId: 'destination' });
    expect(decodeFirstCommentCursor('x'.repeat(4097))).toBeNull();
    expect(decodeFirstCommentCursor('["not-date","destination"]')).toBeNull();
    expect(() => encodeFirstCommentCursor({ ...row, postTargetId: 'x'.repeat(2049) })).toThrow();
  });
});
