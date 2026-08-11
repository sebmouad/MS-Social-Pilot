import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { MediaError, storageUsage, storeFile } from '@/lib/media';
import { fail, ok, route } from '@/lib/api';

/** Upload a file into the workspace media library. */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return fail('Attach a file to upload.', 400);
  }
  if (file.size > env.maxUploadBytes) {
    return fail(`That file is larger than the ${Math.round(env.maxUploadBytes / (1024 * 1024))} MB limit.`, 413);
  }

  // Uploading is not a privileged action — contributors draft posts, so they
  // upload too. A quota is what bounds the disk, rather than a role check that
  // would stop people doing their job.
  const usage = await storageUsage(auth.workspace.id);
  if (usage.bytes + file.size > usage.quotaBytes) {
    return fail(
      `This client has used ${Math.round(usage.bytes / (1024 * 1024))} MB of its ` +
        `${Math.round(usage.quotaBytes / (1024 * 1024))} MB media allowance. ` +
        'Delete some files, or raise the limit in Configuration.',
      413,
    );
  }

  const data = Buffer.from(await file.arrayBuffer());

  try {
    const stored = await storeFile({
      workspaceId: auth.workspace.id,
      data,
      mimeType: file.type || 'application/octet-stream',
      originalName: file.name,
    });

    const media = await prisma.media.create({
      data: {
        workspaceId: auth.workspace.id,
        filename: file.name,
        mimeType: file.type,
        size: stored.size,
        kind: stored.kind,
        storageKey: stored.storageKey,
        // Served through an authenticated route, not from a public directory.
        url: '',
      },
    });

    const updated = await prisma.media.update({
      where: { id: media.id },
      data: { url: `/api/media/${media.id}/raw` },
    });

    return ok(
      {
        id: updated.id,
        kind: updated.kind,
        url: updated.url,
        storageKey: updated.storageKey,
        mimeType: updated.mimeType,
        filename: updated.filename,
        size: updated.size,
      },
      201,
    );
  } catch (error) {
    if (error instanceof MediaError) return fail(error.message, 415);
    throw error;
  }
});

/** List the workspace media library, newest first. */
export const GET = route(async () => {
  const auth = await requireAuth();

  const media = await prisma.media.findMany({
    where: { workspaceId: auth.workspace.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return ok({ media });
});
