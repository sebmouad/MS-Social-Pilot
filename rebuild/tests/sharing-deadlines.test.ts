import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaults, install, state } from './sharing-helpers';

vi.mock('@/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: async () => ({ provider: { in: ['test-provider'] } }) }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({
  runtimeConfig: async (key: string) => (defaults as Record<string, unknown>)[key],
  runtimeConfigBatch: async (keys: readonly string[]) => Object.fromEntries(keys.map(key => [key, (defaults as Record<string, unknown>)[key]])),
}));
vi.mock('@/server/entitlements', async () => (await import('./sharing-helpers')).entitlementMock());
vi.mock('@/server/permissions', async () => (await import('./sharing-helpers')).permissionMock());
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({ pageScope: state.scope }) }));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: async () => undefined, withWorkspaceOperation: async (_id: string, run: () => Promise<unknown>) => run() }));

const review = vi.fn();
vi.mock('@/modules/sharing/server/review-port', () => ({ REVIEW_NOTE_MAX: 500, getReviewPort: () => ({ review }) }));

import { createShareLink, updateShareLink } from '../src/modules/sharing/server/links';
import { runShareLinkDeadlines } from '../src/modules/sharing/server/deadlines';
import { OperationError } from '@/lib/operation-error';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const link = { id: 'shl_1', workspaceId: 'workspace-a', title: 'Client review', targetIds: ['t1'], publishAnywayHours: 72, createdById: 'user-a' };
const liveLink = () => [{ id: 'shl_1' }];

beforeEach(() => { install(); review.mockReset(); });

describe('share-link publish-anyway', () => {
  it('refuses a deadline without decides and above the Root maximum', async () => {
    state.respond = sql => sql.includes('FROM targets') ? [{ id: 't1' }] : sql.includes('COUNT(*)') ? [{ count: BigInt(0) }] : undefined;
    const base = { kind: 'review', title: 'Client review', targetIds: ['t1'], confirmation: 'CREATE SHARE LINK Client review' } as const;
    await expect(createShareLink(actor, { ...base, publishAnywayHours: 72 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createShareLink(actor, { ...base, decides: true, publishAnywayHours: 169 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createShareLink(actor, { ...base, decides: true, publishAnywayHours: 73 })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('stores a deciding deadline, rotates on change and clears it when decides switches off', async () => {
    state.respond = sql => sql.includes('FROM targets') ? [{ id: 't1' }] : sql.includes('COUNT(*)') ? [{ count: BigInt(0) }] : undefined;
    await createShareLink(actor, { kind: 'review', title: 'Client review', targetIds: ['t1'], decides: true, publishAnywayHours: 48, confirmation: 'CREATE SHARE LINK Client review' });
    const insert = state.executions.find(entry => entry.sql.includes('INSERT INTO share_links'))!;
    expect(insert.sql).toContain('"publishAnywayHours"');
    expect(insert.values).toContain(48);
    const editRow = { id: 'shl_1', kind: 'review', title: 'Client review', description: null, targetIds: ['t1'], daysBack: 7, daysAhead: 30, allowComments: true, decides: true, publishAnywayHours: 48, revokedAt: null, expiresAt: new Date('2099-01-01T00:00:00Z'), tokenHash: 'h' };
    const version = (await import('../src/modules/sharing/contracts')).linkVersion({ ...editRow, targetIds: ['t1'] }, 'h');
    state.respond = sql => sql.includes('FROM share_links') && sql.includes('FOR UPDATE') ? [editRow] : sql.includes('UPDATE share_links') ? undefined : sql.includes('FROM targets') ? [{ id: 't1' }] : undefined;
    const edited = await updateShareLink(actor, { id: 'shl_1', expectedVersion: version, publishAnywayHours: 24, confirmation: 'UPDATE SHARE LINK shl_1' });
    expect(edited.rotated).toBe(true);
    state.respond = sql => sql.includes('FROM share_links') && sql.includes('FOR UPDATE') ? [{ ...editRow, publishAnywayHours: 24 }] : sql.includes('FROM targets') ? [{ id: 't1' }] : undefined;
    const off = await updateShareLink(actor, { id: 'shl_1', expectedVersion: (await import('../src/modules/sharing/contracts')).linkVersion({ ...editRow, publishAnywayHours: 24, targetIds: ['t1'] }, 'h'), decides: false, confirmation: 'UPDATE SHARE LINK shl_1' });
    expect(off.rotated).toBe(true);
  });

  it('approves unanswered posts inside the deadline through the review lifecycle as the creator', async () => {
    review.mockImplementation(async (_actor: unknown, _postId: string, _decision: string, _note: string, participant: { before: (tx: unknown) => Promise<void>; after: (tx: unknown) => Promise<void> }) => {
      await participant.before(db);
      await participant.after(db);
    });
    state.respond = (sql: string) => {
      if (sql.includes('FROM share_links') && sql.includes('decides = true')) return [link];
      if (sql.includes('FROM posts p')) return [{ id: 'post-a' }];
      if (sql.includes('FROM share_links l JOIN memberships')) return liveLink();
      if (sql.includes('FROM posts p WHERE p.id')) return [{ id: 'post-a' }];
      if (sql.includes('"defaultLocale"')) return [{ defaultLocale: 'en' }];
      return undefined;
    };
    const summary = await runShareLinkDeadlines(new Date('2026-10-22T12:00:00Z'));
    expect(summary).toBe('links=1 approved=1 skipped=0 failed=0');
    expect(review).toHaveBeenCalledTimes(1);
    expect(review.mock.calls[0]?.[0]).toMatchObject({ userId: 'user-a', workspaceId: 'workspace-a' });
    expect(review.mock.calls[0]?.[2]).toBe('approve');
    const executions = state.executions.map(entry => entry.sql).join('\n');
    expect(executions).toContain('INSERT INTO review_decisions');
    expect(state.executions.flatMap(entry => entry.values)).toContain('sharing.client_answer_recorded');
  });

  it('skips revoked links, lost races and creators who lost their rights instead of forcing', async () => {
    review.mockRejectedValueOnce(new OperationError('not_found', 'gone')).mockRejectedValueOnce(new OperationError('forbidden', 'no rights'));
    state.respond = (sql: string) => {
      if (sql.includes('FROM share_links') && sql.includes('decides = true')) return [link];
      if (sql.includes('FROM posts p')) return [{ id: 'post-a' }, { id: 'post-b' }];
      if (sql.includes('"defaultLocale"')) return [{ defaultLocale: 'fr' }];
      return undefined;
    };
    const summary = await runShareLinkDeadlines(new Date('2026-10-22T12:00:00Z'));
    expect(summary).toBe('links=1 approved=0 skipped=2 failed=0');
  });

  it('only looks at live deciding links with a deadline, bounded per run', async () => {
    state.respond = () => [];
    await runShareLinkDeadlines(new Date('2026-10-22T12:00:00Z'));
    const query = state.queries.find(entry => entry.sql.includes('FROM share_links') && entry.sql.includes('decides = true'))!;
    expect(query.sql).toContain('"publishAnywayHours" IS NOT NULL');
    expect(query.sql).toContain('"revokedAt" IS NULL');
    expect(query.sql).toContain('"expiresAt" >');
    expect(query.sql).toContain('LIMIT');
  });
});
