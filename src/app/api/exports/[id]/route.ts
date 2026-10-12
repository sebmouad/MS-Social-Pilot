import { NextResponse } from 'next/server';

import { route } from '@/lib/api';
import { ForbiddenError, requireAuth } from '@/lib/auth';
import { errors } from '@/lib/errors';
import { openStoredFile } from '@/lib/media';
import { prisma } from '@/lib/prisma';

/** Download a finished export: the workspace owner, until it expires. */
export const GET = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  if (auth.role !== 'owner') throw new ForbiddenError('Only the workspace owner can download an export.');
  const { id } = await context.params;
  const entry = await prisma.workspaceExport.findFirst({ where: { id, workspaceId: auth.workspace.id, status: 'ready' } });
  if (!entry?.storageKey || !entry.expiresAt || entry.expiresAt < new Date()) throw errors.fileNotFound();
  const file = await openStoredFile(entry.storageKey);
  const day = entry.finishedAt?.toISOString().slice(0, 10) ?? 'export';
  return new NextResponse(file.body, {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(file.size),
      'cache-control': 'private, no-store',
      'content-disposition': `attachment; filename="workspace-export-${day}.zip"`,
    },
  });
});
