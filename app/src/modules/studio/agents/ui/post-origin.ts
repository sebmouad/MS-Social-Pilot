import { prisma } from '@/server/data';
import type { PostOriginProvider } from '@/modules/publishing/ui/origins/post-origin';
import { autopilotOriginText } from './autopilot-origin-copy';

/** Answers "did the supervised autopilot schedule this post?" from the auto_scheduled audit rows. */
export const autopilotPostOrigin: PostOriginProvider = {
  kind: 'autopilot',
  label: locale => autopilotOriginText(locale, 'badge'),
  filterLabel: locale => autopilotOriginText(locale, 'filter'),
  linkLabel: locale => autopilotOriginText(locale, 'link'),
  available: async workspaceId => (await prisma.$queryRaw<Array<{ found: boolean }>>`SELECT EXISTS(SELECT 1 FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'agents.scheduled.auto_scheduled') AS found`)[0]?.found ?? false,
  async lookup(workspaceId, postIds) {
    if (!postIds.length) return new Map();
    const rows = await prisma.$queryRaw<Array<{ postId: string; sourceName: string }>>`SELECT DISTINCT ON (al.detail->>'postId') al.detail->>'postId' AS "postId", COALESCE(t.name, '') AS "sourceName" FROM activity_logs al LEFT JOIN ai_agents a ON a.id = al.detail->>'agentId' AND a."workspaceId" = al."workspaceId" LEFT JOIN targets t ON t.id = a."targetId" AND t."workspaceId" = al."workspaceId" WHERE al."workspaceId" = ${workspaceId} AND al.action = 'agents.scheduled.auto_scheduled' AND al.detail->>'postId' = ANY(${[...postIds]}) ORDER BY al.detail->>'postId', al."createdAt" DESC`;
    return new Map(rows.map(row => [row.postId, { sourceName: row.sourceName, url: null }]));
  },
};
