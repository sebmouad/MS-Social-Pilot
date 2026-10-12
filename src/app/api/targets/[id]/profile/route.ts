import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { errors } from '@/lib/errors';
import { parseWatermark } from '@/lib/image-format';
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
  /** The watermark put on this Page's images when published (G13); null for none. */
  watermark: z.unknown().optional(),
});

/** A Page's own voice for AI writing, its own link tags and its audience (H0). Admins, like the workspace's. */
export const PATCH = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  const { watermark: rawWatermark, ...input } = profileSchema.parse(await readJson(request));
  const watermark = rawWatermark === undefined ? undefined : parseWatermark(rawWatermark);
  // A logo must be one of this workspace's own images.
  if (watermark?.mediaId) {
    const logo = await prisma.media.findFirst({ where: { id: watermark.mediaId, workspaceId: auth.workspace.id, kind: 'image' }, select: { id: true } });
    if (!logo) throw errors.notFound();
  }
  const { count } = await prisma.target.updateMany({
    where: { id, workspaceId: auth.workspace.id },
    data: { ...input, ...(watermark === undefined ? {} : { watermark: watermark ? (watermark as unknown as Prisma.InputJsonObject) : Prisma.DbNull }) },
  });
  if (count === 0) throw errors.notFound();
  return ok({ ok: true });
});
