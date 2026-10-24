import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), scheduled: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://app.example.com' }));
vi.mock('../src/modules/studio/agents/server/copy', () => ({ agentCopy: async () => new Proxy({}, { get: (_t, key) => String(key) }) }));
vi.mock('../src/modules/studio/agents/server/scheduled', () => ({ scheduledAgents: mocks.scheduled }));

import { scheduledAgentsHttp } from '../src/modules/studio/agents/server/scheduled-http';
import { AGENTS_MCP } from '../src/modules/studio/agents/mcp';

const listing = {
  agents: [{ id: 'agent-a', targetId: 'target-a', targetName: 'Page', brief: 'Weekly news', weekday: 4, count: 2, enabled: true, lastRunOn: '2026-10-22', createdAt: '2026-10-01T00:00:00.000Z' }],
  channels: [{ id: 'target-a', name: 'Page' }], maxDrafts: 5, briefMax: 2000,
  history: [{ agentId: 'agent-a', at: '2026-10-22T08:00:00.000Z', drafts: 2, code: null }],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.viewer.mockResolvedValue({ user: { id: 'u1' }, workspaceId: 'w1' });
  mocks.scheduled.mockResolvedValue(listing);
});

describe('scheduled runs shared transport', () => {
  it('serves the schedule list with run history on GET through the shared service', async () => {
    const response = await scheduledAgentsHttp(new Request('https://app.example.com/api/agents/scheduled'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(listing);
    expect(mocks.viewer).toHaveBeenCalledWith({ module: 'studio', feature: 'studio/agents', channelScoped: true });
    expect(mocks.scheduled).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, { action: 'list' }, { locale: 'en' });
  });

  it('exposes the same list with run history over MCP', async () => {
    const group = AGENTS_MCP[0];
    const result = await group.execute({ userId: 'u1', workspaceId: 'w1' } as never, 'list_scheduled_agents', {}, 100);
    expect(result).toEqual(listing);
    expect(mocks.scheduled).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', workspaceId: 'w1' }), { action: 'list' });
  });
});
