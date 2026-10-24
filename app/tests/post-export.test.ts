import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), config: vi.fn(), query: vi.fn(), transaction: vi.fn(), transactionOptions: null as unknown }));
vi.mock('../src/server/data', () => ({ prisma: {
  $transaction: mocks.transaction,
} }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/modules/publishing/server/read-query', () => ({ publishingPostReadQuery: mocks.query }));

import { exportPublishingPosts } from '../src/modules/publishing/server/export';
import { OperationError } from '../src/lib/operation-error';

const actor = { userId: 'user-a', workspaceId: 'workspace-a', allowedTargetIds: ['channel-a'] };
const post = (overrides: Record<string, unknown> = {}) => ({
  id: 'post-a', authorId: 'user-a', message: 'Hello, world', firstComment: null, firstCommentDelayMinutes: 0, link: null,
  media: [{ kind: 'image', url: 'https://example.test/a.jpg', altText: 'Photo' }], status: 'published',
  scheduledAt: null, publishedAt: new Date('2026-10-01T12:00:00.000Z'), createdAt: new Date('2026-09-30T12:00:00.000Z'),
  targets: [{ id: 'post-target-a', status: 'published', remotePostId: 'remote-a', remoteUrl: 'https://example.test/post', firstCommentId: null,
    firstCommentAt: null, firstCommentError: null, target: { id: 'channel-a', name: 'Channel A', type: 'page' } }],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockImplementation(async (key: string) => ({ 'publishing.exportMaxPosts': 5000, 'publishing.exportMaxBytes': 10_485_760,
    'publishing.exportBatchSize': 100, 'publishing.transactionTimeoutMs': 15000, 'publishing.transactionMaxWaitMs': 5000 }[key]));
  mocks.query.mockImplementation(async (_actor: unknown, input: Record<string, string>) => ({
    where: { workspaceId: 'workspace-a', OR: [{ targets: { some: { targetId: 'channel-a' } } }] },
    filters: { ...(input.status ? { status: input.status } : {}), ...(input.channelId ? { channelId: input.channelId } : {}), q: input.q ?? '' },
    channelUnavailable: false,
  }));
  mocks.findMany.mockResolvedValue([post()]);
  mocks.transaction.mockImplementation(async (work: (tx: { post: { findMany: typeof mocks.findMany } }) => unknown, options: unknown) => {
    mocks.transactionOptions = options;
    return work({ post: { findMany: mocks.findMany } });
  });
});

describe('Publishing posts CSV export', () => {
  it('reuses the current scoped read query and projects one safe row per post', async () => {
    const result = await exportPublishingPosts(actor, { q: 'HELLO', status: 'published', channelId: 'channel-a' });
    expect(mocks.query).toHaveBeenCalledWith(actor, { q: 'HELLO', status: 'published', channelId: 'channel-a' }, 'publishing/posts');
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspaceId: 'workspace-a' }), take: 100,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: expect.objectContaining({ id: true, message: true, firstComment: true, firstCommentDelayMinutes: true, media: true, targets: expect.any(Object) }),
    }));
    expect(result).toMatchObject({ format: 'ms-social-pilot-posts-csv', version: 1, fileName: 'posts.csv', postCount: 1, filters: { q: 'HELLO', status: 'published', channelId: 'channel-a' }, channelUnavailable: false });
    expect(result.byteLength).toBe(Buffer.byteLength(result.csv, 'utf8'));
    expect(result.csv.split('\r\n')).toHaveLength(3);
    expect(result.csv).toContain('Channel A');
    expect(result.csv).toContain('remote-a');
    expect(result.csv.split('\r\n')[0]).toContain('firstCommentDelayMinutes');
    expect(result.csv).not.toContain('firstCommentError');
    expect(mocks.transactionOptions).toMatchObject({ isolationLevel: 'RepeatableRead', timeout: 15000, maxWait: 5000 });
  });

  it('includes all media and normalized first-comment state while excluding raw errors', async () => {
    mocks.findMany.mockResolvedValue([post({ firstComment: 'Follow up', media: [
      { kind: 'image', url: 'https://example.test/a.jpg', altText: 'A' }, { kind: 'video', url: 'https://example.test/b.mp4' },
    ], targets: [{ id: 'pt', status: 'published', remotePostId: 'remote', remoteUrl: null, firstCommentId: null,
      firstCommentAt: new Date('2026-10-02T00:00:00Z'), firstCommentError: 'private provider response token=secret',
      target: { id: 'channel-a', name: 'Channel A', type: 'page' } }] })]);
    const result = await exportPublishingPosts(actor);
    expect(result.csv).toContain('https://example.test/a.jpg');
    expect(result.csv).toContain('https://example.test/b.mp4');
    expect(result.csv).toContain('needs_review');
    expect(result.csv).toContain('true');
    expect(result.csv).not.toMatch(/private provider response|secret/);
  });

  it('exports the configured first-comment delay as a distinct field', async () => {
    mocks.findMany.mockResolvedValue([post({ firstComment: 'Follow up', firstCommentDelayMinutes: 45 })]);
    const result = await exportPublishingPosts(actor);
    expect(result.csv.split('\r\n')[0]).toContain('firstCommentDelayMinutes');
    expect(result.csv.split('\r\n')[1]).toContain('"45"');
  });

  it('refuses the whole export when matching posts exceed the configured ceiling', async () => {
    mocks.config.mockImplementation(async (key: string) => ({ 'publishing.exportMaxPosts': 1, 'publishing.exportMaxBytes': 10_485_760,
      'publishing.exportBatchSize': 100, 'publishing.transactionTimeoutMs': 15000, 'publishing.transactionMaxWaitMs': 5000 }[key]));
    mocks.findMany.mockResolvedValue([post(), post({ id: 'post-b' })]);
    await expect(exportPublishingPosts(actor)).rejects.toThrow(/narrow.*filter/i);
    expect(mocks.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 2 }));
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });

  it('accepts a complete result that exactly reaches the post ceiling', async () => {
    mocks.config.mockImplementation(async (key: string) => ({ 'publishing.exportMaxPosts': 1, 'publishing.exportMaxBytes': 10_485_760,
      'publishing.exportBatchSize': 100, 'publishing.transactionTimeoutMs': 15000, 'publishing.transactionMaxWaitMs': 5000 }[key]));
    mocks.findMany.mockResolvedValue([post()]);
    await expect(exportPublishingPosts(actor)).resolves.toMatchObject({ postCount: 1 });
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
  });

  it('refuses a CSV over its UTF-8 byte ceiling and reports no partial content', async () => {
    mocks.config.mockImplementation(async (key: string) => ({ 'publishing.exportMaxPosts': 5000, 'publishing.exportMaxBytes': 1024,
      'publishing.exportBatchSize': 1, 'publishing.transactionTimeoutMs': 15000, 'publishing.transactionMaxWaitMs': 5000 }[key]));
    mocks.findMany.mockResolvedValue([post({ message: 'x'.repeat(3000) })]);
    await expect(exportPublishingPosts(actor)).rejects.toThrow(/narrow.*filter/i);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });

  it('exports stable multi-batch results in one repeatable-read snapshot', async () => {
    mocks.config.mockImplementation(async (key: string) => ({ 'publishing.exportMaxPosts': 10, 'publishing.exportMaxBytes': 100_000,
      'publishing.exportBatchSize': 2, 'publishing.transactionTimeoutMs': 15000, 'publishing.transactionMaxWaitMs': 5000 }[key]));
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id, index) => post({ id: `post-${id}`, createdAt: new Date(`2026-10-0${5 - index}T00:00:00.000Z`) }));
    mocks.findMany.mockReset().mockResolvedValueOnce(rows.slice(0, 2)).mockResolvedValueOnce(rows.slice(2, 4)).mockResolvedValueOnce(rows.slice(4));
    const result = await exportPublishingPosts(actor);
    expect(result.postCount).toBe(5);
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(result.csv).toContain(`post-${id}`);
    expect(mocks.findMany).toHaveBeenCalledTimes(3);
    expect(mocks.findMany.mock.calls[1][0]).toMatchObject({ where: { AND: [expect.any(Object), { OR: expect.any(Array) }] }, take: 2 });
  });

  it('accepts an export whose UTF-8 output exactly reaches the byte ceiling', async () => {
    const result = await exportPublishingPosts(actor);
    mocks.config.mockImplementation(async (key: string) => key === 'publishing.exportMaxBytes' ? result.byteLength
      : ({ 'publishing.exportMaxPosts': 5000, 'publishing.exportBatchSize': 100, 'publishing.transactionTimeoutMs': 15000, 'publishing.transactionMaxWaitMs': 5000 }[key]));
    await expect(exportPublishingPosts(actor)).resolves.toMatchObject({ byteLength: result.byteLength });
  });

  it('preserves Unicode, embedded newlines and quotes while neutralizing spreadsheet formulas', async () => {
    mocks.findMany.mockResolvedValue([post({ message: '  =SUM(1,2), "café"\r\nsecond line', firstComment: '\t@danger', link: '\uFEFF-1' })]);
    const result = await exportPublishingPosts(actor);
    expect(result.csv).toContain('\'  =SUM(1,2), ""café""\r\nsecond line');
    expect(result.csv).toContain('"\'\t@danger"');
    expect(result.csv).toContain('"\'\uFEFF-1"');
    expect(result.csv).toContain('café');
    expect(result.csv).toMatch(/\r\n/);
  });

  it('rejects unknown filters, invalid optional caps, and never queries for invalid input', async () => {
    await expect(exportPublishingPosts(actor, { workspaceId: 'spoofed' })).rejects.toBeInstanceOf(OperationError);
    await expect(exportPublishingPosts(actor, {}, { maxItems: 0 })).rejects.toBeInstanceOf(OperationError);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
