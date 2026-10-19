import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationError } from '../src/lib/operation-error';

const h = vi.hoisted(() => ({ authorize: vi.fn(), deletePost: vi.fn(), publishPost: vi.fn(), reschedulePost: vi.fn(), duplicatePost: vi.fn(), post: vi.fn(), workspace: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { post: { findFirst: h.post }, workspace: { findUnique: h.workspace } } }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: h.authorize }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({ deletePost: h.deletePost, publishPost: h.publishPost, reschedulePost: h.reschedulePost }));
vi.mock('@/modules/publishing/server/duplicate', () => ({ duplicatePost: h.duplicatePost }));

import { itemRequestId, runBulkPostAction } from '../src/modules/publishing/server/bulk';
import { BULK_COPY, bulkConfirmation, retryableDestinationCount } from '../src/modules/publishing/bulk';
import { executeBulkTool } from '../src/modules/publishing/bulk-mcp';

const actor = { userId: 'u1', workspaceId: 'w1', allowedTargetIds: ['t1'] };
const requestId = '11111111-2222-4333-8444-555555555555';
const input = (action: string, postIds: string[], extra = {}) => ({ action, postIds, requestId, confirmation: `${action.toUpperCase()} ${postIds.length} POSTS`, ...extra });

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.authorize.mockImplementation(async (a: typeof actor) => ({ actor: a }));
  h.workspace.mockResolvedValue({ timezone: 'Africa/Casablanca' });
});

describe('bulk post rules', () => {
  it('counts only clearly failed destinations without a remote ID as retryable', () => {
    expect(retryableDestinationCount({ status: 'partially_failed', targets: [{ status: 'failed', remotePostId: null }, { status: 'processing' }, { status: 'published', remotePostId: 'r' }, { status: 'failed', remotePostId: 'r2' }] })).toBe(1);
    expect(retryableDestinationCount({ status: 'draft', targets: [{ status: 'failed' }] })).toBe(0);
  });
  it('has matching English and French copy', () => {
    expect(Object.keys(BULK_COPY.fr).sort()).toEqual(Object.keys(BULK_COPY.en).sort());
    expect(Object.keys(BULK_COPY.fr.actions)).toEqual(Object.keys(BULK_COPY.en.actions));
    expect(bulkConfirmation('retry', 3)).toBe('RETRY 3 POSTS');
  });
  it('derives stable valid per-item request IDs', () => {
    expect(itemRequestId(requestId, 'p1')).toBe(itemRequestId(requestId, 'p1'));
    expect(itemRequestId(requestId, 'p1')).not.toBe(itemRequestId(requestId, 'p2'));
    expect(itemRequestId(requestId, 'p1')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('runBulkPostAction', () => {
  it('refuses wrong confirmations, duplicates and missing schedule before any work', async () => {
    await expect(runBulkPostAction(actor, { ...input('delete', ['p1', 'p2']), confirmation: 'DELETE 1 POSTS' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(runBulkPostAction(actor, input('delete', ['p1', 'p1']))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(runBulkPostAction(actor, input('reschedule', ['p1']))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(runBulkPostAction(actor, input('delete', Array.from({ length: 51 }, (_, i) => `p${i}`)))).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.authorize).not.toHaveBeenCalled(); expect(h.deletePost).not.toHaveBeenCalled();
  });
  it('stops when write authorization fails', async () => {
    h.authorize.mockRejectedValue(new OperationError('forbidden', 'no'));
    await expect(runBulkPostAction(actor, input('delete', ['p1']))).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.deletePost).not.toHaveBeenCalled();
  });
  it('deletes locally only, with the original scoped actor, and reports per-post outcomes', async () => {
    h.deletePost.mockResolvedValueOnce({ state: 'completed' }).mockRejectedValueOnce(new OperationError('not_found', 'gone')).mockResolvedValueOnce({ state: 'needs_review' });
    const result = await runBulkPostAction(actor, input('delete', ['p1', 'p2', 'p3']));
    expect(h.deletePost.mock.calls.map(call => [call[0], call[2]])).toEqual([[actor, false], [actor, false], [actor, false]]);
    expect(result).toMatchObject({ requested: 3, done: 1, failed: 1, needsReview: 1 });
  });
  it('duplicates with deterministic per-item request IDs', async () => {
    h.duplicatePost.mockResolvedValue({ postId: 'new' });
    const result = await runBulkPostAction(actor, input('duplicate', ['p1']));
    expect(h.duplicatePost).toHaveBeenCalledWith(actor, { postId: 'p1', requestId: itemRequestId(requestId, 'p1'), confirmation: 'DUPLICATE POST p1' });
    expect(result.items[0]).toMatchObject({ outcome: 'done', newPostId: 'new' });
  });
  it('reschedules in the workspace time zone and skips ineligible posts', async () => {
    h.reschedulePost.mockResolvedValueOnce({}).mockRejectedValueOnce(new OperationError('conflict', 'not waiting'));
    const result = await runBulkPostAction(actor, input('reschedule', ['p1', 'p2'], { date: '2030-01-02', time: '09:30' }));
    expect(h.reschedulePost).toHaveBeenCalledWith(actor, { postId: 'p1', date: '2030-01-02', time: '09:30', timeZone: 'Africa/Casablanca' });
    expect(result).toMatchObject({ done: 1, skipped: 1 });
  });
  it('retries only failed posts, in retry-only mode, and never reports uncertainty as done', async () => {
    h.post.mockResolvedValueOnce({ status: 'failed' }).mockResolvedValueOnce({ status: 'draft' }).mockResolvedValueOnce({ status: 'partially_failed' });
    h.publishPost.mockResolvedValueOnce({ failed: 0, needsReconciliation: 0, firstCommentsNeedingReview: 0, firstCommentsNotSent: 0 }).mockResolvedValueOnce({ failed: 0, needsReconciliation: 1, firstCommentsNeedingReview: 0, firstCommentsNotSent: 0 });
    const result = await runBulkPostAction(actor, input('retry', ['p1', 'p2', 'p3']));
    expect(h.publishPost).toHaveBeenCalledTimes(2);
    expect(h.publishPost.mock.calls.every(call => call[3]?.retryOnly === true)).toBe(true);
    expect(result).toMatchObject({ done: 1, skipped: 1, needsReview: 1 });
  });
  it('treats unexpected errors as needing review rather than failed', async () => {
    h.deletePost.mockRejectedValue(new Error('socket'));
    const result = await runBulkPostAction(actor, input('delete', ['p1']));
    expect(result.items[0]).toMatchObject({ outcome: 'needs_review', code: 'unconfirmed' });
  });
  it('is exposed through the MCP tool with the same service', async () => {
    h.deletePost.mockResolvedValue({ state: 'completed' });
    await expect(executeBulkTool(actor, 'bulk_post_action', input('delete', ['p1']))).resolves.toMatchObject({ done: 1 });
  });
});
