import { z } from 'zod';

import { NOTE_LABEL_MAX, type ChartNoteView } from './chart-note-colors';
import { errors } from './errors';
import { targetScope, type PageScope } from './page-access';
import { PALETTE_KEYS, type PaletteKey } from './palette';
import { prisma } from './prisma';

/**
 * Notes on charts (NEXT_PHASES H13): a dated label on a Page's analytics
 * timelines ("Campaign started"), or on every Page's. Shown in reports too.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const chartNoteSchema = z.object({
  /** The Page it belongs to; null puts it on every Page. */
  targetId: z.string().min(1).nullable(),
  day: z.string().regex(DAY),
  label: z.string().trim().min(1).max(NOTE_LABEL_MAX),
  color: z.enum(PALETTE_KEYS as [PaletteKey, ...PaletteKey[]]).default('blue'),
});

/** A Page's notes and the workspace-wide ones, between two days inclusive. */
export async function listChartNotes(options: {
  workspaceId: string;
  targetId: string;
  firstDay: string;
  lastDay: string;
}): Promise<ChartNoteView[]> {
  const rows = await prisma.chartNote.findMany({
    where: {
      workspaceId: options.workspaceId,
      OR: [{ targetId: options.targetId }, { targetId: null }],
      day: { gte: options.firstDay, lte: options.lastDay },
    },
    orderBy: [{ day: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, day: true, label: true, color: true, targetId: true },
  });
  return rows.map((row) => ({
    id: row.id,
    day: row.day,
    label: row.label,
    color: (PALETTE_KEYS.includes(row.color as PaletteKey) ? row.color : 'blue') as PaletteKey,
    pageOnly: row.targetId !== null,
  }));
}

/** A note on a Page the member may see, or on every Page when they see them all. */
export async function addChartNote(options: {
  workspaceId: string;
  scope: PageScope;
  authorId: string;
  input: z.infer<typeof chartNoteSchema>;
}): Promise<ChartNoteView> {
  const { input } = options;
  if (input.targetId) {
    const page = await prisma.target.findFirst({
      where: { AND: [{ id: input.targetId, workspaceId: options.workspaceId }, targetScope(options.scope)] },
      select: { id: true },
    });
    if (!page) throw errors.notFound();
  } else if (!options.scope.all) {
    // A member limited to some Pages cannot write on the others' charts.
    throw errors.notFound();
  }
  const note = await prisma.chartNote.create({
    data: { workspaceId: options.workspaceId, targetId: input.targetId, day: input.day, label: input.label, color: input.color, authorId: options.authorId },
  });
  return { id: note.id, day: note.day, label: note.label, color: input.color, pageOnly: note.targetId !== null };
}

/** Remove a note the member could have written. */
export async function deleteChartNote(options: { workspaceId: string; scope: PageScope; noteId: string }): Promise<void> {
  const note = await prisma.chartNote.findFirst({ where: { id: options.noteId, workspaceId: options.workspaceId }, select: { targetId: true } });
  const allowed = note && (note.targetId ? options.scope.all || options.scope.ids.includes(note.targetId) : options.scope.all);
  if (!allowed) throw errors.notFound();
  await prisma.chartNote.delete({ where: { id: options.noteId } });
}
