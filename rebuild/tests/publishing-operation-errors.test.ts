// Operation-lock/authority behavior is exercised by publishing-guard and PostgreSQL suites.
vi.mock('@/modules/publishing/server/guard', () => ({
  withPublishingTransaction: (_signal: AbortSignal, work: (tx: unknown) => Promise<unknown>) => db.$transaction(work),
  withPublishingOperation: (actor: unknown, _options: unknown, work: (context: unknown) => Promise<unknown>) => work({ actor, signal: new AbortController().signal, lockTargets: async () => {} }),
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  target: { findMany: vi.fn() },
  postTarget: { findMany: vi.fn() },
  post: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../src/server/data', () => ({ prisma: db }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => ({
  'publishing.maxMessageCharacters': 10000,
  'publishing.maxImportRows': 100,
  'publishing.maxImportBytes': 256000,
  'publishing.maxTargetsPerPost': 20,
  'publishing.maxRemoteMediaPerPost': 4,
  'publishing.maxImageAltCharacters': 500,
})[key] }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: async () => ({ publish: vi.fn(), supportsTargetKind: () => true }) }));

import { OperationError } from '../src/lib/operation-error';
import { createLocalDraft } from '../src/server/post-mutations';
import { createPost, validatePostAttachments } from '../src/server/publishing/lifecycle';

const actor = { userId: 'u1', workspaceId: 'w1' };

beforeEach(() => {
  vi.clearAllMocks();
  db.membership.findUnique.mockResolvedValue({ role: 'owner' });
  db.post.create.mockResolvedValue({ id: 'new-id' });
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
});

describe('publishing operation errors', () => {
  it('treats a malformed attachment URL as validation without echoing the URL', () => {
    expect(() => validatePostAttachments({ link: 'secret-value-without-a-url' }, 4, 500))
      .toThrow(expect.objectContaining({ name: 'OperationError', code: 'invalid_request', message: 'Attachments require a public HTTPS URL without credentials.' }));
  });
  it('marks invalid post text as a safe validation error', async () => {
    await expect(createPost(actor, { message: '  ', firstComment: '', targetIds: [] }))
      .rejects.toMatchObject({ name: 'OperationError', code: 'invalid_request' });
  });

  it('marks draft permission failures as forbidden', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'viewer' });
    await expect(createLocalDraft(actor, 'Draft'))
      .rejects.toMatchObject({ name: 'OperationError', code: 'forbidden' });
  });

  it('marks publishing membership permission failures as forbidden', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'viewer' });
    await expect(createPost(actor, { message: 'Draft', firstComment: '', targetIds: [] }))
      .rejects.toMatchObject({ name: 'OperationError', code: 'forbidden' });
  });

  it('lets unexpected database errors pass through untyped', async () => {
    const databaseError = new Error('database connection lost');
    db.membership.findUnique.mockRejectedValue(databaseError);
    await expect(createLocalDraft(actor, 'Draft')).rejects.toBe(databaseError);
    await expect(createPost(actor, { message: 'Draft', firstComment: '', targetIds: [] })).rejects.toBe(databaseError);
    expect(databaseError).not.toBeInstanceOf(OperationError);
  });
});
