import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));

import { autopilotOriginSource } from '@/modules/studio/agents/server/post-origin-source';
import { autopilotPostOrigin } from '@/modules/studio/agents/ui/post-origin';
import { autopilotOriginCopy } from '@/modules/studio/agents/ui/autopilot-origin-copy';
import { INSTALLED_POST_ORIGIN_SOURCES } from '@/modules/installed-post-origins';
import { installedPostOrigins } from '@/modules/publishing/ui/origins/installed';

beforeEach(() => vi.clearAllMocks());

describe('autopilot provenance', () => {
  it('registers the autopilot origin on the server list and the UI list', () => {
    expect(INSTALLED_POST_ORIGIN_SOURCES.some(source => source.kind === 'autopilot')).toBe(true);
    expect(installedPostOrigins.some(provider => provider.kind === 'autopilot')).toBe(true);
  });

  it('keeps English and French origin labels in step', () => {
    expect(Object.keys(autopilotOriginCopy.fr).sort()).toEqual(Object.keys(autopilotOriginCopy.en).sort());
    expect(autopilotPostOrigin.label('en')).toBe('Autopilot');
    expect(autopilotPostOrigin.filterLabel('fr')).toBe('Programmé par le pilotage automatique');
  });

  it('matches only posts the autopilot scheduled, from its own audit rows', async () => {
    db.$queryRaw.mockResolvedValue([{ postId: 'p1' }, { postId: 'p2' }]);
    expect(await autopilotOriginSource.matchingPostIds('w1')).toEqual(['p1', 'p2']);
    const sql = (db.$queryRaw.mock.calls[0]![0] as TemplateStringsArray).join('?');
    expect(sql).toContain('agents.scheduled.auto_scheduled');
    expect(sql).toContain('"workspaceId"');
  });

  it('looks up scheduled posts with their channel name for the queue badge', async () => {
    db.$queryRaw
      .mockResolvedValueOnce([{ found: true }])
      .mockResolvedValueOnce([{ postId: 'p1', sourceName: 'Page' }]);
    expect(await autopilotPostOrigin.available('w1')).toBe(true);
    expect(await autopilotPostOrigin.lookup('w1', ['p1', 'p2'])).toEqual(new Map([['p1', { sourceName: 'Page', url: null }]]));
    expect(await autopilotPostOrigin.lookup('w1', [])).toEqual(new Map());
  });
});
