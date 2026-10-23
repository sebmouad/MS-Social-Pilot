import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), target: vi.fn(), access: vi.fn(),
  secrets: {} as Record<string, string | null>, overrides: {} as Record<string, unknown>,
}));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: m.query, $executeRaw: m.execute, $transaction: m.transaction, target: { findFirst: m.target } } }));
vi.mock('@/server/config/store', async () => {
  const { AI_CONFIG } = await import('../src/modules/studio/config');
  const defaults: Record<string, unknown> = { ...Object.fromEntries(AI_CONFIG.map(e => [e.key, e.defaultValue])), 'ai.enabled': true };
  return {
    runtimeSecret: async (key: string) => (key in m.secrets ? m.secrets[key] : null),
    runtimeConfigBatch: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, m.overrides[key] ?? defaults[key]])),
  };
});
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: async (_w: string, fn: () => unknown) => fn() }));
vi.mock('@/server/platforms/resource-lock', () => ({ withSelectedResourceOperation: async (_w: string, _r: unknown, fn: (tx: unknown, signal: AbortSignal) => unknown) => fn({ $executeRaw: m.execute }, new AbortController().signal) }));
vi.mock('@/modules/studio/server/usage', async importOriginal => ({ ...await importOriginal<typeof import('@/modules/studio/server/usage')>(), recordUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/server/jobs/access', () => ({ assertWorkspaceJobAccess: m.access }));
vi.mock('@/modules/inbox/server/comment-guard', () => ({ lockInboxChannel: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/modules/inbox/server/providers', () => ({ inboxTargetWhere: vi.fn().mockResolvedValue({ enabled: true }) }));

import { classifyCommentSentiment } from '@/modules/studio/server/sentiment';

const now = new Date('2026-10-23T12:00:00Z');
const port = () => ({ complete: vi.fn().mockResolvedValue('positive') });
const SECRET_FOR: Record<string, string> = {
  anthropic: 'ai.apiKey', openai: 'ai.openaiApiKey', gemini: 'ai.geminiApiKey', llama: 'ai.llamaApiKey',
};

beforeEach(() => {
  vi.clearAllMocks();
  m.secrets = {}; m.overrides = {};
  m.target.mockResolvedValue({ id: 't' }); m.access.mockResolvedValue(undefined); m.execute.mockResolvedValue(1);
  m.transaction.mockImplementation(fn => fn({ $queryRaw: m.query, $executeRaw: m.execute }));
  m.query.mockImplementation(async (sql: TemplateStringsArray) => {
    const q = sql.join('?');
    if (q.includes('SELECT COUNT(*)::bigint')) return [{ count: BigInt(0) }];
    if (q.includes('UPDATE post_comments')) return [{ message: 'Lovely post' }];
    if (q.includes('SELECT true AS ok')) return [{ ok: true }];
    if (q.includes('SELECT c.id')) return [{ id: 'c', workspaceId: 'w', targetId: 't', provider: 'synthetic' }];
    return [];
  });
});

for (const provider of ['anthropic', 'openai', 'gemini', 'llama'] as const) {
  it(`follows the configured ${provider} key and provenance`, async () => {
    m.overrides['ai.provider'] = provider;
    m.secrets[SECRET_FOR[provider]] = `${provider}-key`;
    const p = port();
    await expect(classifyCommentSentiment(now, { port: p })).resolves.toEqual({ available: true, classified: 1 });
    expect(p.complete).toHaveBeenCalledOnce();
    const values = m.execute.mock.calls.flatMap(call => call.slice(1));
    const provenance = values.find((v: unknown) => typeof v === 'string' && (v as string).includes('inputHash')) as string;
    expect(JSON.parse(provenance).provider).toBe(provider);
  });

  it(`stays unavailable for ${provider} when only another provider key exists`, async () => {
    m.overrides['ai.provider'] = provider;
    const other = provider === 'anthropic' ? 'openai' : 'anthropic';
    m.secrets[SECRET_FOR[other]] = `${other}-key`;
    m.secrets[SECRET_FOR[provider]] = null;
    const p = port();
    await expect(classifyCommentSentiment(now, { port: p })).resolves.toEqual({ available: false, classified: null });
    expect(p.complete).not.toHaveBeenCalled();
    expect(m.query).not.toHaveBeenCalled();
  });
}

it('stays unavailable for an unknown provider id', async () => {
  m.overrides['ai.provider'] = 'unknown-provider';
  m.secrets['ai.apiKey'] = 'key';
  const p = port();
  await expect(classifyCommentSentiment(now, { port: p })).resolves.toEqual({ available: false, classified: null });
  expect(p.complete).not.toHaveBeenCalled();
});
