import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  stagingDryRun: false,
  configError: false,
  posts: [] as Array<{ id: string; authorId: string; workspaceId: string; scheduledAt: Date }>,
  candidates: [] as Array<{ postId: string; postTargetId: string; workspaceId: string; authorId: string; provider: string; publishedAt: Date; firstCommentDelayMinutes: number }>,
  moderationWorkspaces: [] as Array<{ workspaceId: string }>,
  audits: [] as Array<{ workspaceId: string; job: string; kind: string; count: number; sampleIds: string[] }>,
  published: 0,
  commentsSent: 0,
}));

vi.mock('@/server/config/store', () => ({
  runtimeConfig: vi.fn(async (key: string) => {
    if (state.configError) throw new Error('config unavailable');
    if (key === 'jobs.stagingDryRun') return state.stagingDryRun;
    if (key === 'sync.maxItemsPerJob') return 100;
    if (key === 'publishing.maxFirstCommentDelayMinutes') return 10080;
    if (key === 'inbox.moderationAutoRun') return true;
    if (key === 'inbox.moderationAutoWorkspaceLimit') return 10;
    return null;
  }),
  runtimeSecret: vi.fn(async () => null),
}));
vi.mock('@/server/data', () => {
  const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM posts p')) return state.candidates;
    if (sql.includes('FROM moderation_rules r')) return state.moderationWorkspaces;
    throw new Error(`unexpected query: ${sql}`);
  });
  const executeRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('INSERT INTO root_activities')) {
      state.audits.push(JSON.parse(values[1] as string) as (typeof state.audits)[number]);
      return 1;
    }
    throw new Error(`unexpected execute: ${sql}`);
  });
  return {
    prisma: {
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
      post: { findMany: vi.fn(async () => state.posts) },
      appSetting: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
      workspaceDataPurge: { findUnique: vi.fn(async () => null) },
    },
  };
});
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: vi.fn(async () => ({ pageScope: { all: true } })) }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: vi.fn(async () => ({})), canUseFeature: vi.fn(() => true) }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: vi.fn(() => true) }));
vi.mock('@/server/jobs/access', () => ({ assertWorkspaceJobAccess: vi.fn(async () => undefined) }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({ publishPost: vi.fn(async () => { state.published++; return { published: 1, failed: 0, needsReconciliation: false, skipped: false }; }) }));
vi.mock('@/modules/publishing/server/first-comment', () => ({ sendDueFirstComment: vi.fn(async () => { state.commentsSent++; return { state: 'sent' }; }) }));

import { publishDuePosts } from '@/server/jobs/sync';
import { runDueFirstComments } from '@/modules/publishing/server/first-comment-jobs';
import { runAutomaticInboxModeration } from '@/modules/inbox/server/moderation';
import { isStagingDryRun, suppressStagingBatch } from '@/server/jobs/staging';

beforeEach(() => {
  state.stagingDryRun = false;
  state.configError = false;
  state.posts = [];
  state.candidates = [];
  state.moderationWorkspaces = [];
  state.audits = [];
  state.published = 0;
  state.commentsSent = 0;
});

describe('staging dry-run switch', () => {
  it('reads the Root switch and stays live when config is unreadable', async () => {
    expect(await isStagingDryRun()).toBe(false);
    state.stagingDryRun = true;
    expect(await isStagingDryRun()).toBe(true);
    state.configError = true;
    expect(await isStagingDryRun()).toBe(false);
  });

  it('audits one row per workspace with a bounded id sample', async () => {
    const rows = [
      { workspaceId: 'w1', id: 'p1' },
      { workspaceId: 'w1', id: 'p2' },
      ...Array.from({ length: 12 }, (_, index) => ({ workspaceId: 'w2', id: `q${index}` })),
    ];
    expect(await suppressStagingBatch('posts', 'publish', rows)).toBe(14);
    expect(state.audits).toHaveLength(2);
    expect(state.audits.find(audit => audit.workspaceId === 'w1')).toMatchObject({ job: 'posts', kind: 'publish', count: 2, sampleIds: ['p1', 'p2'] });
    expect(state.audits.find(audit => audit.workspaceId === 'w2')).toMatchObject({ count: 12 });
    expect(state.audits.find(audit => audit.workspaceId === 'w2')!.sampleIds).toHaveLength(10);
  });
});

describe('staging dry-run worker gates', () => {
  it('suppresses due-post publishing and audits the intent per workspace', async () => {
    state.posts = [
      { id: 'p1', authorId: 'u1', workspaceId: 'w1', scheduledAt: new Date('2026-10-23T00:00:00Z') },
      { id: 'p2', authorId: 'u1', workspaceId: 'w2', scheduledAt: new Date('2026-10-23T00:00:00Z') },
    ];
    state.stagingDryRun = true;
    const result = await publishDuePosts(new Date('2026-10-23T01:00:00Z'));
    expect(result).toMatchObject({ examined: 2, updated: 0, skipped: 2, failed: 0 });
    expect(state.published).toBe(0);
    expect(state.audits).toHaveLength(2);
    expect(state.audits[0]).toMatchObject({ job: 'posts', kind: 'publish', count: 1 });
  });

  it('publishes normally when the switch is off', async () => {
    state.posts = [{ id: 'p1', authorId: 'u1', workspaceId: 'w1', scheduledAt: new Date('2026-10-23T00:00:00Z') }];
    const result = await publishDuePosts(new Date('2026-10-23T01:00:00Z'));
    expect(result).toMatchObject({ examined: 1, updated: 1 });
    expect(state.published).toBe(1);
    expect(state.audits).toEqual([]);
  });

  it('suppresses due first comments without dispatching', async () => {
    state.candidates = [{ postId: 'p1', postTargetId: 'pt1', workspaceId: 'w1', authorId: 'u1', provider: 'facebook', publishedAt: new Date('2026-10-23T00:00:00Z'), firstCommentDelayMinutes: 0 }];
    state.stagingDryRun = true;
    const result = await runDueFirstComments(new Date('2026-10-23T01:00:00Z'));
    expect(result).toMatchObject({ examined: 1, sent: 0, skipped: 1 });
    expect(state.commentsSent).toBe(0);
    expect(state.audits).toMatchObject([{ job: 'posts', kind: 'first_comment', count: 1 }]);
  });

  it('sends due first comments normally when the switch is off', async () => {
    state.candidates = [{ postId: 'p1', postTargetId: 'pt1', workspaceId: 'w1', authorId: 'u1', provider: 'facebook', publishedAt: new Date('2026-10-23T00:00:00Z'), firstCommentDelayMinutes: 0 }];
    const result = await runDueFirstComments(new Date('2026-10-23T01:00:00Z'));
    expect(result).toMatchObject({ examined: 1, sent: 1 });
    expect(state.commentsSent).toBe(1);
  });

  it('suppresses automatic inbox moderation per workspace', async () => {
    state.moderationWorkspaces = [{ workspaceId: 'w1' }, { workspaceId: 'w2' }];
    state.stagingDryRun = true;
    const result = await runAutomaticInboxModeration(new Date('2026-10-23T01:00:00Z'));
    expect(result).toMatchObject({ examined: 0, acted: 0, skipped: 2, failed: 0 });
    expect(state.audits).toMatchObject([
      { job: 'inbox', kind: 'inbox_moderation', count: 1 },
      { job: 'inbox', kind: 'inbox_moderation', count: 1 },
    ]);
  });
});
