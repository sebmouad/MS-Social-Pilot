import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runtimeConfig: vi.fn(async (key: string) => key === 'data.maxArchiveBytes' ? 268435456 : '/media-root'),
  rows: vi.fn(async () => [{ storageKey: 'workspace-a/photo.bin' }]),
  data: vi.fn(async () => ({ format: 'ms-social-pilot-workspace-export', workspace: { id: 'workspace-a' }, security: { credentialsExcluded: true }, indirectTables: { external_posts: [], link_clicks: [] }, coverage: { directlyOwnedLegacyTables: ['media'], directlyOwnedLegacyRowCounts: { media: 2 }, directlyOwnedLegacyTablesComplete: true, complete: false, omitted: ['indirect data'] } })),
  files: vi.fn(async () => [{ path: 'media/photo.bin', content: Buffer.from([1, 2, 3]) }]),
}));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock('../src/server/data', () => ({ prisma: { $queryRawUnsafe: mocks.rows } }));
vi.mock('../src/server/data-control', () => ({ exportWorkspaceData: mocks.data }));
vi.mock('../src/server/data-control/storage', () => ({ readWorkspaceStorage: mocks.files, validateWorkspaceId: vi.fn() }));

const tempDirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('workspace ZIP export', () => {
  it('includes DB JSON, media bytes, and a manifest that discloses partial coverage', async () => {
    const { exportWorkspaceArchive } = await import('../src/server/data-control/archive');
    const archive = await exportWorkspaceArchive({ userId: 'u1', workspaceId: 'workspace-a' });
    const dir = await mkdtemp(path.join(os.tmpdir(), 'archive-test-'));
    tempDirs.push(dir);
    const archivePath = path.join(dir, 'export.zip');
    await writeFile(archivePath, archive);
    const manifest = JSON.parse(execFileSync('unzip', ['-p', archivePath, 'manifest.json'], { encoding: 'utf8' }));
    const db = JSON.parse(execFileSync('unzip', ['-p', archivePath, 'database/workspace.json'], { encoding: 'utf8' }));
    const media = execFileSync('unzip', ['-p', archivePath, 'media/photo.bin']);
    expect(manifest.coverage.complete).toBe(false);
    expect(manifest.coverage.directlyOwnedLegacyTablesComplete).toBe(true);
    expect(manifest.database.legacyTables).toEqual([{ table: 'media', rows: 2 }]);
    expect(manifest.database.includedDatasets).toContain('legacy table: media');
    expect(manifest.database.includedDatasets).toContain('Instagram accounts, media and insights');
    expect(manifest.database.includedDatasets).toContain('indirect table: external_posts');
    expect(manifest.database.includedDatasets).toContain('indirect table: link_clicks');
    expect(manifest.database.omitted).toEqual(['indirect data']);
    expect(manifest.security).toEqual({ providerCredentialsExcluded: true, secretsExcluded: true });
    expect(db.workspace.id).toBe('workspace-a');
    expect(media).toEqual(Buffer.from([1, 2, 3]));
  });

  it('fails closed when a database-referenced media file is missing', async () => {
    mocks.files.mockResolvedValueOnce([]);
    const { exportWorkspaceArchive } = await import('../src/server/data-control/archive');
    await expect(exportWorkspaceArchive({ userId: 'u1', workspaceId: 'workspace-a' })).rejects.toThrow(/referenced workspace media file is missing/);
  });

  it('fails closed when a media storage key escapes the tenant directory', async () => {
    mocks.rows.mockResolvedValueOnce([{ storageKey: '../other-workspace/private.bin' }]);
    const { exportWorkspaceArchive } = await import('../src/server/data-control/archive');
    await expect(exportWorkspaceArchive({ userId: 'u1', workspaceId: 'workspace-a' })).rejects.toThrow(/unsafe storage key/);
  });

  it('rejects a storage key belonging to another tenant even if a similarly named file exists', async () => {
    mocks.rows.mockResolvedValueOnce([{ storageKey: 'other-workspace/photo.bin' }]);
    mocks.files.mockResolvedValueOnce([{ path: 'media/photo.bin', content: Buffer.from([1]) }, { path: 'media/other-workspace/photo.bin', content: Buffer.from([2]) }]);
    const { exportWorkspaceArchive } = await import('../src/server/data-control/archive');
    await expect(exportWorkspaceArchive({ userId: 'u1', workspaceId: 'workspace-a' })).rejects.toThrow(/unsafe storage key/);
  });

  it('fails closed when storage is not configured', async () => {
    mocks.runtimeConfig.mockResolvedValueOnce(undefined as never);
    const { exportWorkspaceArchive } = await import('../src/server/data-control/archive');
    await expect(exportWorkspaceArchive({ userId: 'u1', workspaceId: 'workspace-a' })).rejects.toThrow(/storage root/);
  });
});
