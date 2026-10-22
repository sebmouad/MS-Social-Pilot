import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(), executeRaw: vi.fn(), batch: vi.fn(), config: vi.fn(), authorize: vi.fn(),
  settings: vi.fn(), complete: vi.fn(), createPost: vi.fn(), queuePost: vi.fn(), transaction: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw, $transaction: mocks.transaction } }));
vi.mock('@/server/config/store', () => ({ runtimeConfigBatch: mocks.batch, runtimeConfig: mocks.config }));
vi.mock('@/modules/studio/agents/server/copy', () => ({ agentCopy: async () => new Proxy({}, { get: (_t, key) => String(key) }) }));
vi.mock('@/modules/studio/server/access', () => ({ authorizeAi: mocks.authorize }));
vi.mock('@/modules/studio/server/ai', () => ({ settings: mocks.settings, complete: mocks.complete }));
vi.mock('@/modules/studio/ai', () => ({ cleanOutput: (text: string) => text.trim() }));
vi.mock('@/modules/publishing/server/api-writes', () => ({ createPublishingPost: mocks.createPost }));
vi.mock('@/modules/publishing/server/queue', () => ({ queuePost: mocks.queuePost }));

import { runDueScheduledAgents, scheduledAgents } from '@/modules/studio/agents/server/scheduled';
import { autopilotTier, evaluateAutoSchedule, getAutopilotPolicy, type ResolvedAutopilotPolicy } from '@/modules/studio/agents/server/autopilot';
import { AGENTS_MCP } from '@/modules/studio/agents/mcp';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const policy = {
  'agents.scheduledRunsEnabled': true, 'agents.scheduledRunsBatchAgents': 50, 'agents.scheduledRunsMaxDrafts': 5,
  'agents.scheduledRunsBriefMaxCharacters': 2000,
  'agents.policy': { maxAgents: 30, nameCharacters: 100, instructionsCharacters: 2000, voiceCharacters: 500, historyPageSize: 20, transactionTimeoutMs: 15000, transactionMaxWaitMs: 5000, usageWindowMs: 3600000, systemPrompt: 'Be brief.', postPrompt: 'Draft.', replyPrompt: 'Reply.' },
};
const rootAutopilot = { sendsCeilingPerDay: 10, defaultQuietStartHour: 22, defaultQuietEndHour: 7, newTargetGraceDays: 14, maxScopedTargets: 50 };
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');
const agent = { id: 'agent-a', workspaceId: 'workspace-a', userId: 'user-a', targetId: 'target-a', targetName: 'Page', brief: 'Weekly news', weekday: 4, count: 2, timezone: 'Europe/Paris', defaultLocale: 'en', aiEnabled: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.batch.mockResolvedValue(policy);
  mocks.config.mockResolvedValue(rootAutopilot);
  mocks.authorize.mockResolvedValue({ role: 'owner', allowedTargetIds: undefined });
  mocks.settings.mockResolvedValue({ configured: true, provider: 'test', model: 'm', apiKey: 'k', baseUrl: null, maxInput: 4000, outputInputMultiplier: 2, hourly: 10, daily: 100, monthly: 1000 });
  mocks.complete.mockResolvedValue('Draft text here');
  mocks.createPost.mockImplementation(async (_actor: unknown, input: { message: string }) => ({ id: `post-${input.message.length}` }));
  mocks.queuePost.mockResolvedValue({ postId: 'post-x', scheduledAt: new Date('2026-10-29T08:00:00Z'), status: 'scheduled' });
  mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM ai_agents')) return [];
    if (sql.includes('FROM autopilot_policies')) return [];
    if (sql.includes('COUNT(*)')) return [{ count: BigInt(0) }];
    if (sql.includes('FROM memberships')) return [{ id: 'user-a' }];
    return [];
  });
  mocks.executeRaw.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run({ $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw }));
});

const supervised = (overrides: Partial<ResolvedAutopilotPolicy> = {}): ResolvedAutopilotPolicy => ({
  tier: 'supervised_auto', maxSendsPerDay: 10, quietStartHour: 22, quietEndHour: 7,
  targetIds: null, draftsOnlyTargetIds: [], newTargetGraceDays: 14, ...overrides,
});

describe('autopilot tiers', () => {
  it('defaults workspaces without a policy row to assisted', async () => {
    expect(await getAutopilotPolicy('workspace-a')).toMatchObject({ tier: 'assisted', maxSendsPerDay: 10, quietStartHour: 22, quietEndHour: 7, targetIds: null });
  });

  it('requires owners or admins plus the exact confirmation to change tiers', async () => {
    await expect(autopilotTier(actor, { action: 'tier', tier: 'supervised_auto', confirmation: 'SET AUTOPILOT TIER supervised' })).rejects.toMatchObject({ code: 'invalid_request' });
    mocks.authorize.mockResolvedValueOnce({ role: 'editor', allowedTargetIds: undefined });
    await expect(autopilotTier(actor, { action: 'tier', tier: 'supervised_auto', confirmation: 'SET AUTOPILOT TIER supervised_auto' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('refuses guardrail channels outside the workspace and clamps the daily cap to the Root ceiling', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('?').includes('SELECT id FROM targets') ? [{ id: 'target-a' }] : []);
    await expect(autopilotTier(actor, { action: 'tier', tier: 'supervised_auto', guardrails: { targetIds: ['target-a', 'elsewhere'] }, confirmation: 'SET AUTOPILOT TIER supervised_auto' })).rejects.toMatchObject({ code: 'invalid_request' });
    const result = await autopilotTier(actor, { action: 'tier', tier: 'supervised_auto', guardrails: { maxSendsPerDay: 50, targetIds: ['target-a'] }, confirmation: 'SET AUTOPILOT TIER supervised_auto' }) as { ok: boolean; policy: ResolvedAutopilotPolicy };
    expect(result.ok).toBe(true);
    const upsert = mocks.executeRaw.mock.calls.map(sqlOf).find(sql => sql.includes('INSERT INTO autopilot_policies'))!;
    expect(upsert).toContain('ON CONFLICT ("workspaceId")');
    expect(mocks.executeRaw.mock.calls.map(sqlOf).some(sql => sql.includes('agents.autopilot.tier_changed'))).toBe(true);
    // The clamped cap is stored, so a later read cannot exceed the ceiling either.
    const stored = mocks.executeRaw.mock.calls.flatMap(call => call.slice(1)).find(value => typeof value === 'string' && value.includes('maxSendsPerDay')) as string;
    expect(JSON.parse(stored).maxSendsPerDay).toBe(10);
  });

  it('evaluates every guardrail refusal deterministically', async () => {
    const base = { policy: supervised(), now: new Date('2026-10-22T10:00:00Z'), timeZone: 'Europe/Paris', sendsToday: 0, targetId: 'target-a', targetCreatedAt: new Date('2026-01-01T00:00:00Z'), targetEverPublished: true, requiresApproval: false };
    expect(evaluateAutoSchedule(base)).toEqual({ ok: true });
    expect(evaluateAutoSchedule({ ...base, requiresApproval: true })).toEqual({ ok: false, reason: 'approval_required' });
    expect(evaluateAutoSchedule({ ...base, policy: supervised({ targetIds: ['other'] }) })).toEqual({ ok: false, reason: 'out_of_scope' });
    expect(evaluateAutoSchedule({ ...base, policy: supervised({ draftsOnlyTargetIds: ['target-a'] }) })).toEqual({ ok: false, reason: 'drafts_only' });
    expect(evaluateAutoSchedule({ ...base, targetCreatedAt: new Date('2026-10-20T00:00:00Z') })).toEqual({ ok: false, reason: 'new_destination' });
    expect(evaluateAutoSchedule({ ...base, targetEverPublished: false })).toEqual({ ok: false, reason: 'uncertain_destination' });
    expect(evaluateAutoSchedule({ ...base, now: new Date('2026-10-22T23:30:00Z') })).toEqual({ ok: false, reason: 'quiet_hours' });
    expect(evaluateAutoSchedule({ ...base, now: new Date('2026-10-22T04:00:00Z') })).toEqual({ ok: false, reason: 'quiet_hours' });
    expect(evaluateAutoSchedule({ ...base, sendsToday: 10 })).toEqual({ ok: false, reason: 'daily_cap' });
  });

  it('skips manual workspaces in the worker without claiming the day', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM ai_agents')) return [agent];
      if (sql.includes('FROM autopilot_policies')) return [{ tier: 'manual', guardrails: {} }];
      if (sql.includes('FROM memberships')) return [{ id: 'user-a' }];
      return [];
    });
    const summary = await runDueScheduledAgents(new Date('2026-10-22T08:00:00Z'));
    expect(summary).toContain('skipped=1');
    expect(mocks.createPost).not.toHaveBeenCalled();
    expect(mocks.executeRaw.mock.calls.map(sqlOf).some(sql => sql.includes('SET "lastRunOn"'))).toBe(false);
  });

  it('schedules supervised-auto drafts through the queue and audits every auto action with actor=tier', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM ai_agents')) return [agent];
      if (sql.includes('FROM autopilot_policies')) return [{ tier: 'supervised_auto', guardrails: {} }];
      if (sql.includes('FROM targets t WHERE')) return [{ createdAt: new Date('2026-01-01T00:00:00Z'), everPublished: true }];
      if (sql.includes('FROM workspaces WHERE')) return [{ requiresApproval: false }];
      if (sql.includes('COUNT(*)')) return [{ count: BigInt(0) }];
      if (sql.includes('FROM memberships')) return [{ id: 'user-a' }];
      return [];
    });
    const summary = await runDueScheduledAgents(new Date('2026-10-22T08:00:00Z'));
    expect(summary).toBe('agents=1 drafts=2 skipped=0 failed=0 autoScheduled=2 autoRefused=0');
    expect(mocks.queuePost).toHaveBeenCalledTimes(2);
    const values = mocks.executeRaw.mock.calls.flatMap(call => call.slice(1));
    expect(values.filter(value => value === 'agents.scheduled.auto_scheduled')).toHaveLength(2);
    const detail = values.find(value => typeof value === 'string' && value.includes('agents.scheduled.auto_scheduled') === false && value.includes('"actor":"autopilot"')) as string;
    expect(JSON.parse(detail)).toMatchObject({ actor: 'autopilot', tier: 'supervised_auto', agentId: 'agent-a' });
    // Worker rows keep actorId NULL; the tier travels in the detail.
    const inserts = mocks.executeRaw.mock.calls.map(sqlOf).filter(sql => sql.includes('INSERT INTO activity_logs'));
    expect(inserts.some(sql => sql.includes(', NULL,'))).toBe(true);
  });

  it('holds supervised drafts on guardrail refusal and keeps honest drafts', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM ai_agents')) return [agent];
      if (sql.includes('FROM autopilot_policies')) return [{ tier: 'supervised_auto', guardrails: {} }];
      if (sql.includes('FROM targets t WHERE')) return [{ createdAt: new Date('2026-01-01T00:00:00Z'), everPublished: true }];
      if (sql.includes('FROM workspaces WHERE')) return [{ requiresApproval: false }];
      if (sql.includes('COUNT(*)')) return [{ count: BigInt(0) }];
      if (sql.includes('FROM memberships')) return [{ id: 'user-a' }];
      return [];
    });
    // 21:30 UTC is 23:30 in Europe/Paris: still Thursday, inside quiet hours.
    const summary = await runDueScheduledAgents(new Date('2026-10-22T21:30:00Z'));
    expect(summary).toBe('agents=1 drafts=2 skipped=0 failed=0 autoScheduled=0 autoRefused=2');
    expect(mocks.queuePost).not.toHaveBeenCalled();
    const values = mocks.executeRaw.mock.calls.flatMap(call => call.slice(1));
    expect(values.filter(value => value === 'agents.scheduled.auto_refused')).toHaveLength(2);
    const detail = values.find(value => typeof value === 'string' && value.includes('"reason":"quiet_hours"')) as string;
    expect(JSON.parse(detail)).toMatchObject({ actor: 'autopilot', tier: 'supervised_auto', reason: 'quiet_hours' });
  });

  it('refuses a full daily cap before touching the queue', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM ai_agents')) return [agent];
      if (sql.includes('FROM autopilot_policies')) return [{ tier: 'supervised_auto', guardrails: {} }];
      if (sql.includes('FROM targets t WHERE')) return [{ createdAt: new Date('2026-01-01T00:00:00Z'), everPublished: true }];
      if (sql.includes('FROM workspaces WHERE')) return [{ requiresApproval: false }];
      if (sql.includes('agents.scheduled.auto_scheduled')) return [{ count: BigInt(10) }];
      if (sql.includes('COUNT(*)')) return [{ count: BigInt(0) }];
      if (sql.includes('FROM memberships')) return [{ id: 'user-a' }];
      return [];
    });
    const summary = await runDueScheduledAgents(new Date('2026-10-22T08:00:00Z'));
    expect(summary).toContain('autoScheduled=0 autoRefused=2');
    expect(mocks.queuePost).not.toHaveBeenCalled();
  });

  it('serves tier changes through the scheduled REST service and MCP with the same confirmations', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('SELECT id FROM targets')) return [{ id: 'target-a' }];
      if (sql.includes('FROM autopilot_policies')) return [];
      return [];
    });
    const rest = await scheduledAgents(actor, { action: 'tier', tier: 'manual', confirmation: 'SET AUTOPILOT TIER manual' }) as { ok: boolean };
    expect(rest.ok).toBe(true);
    const group = AGENTS_MCP[0]!;
    const mcp = await group.execute({ userId: 'user-a', workspaceId: 'workspace-a' } as never, 'manage_autopilot_tier', { tier: 'assisted', confirmation: 'SET AUTOPILOT TIER assisted' }, 100) as { ok: boolean };
    expect(mcp.ok).toBe(true);
    await expect(group.execute({ userId: 'user-a', workspaceId: 'workspace-a' } as never, 'manage_autopilot_tier', { tier: 'manual', confirmation: 'wrong' }, 100)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(group.writeTools).toContain('manage_autopilot_tier');
  });
});
