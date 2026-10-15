import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPost: vi.fn(), updatePost: vi.fn(), schedulePost: vi.fn(), publishPost: vi.fn(), submitPostForApproval: vi.fn(),
  findPost: vi.fn(), findTargets: vi.fn(),
}));
vi.mock('../src/server/publishing/lifecycle', () => ({
  createPost: mocks.createPost, updatePost: mocks.updatePost, schedulePost: mocks.schedulePost,
  publishPost: mocks.publishPost, submitPostForApproval: mocks.submitPostForApproval,
}));
vi.mock('../src/server/data', () => ({ prisma: { post: { findFirst: mocks.findPost }, target: { findMany: mocks.findTargets } } }));

import { ComposeFollowUpError, composePost, parseAttachment, parseIntent } from '../src/server/publishing/compose';

const actor = { userId: 'u1', workspaceId: 'w1' };
const base = { message: 'Hello', firstComment: '', attachment: { kind: 'none' as const }, targetIds: ['t1'], timeZone: 'Europe/Paris' };
const NOW = new Date('2026-10-15T10:00:00Z');
const uuid = '123e4567-e89b-42d3-a456-426614174000';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createPost.mockResolvedValue({ id: 'p-new' });
  mocks.findTargets.mockResolvedValue([{ socialAccount: { provider: 'facebook' } }]);
  mocks.publishPost.mockResolvedValue({ published: 1, failed: 0, needsReconciliation: 0 });
});

describe('composer attachment parsing', () => {
  const form = (values: Record<string, string>) => (name: string) => values[name] ?? '';

  it('accepts one format and rejects missing or conflicting values', () => {
    expect(parseAttachment(form({ attachmentKind: 'none' }))).toEqual({ kind: 'none' });
    expect(parseAttachment(form({ attachmentKind: 'link', link: ' https://example.com ' }))).toEqual({ kind: 'link', link: 'https://example.com' });
    expect(parseAttachment(form({ attachmentKind: 'video', videoUrl: 'https://example.com/v.mp4' }))).toEqual({ kind: 'video', url: 'https://example.com/v.mp4' });
    expect(parseAttachment(form({ attachmentKind: 'image', imageRef: `media:${uuid}`, altText: ' A chart ' }))).toEqual({ kind: 'image', reference: `media:${uuid}`, url: '', altText: 'A chart' });
    expect(() => parseAttachment(form({ attachmentKind: 'link' }))).toThrow(/link/);
    expect(() => parseAttachment(form({ attachmentKind: 'image' }))).toThrow(/Choose an image/);
    expect(() => parseAttachment(form({ attachmentKind: 'image', imageRef: `media:${uuid}`, imageUrl: 'https://example.com/a.png' }))).toThrow(/not both/);
    expect(() => parseAttachment(form({ attachmentKind: 'image', imageRef: 'media:not-an-id' }))).toThrow(/choose it again/);
    expect(() => parseAttachment(form({ attachmentKind: 'gif' }))).toThrow(/valid attachment/);
  });

  it('only accepts known intents', () => {
    expect(parseIntent('schedule')).toBe('schedule');
    expect(() => parseIntent('delete')).toThrow();
    expect(() => parseIntent(null)).toThrow();
  });
});

describe('composePost', () => {
  it('saves a new draft without any follow-up step and allows no channels', async () => {
    const result = await composePost(actor, { ...base, targetIds: [], intent: 'draft' }, NOW);
    expect(result).toEqual({ postId: 'p-new', notice: 'created' });
    expect(mocks.createPost).toHaveBeenCalledWith(actor, expect.objectContaining({ message: 'Hello', targetIds: [], link: '', media: [] }));
    expect(mocks.publishPost).not.toHaveBeenCalled();
    expect(mocks.schedulePost).not.toHaveBeenCalled();
  });

  it('updates an existing draft instead of creating another', async () => {
    const result = await composePost(actor, { ...base, postId: 'p1', intent: 'draft' }, NOW);
    expect(result).toEqual({ postId: 'p1', notice: 'updated' });
    expect(mocks.updatePost).toHaveBeenCalledWith(actor, expect.objectContaining({ postId: 'p1' }));
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it('requires a channel before publishing, scheduling, or submitting and saves nothing', async () => {
    for (const intent of ['publish', 'schedule', 'approval'] as const) {
      await expect(composePost(actor, { ...base, targetIds: [], intent, scheduledLocal: '2026-10-20T09:00' }, NOW)).rejects.toThrow(/at least one channel/);
    }
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it('schedules at the workspace wall-clock time and validates it before saving', async () => {
    const result = await composePost(actor, { ...base, intent: 'schedule', scheduledLocal: '2026-10-20T09:00' }, NOW);
    expect(result.notice).toBe('scheduled');
    expect(mocks.schedulePost).toHaveBeenCalledWith(actor, 'p-new', new Date('2026-10-20T07:00:00.000Z'));

    mocks.createPost.mockClear();
    await expect(composePost(actor, { ...base, intent: 'schedule', scheduledLocal: '' }, NOW)).rejects.toThrow(/valid publishing date/);
    await expect(composePost(actor, { ...base, intent: 'schedule', scheduledLocal: '2026-10-15T11:00' }, NOW)).rejects.toThrow(/future/);
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it('submits for approval and publishes now through the lifecycle', async () => {
    expect((await composePost(actor, { ...base, intent: 'approval' }, NOW)).notice).toBe('submitted');
    expect(mocks.submitPostForApproval).toHaveBeenCalledWith(actor, 'p-new');
    expect((await composePost(actor, { ...base, intent: 'publish' }, NOW)).notice).toBe('published');
    mocks.publishPost.mockResolvedValue({ published: 1, failed: 1, needsReconciliation: 0 });
    expect((await composePost(actor, { ...base, intent: 'publish' }, NOW)).notice).toBe('publish-review');
  });

  it('keeps the saved post id when the follow-up step fails so a retry cannot duplicate it', async () => {
    mocks.publishPost.mockRejectedValue(new Error('One or more destinations are unavailable or cannot publish.'));
    const failure = await composePost(actor, { ...base, intent: 'publish' }, NOW).catch(error => error);
    expect(failure).toBeInstanceOf(ComposeFollowUpError);
    expect(failure.postId).toBe('p-new');
    expect(failure.message).toMatch(/unavailable/);
  });

  it('enforces the selected platforms\' own limits before saving anything', async () => {
    await expect(composePost(actor, { ...base, intent: 'draft', message: 'x'.repeat(63207) }, NOW)).rejects.toThrow(/63,206 characters/);
    await composePost(actor, { ...base, intent: 'draft', message: 'x'.repeat(63206) }, NOW);
    mocks.findTargets.mockResolvedValue([{ socialAccount: { provider: 'unknown-network' } }]);
    await composePost(actor, { ...base, intent: 'draft', message: 'x'.repeat(63207) }, NOW);
    expect(mocks.createPost).toHaveBeenCalledTimes(2);
  });

  it('passes the chosen attachment and keeps stored media for an untouched edit', async () => {
    await composePost(actor, { ...base, intent: 'draft', attachment: { kind: 'image', reference: `media:${uuid}`, url: '', altText: 'Alt' } }, NOW);
    expect(mocks.createPost).toHaveBeenLastCalledWith(actor, expect.objectContaining({ link: '', media: [{ kind: 'image', url: `media:${uuid}`, altText: 'Alt' }] }));

    mocks.findPost.mockResolvedValue({ link: null, media: [{ kind: 'image', url: `media:${uuid}` }, { kind: 'image', url: 'https://example.com/b.png' }] });
    await composePost(actor, { ...base, postId: 'p1', intent: 'draft', attachment: { kind: 'keep' } }, NOW);
    expect(mocks.findPost).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1', workspaceId: 'w1' } }));
    expect(mocks.updatePost).toHaveBeenLastCalledWith(actor, expect.objectContaining({ media: [{ kind: 'image', url: `media:${uuid}` }, { kind: 'image', url: 'https://example.com/b.png' }] }));
  });
});
