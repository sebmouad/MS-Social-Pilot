import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ overview: vi.fn(), clients: vi.fn() }));
vi.mock('../src/modules/agency/server/agency', () => ({ agencyOverview: mocks.overview, listAgencyClients: mocks.clients }));

import { agencyToolDefinitions, executeAgencyTool, agencyWriteTools } from '../src/modules/agency/mcp';

beforeEach(() => { vi.clearAllMocks(); mocks.overview.mockResolvedValue({ ok: true }); mocks.clients.mockResolvedValue({ ok: true }); });

describe('agency MCP boundary', () => {
  it('is read-only and runs only for an explicit person-wide principal', async () => {
    expect(agencyToolDefinitions.map(tool => tool.name)).toEqual(['get_agency_overview', 'list_agency_clients']);
    expect(agencyWriteTools.size).toBe(0);
    await expect(executeAgencyTool({ scope: 'person', userId: 'u1' }, 'get_agency_overview', { sort: 'failed' })).resolves.toMatchObject({ ok: true });
    expect(mocks.overview).toHaveBeenCalledWith({ userId: 'u1' }, { sort: 'failed' });
    await executeAgencyTool({ scope: 'person', userId: 'u1' }, 'list_agency_clients', { q: 'x' });
    expect(mocks.clients).toHaveBeenCalledWith({ userId: 'u1' }, { q: 'x' });
    await expect(executeAgencyTool({ scope: 'person', userId: 'u1' }, 'delete_workspace', {})).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('never serves a workspace-scoped key, workspace viewer or installation identity', async () => {
    const attempts: unknown[] = [
      { scope: 'workspace', userId: 'u1', workspaceId: 'w1', role: 'owner', apiKeyId: 'k1' },
      { scope: 'workspace', userId: 'u1', workspaceId: 'w1', role: 'owner' },
      { scope: 'installation', userId: 'u1', isInstanceOwner: true },
      { scope: 'person', userId: 'u1', apiKeyId: 'k1' },
      { scope: 'person', userId: 'u1', workspaceId: 'w1' },
      { scope: 'person', userId: 'u1', permissions: {} },
      { scope: 'person', userId: '' },
      { userId: 'u1' }, null, undefined, 'u1',
    ];
    for (const identity of attempts) {
      for (const tool of ['get_agency_overview', 'list_agency_clients']) await expect(executeAgencyTool(identity, tool, {})).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(mocks.overview).not.toHaveBeenCalled(); expect(mocks.clients).not.toHaveBeenCalled();
  });
});
