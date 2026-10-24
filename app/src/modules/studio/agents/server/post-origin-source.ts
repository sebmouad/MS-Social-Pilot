import { prisma } from '@/server/data';
import type { PostOriginSource } from '@/modules/publishing/server/origin-source';

/** Posts the supervised autopilot scheduled, read from its own audit rows (never from post state). */
export const autopilotOriginSource: PostOriginSource = {
  kind: 'autopilot',
  matchingPostIds: async workspaceId => (await prisma.$queryRaw<Array<{ postId: string }>>`SELECT DISTINCT detail->>'postId' AS "postId" FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'agents.scheduled.auto_scheduled' AND detail->>'postId' IS NOT NULL`).map(row => row.postId),
};
