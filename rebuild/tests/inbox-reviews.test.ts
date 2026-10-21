vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: { target: { findFirst: vi.fn(), findMany: vi.fn() }, $queryRaw: vi.fn() },
  platformInbox: vi.fn(), inboxPlatformIds: vi.fn(), authorize: vi.fn(),
}));

vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('@/server/platforms/registry', () => ({ platformInbox: mocks.platformInbox, inboxPlatformIds: mocks.inboxPlatformIds }));
vi.mock('@/modules/inbox/server/access', () => ({ authorizeInbox: mocks.authorize }));
vi.mock('@/modules/inbox/server/workflow', () => ({ canManageInboxWorkflow: vi.fn(), setInboxWorkflowResolved: vi.fn() }));
vi.mock('@/modules/inbox/server/deletion', () => ({ deleteInboxCommentDurably: vi.fn() }));

import { replyToInbox, syncInbox } from '@/modules/inbox/server/actions';
import { reviewCopy, reviewSummary, reviewText } from '@/modules/inbox/reviews-copy';
import { inboxListInput } from '@/modules/inbox/query';

const actor = { userId: 'user-1', workspaceId: 'workspace-1' };
const base = { canManage: vi.fn(), replyPolicy: vi.fn(), reply: vi.fn(), moderate: vi.fn(), prepareDeleteComment: vi.fn() };
const synced = { targetCount: 1, failedCount: 0, conversationCount: 2, messageCount: 3, commentCount: 4, syncedAt: '2026-10-20T00:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ channelIds: ['target-1'], channels: [], timeZone: 'UTC' });
  mocks.inboxPlatformIds.mockResolvedValue(['facebook']);
  mocks.prisma.target.findFirst.mockResolvedValue({ socialAccount: { provider: 'facebook' } });
  mocks.prisma.target.findMany.mockResolvedValue([{ id: 'target-1', socialAccount: { provider: 'facebook' } }]);
  mocks.prisma.$queryRaw.mockResolvedValue([{ targetId: 'target-1' }]);
});

describe('Inbox reviews through the shared service', () => {
  it('syncs reviews after the provider sync when the module declares them, and reports their count', async () => {
    const reviews = { sync: vi.fn(async () => ({ targetCount: 1, failedCount: 0, reviewCount: 7, syncedAt: synced.syncedAt })) };
    mocks.platformInbox.mockResolvedValue({ ...base, sync: vi.fn(async () => synced), reviews });
    expect(await syncInbox(actor)).toMatchObject({ commentCount: 4, reviewCount: 7 });
    expect(await syncInbox(actor, 'target-1')).toMatchObject({ reviewCount: 7 });
    expect(reviews.sync).toHaveBeenCalledWith(actor, 'target-1');
  });
  it('leaves the result unchanged for modules without reviews', async () => {
    mocks.platformInbox.mockResolvedValue({ ...base, sync: vi.fn(async () => synced) });
    expect(await syncInbox(actor, 'target-1')).toEqual(synced);
    expect(await syncInbox(actor)).not.toHaveProperty('reviewCount');
  });
  it('keeps conversations and comments synced when reading reviews fails', async () => {
    mocks.platformInbox.mockResolvedValue({ ...base, sync: vi.fn(async () => synced), reviews: { sync: vi.fn(async () => { throw new Error('ratings unavailable'); }) } });
    expect(await syncInbox(actor, 'target-1')).toMatchObject({ commentCount: 4, reviewCount: 0 });
  });
  it('refuses a review reply where the module cannot answer reviews, without contacting the provider', async () => {
    mocks.platformInbox.mockResolvedValue({ ...base, sync: vi.fn(), reviews: { sync: vi.fn() } });
    await expect(replyToInbox(actor, { kind: 'review', id: 'review-1', text: 'Thanks' })).rejects.toThrow(/not available for this channel/);
    expect(base.reply).not.toHaveBeenCalled();
  });
  it('dispatches a review reply only to a module that declares reply support, after the channel check', async () => {
    const reply = vi.fn(async () => ({ ok: true }));
    mocks.platformInbox.mockResolvedValue({ ...base, sync: vi.fn(), reviews: { sync: vi.fn(), reply } });
    expect(await replyToInbox(actor, { kind: 'review', id: 'review-1', text: 'Thanks' })).toEqual({ ok: true });
    expect(reply).toHaveBeenCalledWith(actor, { id: 'review-1', text: 'Thanks' });
    expect(mocks.authorize).toHaveBeenCalledWith(actor, { allowedChannelIds: ['target-1'] }, 'write');
  });
  it('hides a review from a member whose channel scope excludes it', async () => {
    mocks.authorize.mockResolvedValue({ channelIds: ['other'], channels: [], timeZone: 'UTC' });
    await expect(replyToInbox(actor, { kind: 'review', id: 'review-1', text: 'Thanks' })).rejects.toThrow(/unavailable/);
  });
  it('treats a review outside the workspace as missing', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([]);
    await expect(replyToInbox(actor, { kind: 'review', id: 'review-x', text: 'Thanks' })).rejects.toThrow(/review is unavailable/);
  });
});

describe('Inbox review copy and URL transport', () => {
  it('has the same keys in English and French', () => {
    expect(Object.keys(reviewCopy.fr).sort()).toEqual(Object.keys(reviewCopy.en).sort());
  });
  it('states missing ratings instead of showing zero', () => {
    expect(reviewSummary('en', { rating: null, recommendation: null })).toBe('No rating available');
    expect(reviewSummary('fr', { rating: null, recommendation: null })).toBe('Note non disponible');
    expect(reviewSummary('en', { rating: 4, recommendation: null })).toBe('4 out of 5 stars');
    expect(reviewSummary('fr', { rating: null, recommendation: 'negative' })).toBe('Ne recommande pas votre page');
    expect(reviewText('fr', 'reviewBy', { name: 'Sam' })).toBe('Avis de Sam');
  });
  it('accepts the reviews type filter from the URL', () => {
    expect(inboxListInput({ type: 'review' })).toEqual({ kind: 'review' });
  });
});
