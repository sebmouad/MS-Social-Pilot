import { z } from 'zod';

import { AppError } from './errors';
import { prisma } from './prisma';
import { SEASON_RULES } from './seasons';

/** The team's own key dates and seasonal modes: validation and storage. */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const keyDateSchema = z.object({
  date: day,
  title: z.string().trim().min(1).max(120),
  yearly: z.boolean().default(false),
  targetIds: z.array(z.string()).max(500).default([]),
});

export const seasonSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startsOn: day,
    endsOn: day,
    targetIds: z.array(z.string()).max(500).default([]),
    rule: z.enum(SEASON_RULES),
    shiftMinutes: z.number().int().min(-720).max(720).default(0),
    extraTimes: z.array(time).max(12).default([]),
  })
  .refine((season) => season.endsOn >= season.startsOn, { path: ['endsOn'], message: 'Ends before it starts' });

/** Pages named must be this workspace's; anything else is refused, not dropped. */
export async function checkTargets(workspaceId: string, targetIds: string[]): Promise<string[]> {
  const unique = [...new Set(targetIds)];
  if (unique.length === 0) return [];
  const found = await prisma.target.count({ where: { workspaceId, id: { in: unique } } });
  if (found !== unique.length) throw new AppError({ key: 'errors.targetNotFound', fallback: 'Page not found.', status: 404 });
  return unique;
}

export const keyDateNotFound = () => new AppError({ key: 'errors.keyDateNotFound', fallback: 'Key date not found.', status: 404 });
export const seasonNotFound = () => new AppError({ key: 'errors.seasonNotFound', fallback: 'Seasonal mode not found.', status: 404 });
