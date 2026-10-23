import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_COPY, CHAT_POLICY } from '@/modules/notifications/chat-channels/config';
import { INTEGRATIONS_CONFIG } from '@/modules/integrations/config';

const state = vi.hoisted(() => ({
  stagingDryRun: false,
  chatPending: [] as Array<{ id: string; workspaceId: string }>,
  webhookDue: [] as Array<{ id: string; workspaceId: string }>,
  audits: [] as Array<{ workspaceId: string; job: string; kind: string; count: number; sampleIds: string[] }>,
  chatSent: 0,
  webhookSent: 0,
}));

const INTEGRATION_DEFAULTS: Record<string, unknown> = Object.fromEntries(INTEGRATIONS_CONFIG.map(item => [item.key, item.defaultValue]));

vi.mock('@/server/config/store', () => ({
  runtimeConfig: vi.fn(async (key: string) => {
    if (key === 'jobs.stagingDryRun') return state.stagingDryRun;
    if (key === 'notifications.chatPolicy') return CHAT_POLICY;
    if (key === 'notifications.chatCopy') return CHAT_COPY;
    if (key === 'data.workspaceOperationTimeoutMs') return 30000;
    if (key in INTEGRATION_DEFAULTS) return INTEGRATION_DEFAULTS[key];
    return null;
  }),
  runtimeSecret: vi.fn(async () => null),
}));

vi.mock('@/server/data', () => {
  const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM rebuild_chat_deliveries WHERE status')) return state.chatPending;
    if (sql.includes('FROM webhook_deliveries d2')) return state.webhookDue;
    return [];
  });
  const executeRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('INSERT INTO root_activities')) {
      state.audits.push(JSON.parse(values[1] as string) as (typeof state.audits)[number]);
      return 1;
    }
    if (sql.includes('UPDATE rebuild_chat_deliveries SET status')) return 0;
    if (sql.includes('UPDATE webhook_endpoints')) return 0;
    if (sql.includes('DELETE FROM webhook_deliveries')) return 0;
    return 1;
  });
  return { prisma: { $queryRaw: queryRaw, $executeRaw: executeRaw, $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({ $queryRaw: queryRaw, $executeRaw: executeRaw }) } };
});

vi.mock('@/modules/notifications/chat-channels/server/transport', () => ({
  deliverChat: vi.fn(async () => { state.chatSent++; return 'accepted' as const; }),
}));

vi.mock('@/modules/integrations/server/webhook-transport', async importOriginal => {
  const original = await importOriginal<typeof import('@/modules/integrations/server/webhook-transport')>();
  return {
    ...original,
    sendSigned: vi.fn(async () => { state.webhookSent++; return { ok: true, status: 200, error: null, retryable: false }; }),
  };
});

vi.mock('@/modules/integrations/server/events', () => ({
  emitRecentEvents: vi.fn(async () => ({ examined: 0, queued: 1 })),
  emitWebhook: vi.fn(async () => ({ queued: 0, dropped: false })),
  emitRecentPostEvents: vi.fn(async () => ({ examined: 0, queued: 0 })),
}));

import { runChatDeliveries } from '@/modules/notifications/chat-channels/server/delivery';
import { deliverDueWebhooks } from '@/modules/integrations/server/webhooks';

beforeEach(() => {
  state.stagingDryRun = false;
  state.chatPending = [];
  state.webhookDue = [];
  state.audits = [];
  state.chatSent = 0;
  state.webhookSent = 0;
});

describe('staging dry-run outbound boundary', () => {
  it('suppresses worker chat notifications and audits per workspace', async () => {
    state.chatPending = [{ id: 'c1', workspaceId: 'w1' }, { id: 'c2', workspaceId: 'w2' }];
    state.stagingDryRun = true;
    const result = await runChatDeliveries(new Date('2026-10-23T01:00:00Z'));
    expect(result).toEqual({ accepted: 0, rejected: 0, uncertain: 0, cancelled: 0 });
    expect(state.chatSent).toBe(0);
    expect(state.audits).toHaveLength(2);
    expect(state.audits[0]).toMatchObject({ job: 'notifications', kind: 'chat_notification', count: 1 });
    expect(state.audits[1]).toMatchObject({ job: 'notifications', kind: 'chat_notification', count: 1 });
  });

  it('suppresses worker webhook deliveries but still queues events and purges', async () => {
    state.webhookDue = [{ id: 'd1', workspaceId: 'w1' }, { id: 'd2', workspaceId: 'w1' }];
    state.stagingDryRun = true;
    const result = await deliverDueWebhooks(undefined, new Date('2026-10-23T01:00:00Z'));
    expect(result).toMatchObject({ delivered: 0, retrying: 0, failed: 0, events: 1 });
    expect(state.webhookSent).toBe(0);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ job: 'webhooks', kind: 'outbound_webhook', count: 2, sampleIds: ['d1', 'd2'] });
  });

  it('sends nothing to audit when no outbound work is pending', async () => {
    state.stagingDryRun = true;
    await runChatDeliveries(new Date('2026-10-23T01:00:00Z'));
    await deliverDueWebhooks(undefined, new Date('2026-10-23T01:00:00Z'));
    expect(state.audits).toEqual([]);
    expect(state.chatSent).toBe(0);
    expect(state.webhookSent).toBe(0);
  });
});
