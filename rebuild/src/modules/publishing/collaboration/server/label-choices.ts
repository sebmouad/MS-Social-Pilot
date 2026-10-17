import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { prisma } from '@/server/data';
import { authorizePublishing } from '../../server/access';
import type { PublishingActor } from '../../server/types';
import { POSTS, protect } from './core';
/** Complete association choices: never hide labels merely because the directory has another page. */
export async function readCollaborationLabels(actor: PublishingActor) {
  await authorizePublishing(actor, POSTS, 'read');
  const maximum = await runtimeConfig('publishing.labelMaxPerWorkspace');
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new OperationError('unavailable', 'Labels are temporarily unavailable.');
  const labels = await protect(prisma.$queryRaw<Array<{ id: string; name: string; color: string }>>`SELECT id, name, color FROM labels WHERE "workspaceId" = ${actor.workspaceId} ORDER BY name ASC, id ASC LIMIT ${maximum + 1}`);
  if (labels.length > maximum) throw new OperationError('unavailable', 'The label selection exceeds its current limit. Ask an administrator to review it.');
  return { labels };
}
