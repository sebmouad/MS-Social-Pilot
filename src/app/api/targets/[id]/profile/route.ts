import { z } from 'zod';

import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { ok, readJson, route } from '@/lib/api';
import { audienceFields } from '@/lib/validation';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const profileSchema = z.object({
  brandVoice: text(2000),
  utmSource: text(100),
  utmMedium: text(100),
  utmCampaign: text(200),
  ...audienceFields,
});

/** A Page's own voice for AI writing, its own link tags and its audience (H0). Admins, like the workspace's. */
export const PATCH = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const input = profileSchema.parse(await readJson(request));
  const { count } = await prisma.target.updateMany({ where: { id, workspaceId: auth.workspace.id }, data: input });
  if (count === 0) throw errors.notFound();
  return ok({ ok: true });
});
