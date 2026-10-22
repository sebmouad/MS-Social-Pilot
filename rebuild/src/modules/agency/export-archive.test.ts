import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it, vi } from 'vitest';
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'storage.mediaRoot' ? '/synthetic-media' : key === 'data.maxArchiveBytes' ? 268435456 : 67108864 }));
vi.mock('@/server/data', () => ({ prisma: { $queryRawUnsafe: async () => [] } }));
vi.mock('@/server/data-control', () => ({ exportWorkspaceData: async () => ({ posts: [{ id: 'draft-a', message: 'Bonjour', targets: [] }], targets: [], legacyTables: { queue_slots: [{ dayOfWeek: 1, hour: 9 }] }, indirectTables: { ads_objects: [{ id: 'campaign-a' }] }, coverage: { complete: false, omitted: ['installation records'] } }) }));
vi.mock('@/server/data-control/storage', () => ({ validateWorkspaceId: vi.fn(), readWorkspaceStorage: async () => [] }));
import { exportWorkspaceArchive } from '@/server/data-control/archive';

it('packs portable files into the existing ZIP and reports their exact names without claiming full coverage', async () => {
  const archive = await exportWorkspaceArchive({ userId: 'owner-a', workspaceId: 'workspace-a' });
  const directory = await mkdtemp(path.join(tmpdir(), 'lane-archive-'));
  try {
    const filename = path.join(directory, 'workspace.zip'); await writeFile(filename, archive);
    const read = (name: string) => execFileSync('unzip', ['-p', filename, name], { encoding: 'utf8' });
    const manifest = JSON.parse(read('manifest.json'));
    expect(manifest.portableFiles).toMatchObject({ version: 1, csvFormulaCellsEscaped: true, files: ['channels.json', 'posts.json', 'posts.csv', 'schedule.json', 'analytics/channels.csv', 'comments.json'] });
    expect(read('posts.csv')).toContain('draft-a');
    expect(read('posts.csv')).toContain('Bonjour');
    expect(JSON.parse(read('schedule.json'))).toEqual([{ dayOfWeek: 1, hour: 9 }]);
    expect(JSON.parse(read('database/workspace.json')).indirectTables.ads_objects).toEqual([{ id: 'campaign-a' }]);
    expect(manifest.coverage.complete).toBe(false);
    expect(manifest.database.includedDatasets).toContain('indirect table: ads_objects');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
