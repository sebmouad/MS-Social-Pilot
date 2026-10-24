import { prisma } from '@/server/data';

export type ActivityRow = {
  id: string;
  action: string;
  detail: unknown;
  createdAt: Date;
  actorName: string | null;
  actorEmail: string | null;
};

const ACTIVITY_METADATA: Record<string, { label: string; format?: 'boolean' }> = {
  suspended: { label: 'workspace suspended', format: 'boolean' },
  postCount: { label: 'posts' }, targetCount: { label: 'destinations' },
  published: { label: 'published' }, failed: { label: 'failed' },
  needsReconciliation: { label: 'needs reconciliation' },
  conversationCount: { label: 'conversations' }, messageCount: { label: 'messages' },
  commentCount: { label: 'comments' }, failedCount: { label: 'failed' },
  channels: { label: 'channels' }, adAccounts: { label: 'ad accounts' },
  stillScheduled: { label: 'scheduled items' }, retained: { label: 'data retained', format: 'boolean' },
  remoteDeletionRequested: { label: 'remote deletion requested', format: 'boolean' },
  remoteDeletedCount: { label: 'remote items deleted' }, targetCountRequested: { label: 'destinations requested' },
};

export function sanitizeRootActivity(row: ActivityRow) {
  const detail = row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail)
    ? row.detail as Record<string, unknown> : {};
  const metadata = Object.entries(ACTIVITY_METADATA).flatMap(([key, config]) => {
    const value = detail[key];
    if (config.format === 'boolean' && typeof value === 'boolean') return [`${config.label}: ${value ? 'yes' : 'no'}`];
    if (typeof value === 'number' && Number.isFinite(value)) return [`${value} ${config.label}`];
    return [];
  });
  return {
    id: row.id,
    action: row.action,
    createdAt: row.createdAt,
    actor: row.actorName ? { name: row.actorName, email: row.actorEmail ?? '' } : null,
    metadata,
  };
}

export async function getRootOverview() {
  const [users, workspaces, sources, failedPosts, publishedPosts] = await Promise.all([
    prisma.user.count(),
    prisma.workspace.count(),
    prisma.socialAccount.count(),
    prisma.post.count({ where: { status: { in: ['failed', 'partially_failed'] } } }),
    prisma.post.count({ where: { status: 'published' } }),
  ]);
  return { users, workspaces, sources, failedPosts, publishedPosts };
}
