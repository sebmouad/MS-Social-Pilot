import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(), executeRaw: vi.fn(), batch: vi.fn(), authorize: vi.fn(),
  settings: vi.fn(), complete: vi.fn(), createPost: vi.fn(), transaction: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw, $transaction: mocks.transaction } }));
vi.mock('@/server/config/store', () => ({ runtimeConfigBatch: mocks.batch }));
vi.mock('@/modules/studio/agents/server/copy', () => ({ agentCopy: async () => new Proxy({}, { get: (_t, key) => String(key) }) }));
vi.mock('@/modules/studio/server/access', () => ({ authorizeAi: mocks.authorize }));
vi.mock('@/modules/studio/server/ai', () => ({ settings: mocks.settings, complete: mocks.complete }));
vi.mock('@/modules/studio/ai', () => ({ cleanOutput: (text: string) => text.trim() }));
vi.mock('@/modules/publishing/server/api-writes', () => ({ createPublishingPost: mocks.createPost }));

import { runDueScheduledAgents, scheduledAgents } from '@/modules/studio/agents/server/scheduled';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const policy = {
  'agents.scheduledRunsEnabled': true, 'agents.scheduledRunsBatchAgents': 50, 'agents.scheduledRunsMaxDrafts': 5,
  'agents.scheduledRunsBriefMaxCharacters': 2000,
  'agents.policy': { maxAgents: 30, nameCharacters: 100, instructionsCharacters: 2000, voiceCharacters: 500, historyPageSize: 20, transactionTimeoutMs: 15000, transactionMaxWaitMs: 5000, usageWindowMs: 3600000, systemPrompt: 'Be brief.', postPrompt: 'Draft.', replyPrompt: 'Reply.' },
};
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.batch.mockResolvedValue(policy);
  mocks.authorize.mockResolvedValue(undefined);
  mocks.settings.mockResolvedValue({ configured: true, provider: 'test', model: 'm', apiKey: 'k', baseUrl: null, maxInput: 4000, outputInputMultiplier: 2, hourly: 10, daily: 100, monthly: 1000 });
  mocks.complete.mockResolvedValue('Draft text here');
  mocks.createPost.mockResolvedValue({ id: 'post-a' });
  mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM targets')) return [{ id: 'target-a' }];
    if (sql.includes('FROM ai_agents')) return [];
    if (sql.includes('COUNT(*)')) return [{ count: BigInt(0) }];
    if (sql.includes('FROM memberships')) return [{ id: 'user-a' }];
    return [];
  });
  mocks.executeRaw.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run({ $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw }));
});

describe('scheduled writing agents', () => {
  it('requires exact confirmations and bounded input before writing', async () => {
    await expect(scheduledAgents(actor, { action: 'save', targetId: 'target-a', brief: 'Weekly news', weekday: 1, count: 5, enabled: true, confirmation: 'create scheduled agent' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(scheduledAgents(actor, { action: 'save', targetId: 'target-a', brief: 'Weekly news', weekday: 1, count: 6, enabled: true, confirmation: 'CREATE SCHEDULED AGENT' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(scheduledAgents(actor, { action: 'save', targetId: 'target-a', brief: 'x', weekday: 1, count: 5, enabled: true, confirmation: 'CREATE SCHEDULED AGENT' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(scheduledAgents(actor, { action: 'delete', id: 'agent-a', confirmation: 'DELETE agent-a' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('refuses targets outside the workspace', async () => {
    mocks.queryRaw.mockImplementation(async () => []);
    await expect(scheduledAgents(actor, { action: 'save', targetId: 'elsewhere', brief: 'Weekly news', weekday: 1, count: 5, enabled: true, confirmation: 'CREATE SCHEDULED AGENT' })).rejects.toMatchObject({ code: 'invalid_request' });
    const query = mocks.queryRaw.mock.calls.map(sqlOf).find(sql => sql.includes('FROM targets'));
    expect(query).toContain('"workspaceId"');
  });

  it('saves a schedule and audits it', async () => {
    const result = await scheduledAgents(actor, { action: 'save', targetId: 'target-a', brief: 'Weekly news', weekday: 1, count: 5, enabled: true, confirmation: 'CREATE SCHEDULED AGENT' });
    expect(result).toMatchObject({ ok: true });
    const statements = mocks.executeRaw.mock.calls.map(sqlOf).join('\n');
    expect(statements).toContain('INSERT INTO ai_agents');
    expect(mocks.executeRaw.mock.calls.flatMap(call => call.slice(1))).toContain('agents.scheduled.created');
  });

  it('deletes only its own workspace agent and refuses a missing one', async () => {
    mocks.executeRaw.mockResolvedValue(0);
    await expect(scheduledAgents(actor, { action: 'delete', id: 'agent-a', confirmation: 'DELETE SCHEDULED AGENT agent-a' })).rejects.toMatchObject({ code: 'not_found' });
    const statement = mocks.executeRaw.mock.calls.map(sqlOf).find(sql => sql.includes('DELETE FROM ai_agents'))!;
    expect(statement).toContain('"workspaceId"');
  });

  it('runs only due agents and writes drafts as the creator without scheduling them', async () => {
    // 2026-10-22 is a Thursday (weekday 4) in Europe/Paris.
    const agent = { id: 'agent-a', workspaceId: 'workspace-a', userId: 'user-a', targetId: 'target-a', targetName: 'Page', brief: 'Weekly news', weekday: 4, count: 2, timezone: 'Europe/Paris', defaultLocale: 'en', aiEnabled: true };
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM ai_agents')) return [agent];
      if (sql.includes('COUNT(*)')) return [{ count: BigInt(0) }];
      if (sql.includes('FROM memberships')) return [{ id: 'user-a' }];
      return [];
    });
    const summary = await runDueScheduledAgents(new Date('2026-10-22T08:00:00Z'));
    expect(summary).toBe('agents=1 drafts=2 skipped=0 failed=0');
    expect(mocks.createPost).toHaveBeenCalledTimes(2);
    for (const call of mocks.createPost.mock.calls) {
      expect(call[0]).toMatchObject({ userId: 'user-a', workspaceId: 'workspace-a' });
      expect(call[1]).toMatchObject({ targetIds: ['target-a'], confirmation: 'CREATE POST' });
      expect(call[1]).not.toHaveProperty('scheduledAt');
    }
  });

  it('skips agents whose day it is not, whose day is claimed, or whose workspace switched AI off', async () => {
    const agents = [
      { id: 'agent-a', workspaceId: 'workspace-a', userId: 'user-a', targetId: 'target-a', targetName: 'Page', brief: 'b', weekday: 5, count: 2, timezone: 'Europe/Paris', defaultLocale: 'en', aiEnabled: true },
      { id: 'agent-b', workspaceId: 'workspace-a', userId: 'user-a', targetId: 'target-a', targetName: 'Page', brief: 'b', weekday: 4, count: 2, timezone: 'Europe/Paris', defaultLocale: 'en', aiEnabled: false },
    ];
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM ai_agents')) return agents;
      if (sql.includes('FROM memberships')) return [{ id: 'user-a' }];
      return [];
    });
    mocks.executeRaw.mockResolvedValue(0); // claim lost or weekday mismatch short-circuits before claiming
    const summary = await runDueScheduledAgents(new Date('2026-10-22T08:00:00Z'));
    expect(summary).toContain('agents=2');
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it('frees the day when AI fails so the next run retries', async () => {
    const agent = { id: 'agent-a', workspaceId: 'workspace-a', userId: 'user-a', targetId: 'target-a', targetName: 'Page', brief: 'Weekly news', weekday: 4, count: 2, timezone: 'Europe/Paris', defaultLocale: 'en', aiEnabled: true };
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM ai_agents')) return [agent];
      if (sql.includes('COUNT(*)')) return [{ count: BigInt(0) }];
      if (sql.includes('FROM memberships')) return [{ id: 'user-a' }];
      return [];
    });
    mocks.complete.mockRejectedValue(new Error('provider down'));
    const summary = await runDueScheduledAgents(new Date('2026-10-22T08:00:00Z'));
    expect(summary).toContain('failed=1');
    const freed = mocks.executeRaw.mock.calls.map(sqlOf).find(sql => sql.includes('SET "lastRunOn" = NULL'));
    expect(freed).toBeDefined();
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it('does nothing when scheduled runs are switched off', async () => {
    mocks.batch.mockResolvedValue({ ...policy, 'agents.scheduledRunsEnabled': false });
    await expect(runDueScheduledAgents(new Date())).resolves.toBe('disabled');
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('lists schedules with recent run history from the workspace audit trail', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('FROM ai_agents')) return [{ id: 'agent-a', targetId: 'target-a', targetName: 'Page', brief: 'Weekly news', weekday: 4, count: 2, enabled: true, lastRunOn: '2026-10-22', createdAt: '2026-10-01T00:00:00.000Z' }];
      if (sql.includes('FROM activity_logs') && sql.includes('agents.scheduled.completed')) {
        expect(values[0]).toBe('workspace-a');
        return [
          { agentId: 'agent-a', action: 'agents.scheduled.completed', drafts: 2, code: null, at: '2026-10-22T08:00:00.000Z' },
          { agentId: 'agent-a', action: 'agents.scheduled.failed', drafts: null, code: 'upstream_failure', at: new Date('2026-10-15T08:00:00.000Z') },
        ];
      }
      if (sql.includes('FROM targets')) return [{ id: 'target-a', name: 'Page' }];
      return [];
    });
    const result = await scheduledAgents(actor, { action: 'list' }) as { agents: unknown[]; history: Array<{ agentId: string; at: string; drafts: number | null; code: string | null }> };
    expect(result.agents).toHaveLength(1);
    expect(result.history).toEqual([
      { agentId: 'agent-a', at: '2026-10-22T08:00:00.000Z', drafts: 2, code: null },
      { agentId: 'agent-a', at: '2026-10-15T08:00:00.000Z', drafts: null, code: 'upstream_failure' },
    ]);
    const historyQuery = mocks.queryRaw.mock.calls.map(sqlOf).find(sql => sql.includes('FROM activity_logs') && sql.includes('agents.scheduled.completed'))!;
    expect(historyQuery).toContain('ORDER BY "createdAt" DESC');
  });
});
