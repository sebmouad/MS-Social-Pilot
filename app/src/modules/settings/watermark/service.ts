import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { loadEntitlements, canUseFeature } from '@/server/entitlements';
import { loadPermissions } from '@/server/permissions/loader';
import { canAccessFeature } from '@/server/permissions';
import { OperationError } from '@/lib/operation-error';
import { readWorkspaceImage, uploadWorkspaceImage, deleteUnusedWorkspaceImage } from '@/modules/publishing/server/media/storage';
import { watermarkImage } from '@/modules/publishing/server/media/watermark';
import { watermarkAction, watermarkOptions, type WatermarkActor, type WatermarkState } from './contracts';

const denied = () => new OperationError('forbidden', 'Watermarking is unavailable for this account.');
const invalid = () => new OperationError('invalid_request', 'Check the logo, position, opacity and scale. Use a still PNG or JPEG.');
type Row = { logo: Uint8Array; position: string; opacity: number; scale: number };

async function authorize(actor: WatermarkActor, apply: boolean, write: boolean) {
  const [user, member, access, permissions] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } }),
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  const feature = apply ? 'publishing/posts' : 'settings/workspace';
  if (!user || user.disabledAt || !member || !access || access.workspaceId !== actor.workspaceId || !permissions || !canUseFeature(access, feature) || !canAccessFeature(permissions, feature, write ? 'write' : 'read')) throw denied();
  // Images and branding are workspace-wide. No scoped credential may turn this into a media-read bypass.
  if (!permissions.pageScope.all || actor.allowedChannelIds !== undefined) throw denied();
  if (!apply && !['owner', 'admin'].includes(member.role)) throw denied();
  if (apply && (!canUseFeature(access, 'publishing/media') || !canAccessFeature(permissions, 'publishing/media', 'read'))) throw denied();
}

async function protect<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError('unavailable', 'Watermarking is temporarily unavailable. Try again.');
  }
}

/** All entry points share current authority, workspace lock, purge gate and atomic audit. */
async function guarded<T>(actor: WatermarkActor, apply: boolean, write: boolean, run: (tx: import('../../../../generated/client').Prisma.TransactionClient) => Promise<T>) {
  await authorize(actor, apply, write);
  const [timeout, maxWait] = await Promise.all([runtimeConfig('settings.teamOperationTimeoutMs'), runtimeConfig('settings.teamOperationMaxWaitMs')]);
  return prisma.$transaction(async tx => {
    const workspaces = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM workspaces WHERE id = ${actor.workspaceId} FOR UPDATE`;
    if (!workspaces[0] || workspaces[0].suspendedAt) throw denied();
    const purge = await tx.workspaceDataPurge.findUnique({ where: { workspaceId: actor.workspaceId }, select: { status: true } });
    if (purge && purge.status !== 'completed') throw new OperationError('conflict', 'Workspace data deletion is in progress.');
    await tx.$queryRaw`SELECT m.id FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
    await authorize(actor, apply, write);
    return run(tx);
  }, { timeout, maxWait });
}

export async function readWatermark(actor: WatermarkActor): Promise<WatermarkState> {
  return protect(() => guarded(actor, false, false, async tx => {
    const rows = await tx.$queryRaw<Row[]>`SELECT position, opacity, scale FROM rebuild_workspace_watermarks WHERE "workspaceId" = ${actor.workspaceId}`;
    return rows[0] ? watermarkOptions.parse({ position: rows[0].position, opacity: rows[0].opacity, scale: rows[0].scale }) : null;
  }));
}

export async function changeWatermark(actor: WatermarkActor, input: unknown) {
  return protect(async () => {
    const parsed = watermarkAction.safeParse(input);
    if (!parsed.success) throw invalid();
    const value = parsed.data;
    let createdId: string | undefined;
    try {
      return await guarded(actor, value.action === 'apply', true, async tx => {
        const maxPixels = Number(await runtimeConfig('media.inspectMaxPixels'));
        let image: { id: string; mimeType: string; fileName: string } | undefined;
        if (value.action === 'remove') {
          await tx.$executeRaw`DELETE FROM rebuild_workspace_watermarks WHERE "workspaceId" = ${actor.workspaceId}`;
        } else if (value.action === 'save') {
          let logo: Buffer;
          if (value.logoBase64 !== undefined) {
            const maxBytes = Number(await runtimeConfig('settings.watermarkMaxLogoBytes'));
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.logoBase64) || value.logoBase64.length > Math.ceil(maxBytes / 3) * 4) throw invalid();
            logo = Buffer.from(value.logoBase64, 'base64');
            if (!logo.length || logo.length > maxBytes) throw invalid();
            try {
              const metadata = await sharp(logo, { failOn: 'error', limitInputPixels: maxPixels }).metadata();
              if (!['png', 'jpeg'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw invalid();
              logo = await sharp(logo, { failOn: 'error', limitInputPixels: maxPixels }).rotate().png().toBuffer();
            } catch { throw invalid(); }
            if (logo.length > maxBytes) throw invalid();
          } else {
            const previous = await tx.$queryRaw<Row[]>`SELECT logo FROM rebuild_workspace_watermarks WHERE "workspaceId" = ${actor.workspaceId}`;
            if (!previous[0]) throw invalid();
            logo = Buffer.from(previous[0].logo);
          }
          await tx.$executeRaw`INSERT INTO rebuild_workspace_watermarks ("workspaceId", logo, position, opacity, scale) VALUES (${actor.workspaceId}, ${logo}, ${value.position}, ${value.opacity}, ${value.scale}) ON CONFLICT ("workspaceId") DO UPDATE SET logo = EXCLUDED.logo, position = EXCLUDED.position, opacity = EXCLUDED.opacity, scale = EXCLUDED.scale`;
        } else {
          const rows = await tx.$queryRaw<Row[]>`SELECT logo, position, opacity, scale FROM rebuild_workspace_watermarks WHERE "workspaceId" = ${actor.workspaceId}`;
          const row = rows[0];
          if (!row) throw new OperationError('not_found', 'No workspace watermark is configured.');
          const options = watermarkOptions.parse({ position: row.position, opacity: row.opacity, scale: row.scale });
          let source;
          try { source = await readWorkspaceImage(actor.workspaceId, value.imageId); } catch { throw new OperationError('not_found', 'This workspace image is unavailable.'); }
          let bytes;
          try { bytes = await watermarkImage(source.bytes, Buffer.from(row.logo), options, maxPixels); } catch { throw invalid(); }
          if (bytes.length > Number(await runtimeConfig('publishing.maxImageUploadBytes'))) throw invalid();
          image = await uploadWorkspaceImage(actor, new File([new Uint8Array(bytes)], 'watermarked.png', { type: 'image/png' }));
          createdId = image.id;
        }
        await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'settings.watermark', ${JSON.stringify({ action: value.action, ...(image ? { sourceId: value.action === 'apply' ? value.imageId : undefined, imageId: image.id } : {}) })}::jsonb, NOW())`;
        return { ok: true as const, ...(image ? { image: { ...image, reference: `media:${image.id}`, url: `/api/media/${image.id}` } } : {}) };
      });
    } catch (error) {
      // A failed transaction never leaves a successful-looking derivative behind.
      if (createdId) await deleteUnusedWorkspaceImage(actor.workspaceId, createdId).catch(() => undefined);
      throw error;
    }
  });
}
