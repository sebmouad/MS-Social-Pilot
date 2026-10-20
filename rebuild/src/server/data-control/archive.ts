import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runtimeConfig } from '@/server/config/store';
import { prisma } from '@/server/data';
import { exportWorkspaceData, type DataControlActor } from './index';
import { readWorkspaceStorage, validateWorkspaceId } from './storage';
import { ZipWriter, ZIP32_MAX_BYTES } from './zip';

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Build a downloadable ZIP. The manifest reports the rebuild's known coverage limits. */
export async function exportWorkspaceArchive(actor: DataControlActor): Promise<Buffer> {
  validateWorkspaceId(actor.workspaceId);
  const mediaRoot = await runtimeConfig('storage.mediaRoot');
  if (!mediaRoot) throw new Error('Set the media storage root in Root before exporting workspace media.');
  const [archiveLimit, headroom] = await Promise.all([runtimeConfig('data.maxArchiveBytes'), runtimeConfig('data.zipSafetyHeadroomBytes')]);
  const maxBytes = Math.min(archiveLimit as number, ZIP32_MAX_BYTES - (headroom as number));

  const data = await exportWorkspaceData(actor);
  const databaseJson = json(data);
  const databaseBytes = Buffer.byteLength(databaseJson);
  if (databaseBytes > maxBytes) throw new Error('Workspace database export exceeds the configured archive size limit.');
  const records = await prisma.$queryRawUnsafe<Array<{ storageKey: string | null }>>(
    'SELECT "storageKey" FROM public.media WHERE "workspaceId" = $1 AND "storageKey" IS NOT NULL',
    actor.workspaceId,
  );
  const files = await readWorkspaceStorage(mediaRoot, actor.workspaceId, maxBytes - databaseBytes);
  const byPath = new Map(files.map(file => [file.path, file]));
  const referenced = records.map(({ storageKey }) => {
    if (!storageKey || path.isAbsolute(storageKey) || storageKey.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) {
      throw new Error('Workspace media contains an unsafe storage key; export stopped.');
    }
    const relative = storageKey.split(/[\\/]/);
    if (relative.shift() !== actor.workspaceId || !relative.length) throw new Error('Workspace media contains an unsafe storage key; export stopped.');
    const archivePath = `media/${relative.join('/')}`;
    if (!byPath.has(archivePath)) throw new Error(`A referenced workspace media file is missing: ${storageKey}`);
    return archivePath;
  });

  const temp = await mkdtemp(path.join(os.tmpdir(), 'workspace-export-'));
  const zipPath = path.join(temp, 'workspace.zip');
  const zip = new ZipWriter(zipPath, maxBytes);
  try {
    await zip.add('database/workspace.json', databaseJson);
    for (const file of files) await zip.add(file.path, file.content);
    const legacyTables = data.coverage?.directlyOwnedLegacyTables ?? [];
    const legacyRowCounts = data.coverage?.directlyOwnedLegacyRowCounts ?? {};
    const manifest = {
      format: 'ms-social-pilot-workspace-archive', version: 1,
      exportedAt: new Date().toISOString(), workspaceId: actor.workspaceId,
      database: {
        file: 'database/workspace.json', complete: false,
        includedDatasets: ['workspace', 'memberships', 'socialAccounts', 'targets', 'target insights', 'Instagram accounts, media and insights', 'conversations and messages', 'post targets and comments', 'ad accounts and insights', 'posts', ...Object.keys(data.indirectTables ?? {}).map((table: string) => `indirect table: ${table}`), ...legacyTables.map((table: string) => `legacy table: ${table}`)],
        legacyTables: legacyTables.map((table: string) => ({ table, rows: legacyRowCounts[table] ?? 0 })),
        omitted: data.coverage?.omitted ?? ['instance-wide audit and authentication records', 'records owned indirectly through non-workspace foreign keys'],
      },
      media: { directory: 'media/', files: files.length, referencedFiles: referenced.length, complete: true },
      security: { providerCredentialsExcluded: true, secretsExcluded: true },
      coverage: { complete: data.coverage?.complete ?? false, directlyOwnedLegacyTablesComplete: data.coverage?.directlyOwnedLegacyTablesComplete ?? false, reason: 'Direct workspace-owned tables are exported; see database.omitted for records outside that ownership boundary.' },
    };
    await zip.add('manifest.json', json(manifest));
    await zip.close();
    if (zip.bytes > maxBytes) throw new Error('Workspace archive exceeds the configured archive size limit.');
    return await readFile(zipPath);
  } catch (error) {
    zip.abort();
    throw error;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
