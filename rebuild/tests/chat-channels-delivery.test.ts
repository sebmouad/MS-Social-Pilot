import { beforeEach, expect, it, vi } from 'vitest';
import { baselineBlock } from './baseline-block';
import { CHAT_COPY, CHAT_POLICY } from '@/modules/notifications/chat-channels/config';
const mock = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), tx: vi.fn(), config: vi.fn(), deliver: vi.fn(), entitlement: vi.fn(), permission: vi.fn(), eligible: vi.fn() }));
vi.mock('@/modules/settings/notifications/server', () => ({ notificationRecipientEligible: mock.eligible }));
vi.mock('@/server/data', () => ({ prisma: { $transaction: mock.tx, $queryRaw: mock.query, $executeRaw: mock.execute } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mock.config }));
vi.mock('@/server/secret-crypto', () => ({ decryptSecret: () => '{"url":"https://hooks.slack.com/services/abcdefghijklmnopqrstuv"}' }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: mock.entitlement, canUseFeature: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: mock.permission }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/modules/notifications/chat-channels/server/transport', () => ({ deliverChat: mock.deliver }));
import { enqueueChatEvent, enqueueOperatorIncident, runChatDeliveries } from '@/modules/notifications/chat-channels/server/delivery';
const sql = (strings: TemplateStringsArray) => strings.join('?');
const tx = { $queryRaw: mock.query, $executeRaw: mock.execute } as never;
beforeEach(() => {
 vi.resetAllMocks(); mock.execute.mockResolvedValue(1); mock.tx.mockImplementation(async run => run(tx));
 mock.config.mockImplementation(async key => key === 'notifications.chatPolicy' ? CHAT_POLICY : CHAT_COPY);
 mock.entitlement.mockResolvedValue({ workspaceId: 'tenant' }); mock.permission.mockResolvedValue({ pageScope: { all: true } }); mock.deliver.mockResolvedValue('accepted'); mock.eligible.mockResolvedValue(true);
 mock.query.mockImplementation(async strings => {
  const q = sql(strings);
  if (q.includes("SELECT id FROM rebuild_chat_deliveries WHERE status = 'pending'")) return [{ id:'delivery' }];
  if (q.includes('WITH candidates')) return [{ id: 'delivery', channelId: 'chat', workspaceId: 'tenant', event: 'publishFailure', source: {eventId:'event',workspaceId:'tenant',kind:'publish_failure',postId:'post'} }];
  if (q.includes('SELECT c.id')) return [{ id: 'chat', kind: 'slack', secret: 'encrypted', events: ['publishFailure'], enabled: true }];
  if (q.includes('SELECT m."userId"')) return [{ userId: 'owner', locale: 'fr' }];
  if (q.includes('SELECT id FROM chat_channels')) return [{ id: 'chat' }];
  if (q.includes('FROM workspaces')) return [{ id: 'tenant' }];
  return [];
 });
});
it('enqueues content-free, tenant-scoped per-destination idempotent intents', async () => {
 expect(await enqueueChatEvent(tx, { eventId: 'event', workspaceId: 'tenant', event: 'publishFailure' })).toBe(1);
 const inserts=mock.execute.mock.calls.filter(c=>sql(c[0]).includes('INSERT INTO rebuild_chat_deliveries'));
 expect(inserts).toHaveLength(1); expect(sql(inserts[0][0])).toContain('ON CONFLICT'); expect(inserts[0]).toContain('tenant'); expect(inserts[0]).toContain('event');
});
it('dispatches French Root copy after committed claim and records acceptance', async () => {
 const result = await runChatDeliveries(); expect(result.accepted).toBe(1);
 expect(mock.deliver).toHaveBeenCalledWith('slack', expect.any(Object), CHAT_COPY.fr.publishFailureMessage, expect.any(Object));
 expect(mock.execute.mock.calls.some(c=>sql(c[0]).includes('activity_logs'))).toBe(true);
});
it('does not replay uncertain network sends and expires stale claims as uncertain', async () => {
 mock.deliver.mockResolvedValue('uncertain'); const result=await runChatDeliveries(); expect(result.uncertain).toBe(1); expect(mock.deliver).toHaveBeenCalledTimes(1);
 expect(mock.execute.mock.calls.some(c=>sql(c[0]).includes("status = 'uncertain'"))).toBe(true);
});
it('cancels when destination subscription was removed after enqueue', async () => {
 mock.query.mockImplementation(async strings => sql(strings).includes('FROM rebuild_chat_deliveries') ? [{ id:'delivery', channelId:'chat',workspaceId:'tenant',event:'publishFailure' }] : []);
 expect((await runChatDeliveries()).cancelled).toBe(1); expect(mock.deliver).not.toHaveBeenCalled();
});
it('never broadens operator incidents without an explicitly selected workspace', async () => {
 expect(await enqueueOperatorIncident(tx, { eventId:'incident',state:'open',workspaceId:'' })).toBe(0); expect(mock.execute).not.toHaveBeenCalled();
});

it('restricts operator incidents to the configured active owner workspace', async () => {
 expect(await enqueueOperatorIncident(tx, { eventId:'incident',state:'open',workspaceId:'tenant' })).toBe(1);
 const scope=mock.query.mock.calls.find(c=>sql(c[0]).includes('SELECT w.id'))!;
 expect(scope).toContain('tenant'); expect(sql(scope[0])).toContain('u."isInstanceOwner" = true');
 expect(sql(scope[0])).toContain('workspace_data_purges'); expect(sql(scope[0])).not.toContain('rebuild_workspace_data_purges');
});
it('does not send again when another worker owns the per-message claim', async () => {
 const normal=mock.query.getMockImplementation()!;
 mock.query.mockImplementation(async (...args) => sql(args[0]).includes('WITH candidates') ? [] : normal(...args));
 expect(await runChatDeliveries()).toEqual({accepted:0,rejected:0,uncertain:0,cancelled:0}); expect(mock.deliver).not.toHaveBeenCalled();
});
it('cancels stale cross-workspace entitlements before remote I/O', async () => {
 mock.entitlement.mockResolvedValue({workspaceId:'other-tenant'});
 expect((await runChatDeliveries()).cancelled).toBe(1); expect(mock.deliver).not.toHaveBeenCalled();
});
it('fails closed for a suspended workspace or a departed installation owner', async () => {
 const normal=mock.query.getMockImplementation()!;
 mock.query.mockImplementation(async (...args) => sql(args[0]).includes('SELECT m."userId"') ? [] : normal(...args));
 expect((await runChatDeliveries()).cancelled).toBe(1); expect(mock.deliver).not.toHaveBeenCalled();
});

it('cancels resource alerts after selection or event permission is revoked', async () => {
 mock.eligible.mockResolvedValue(false);
 expect((await runChatDeliveries()).cancelled).toBe(1); expect(mock.deliver).not.toHaveBeenCalled();
 expect(mock.eligible).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({workspaceId:'tenant',userId:'owner',kind:'publish_failure',postId:'post'}));
});

it('migration binds deliveries to the same tenant destination and blocks purge-time writes', () => {
 const migration=baselineBlock('20261022190000_rebuild_chat_deliveries');
 expect(migration).toContain('FOREIGN KEY ("channelId", "workspaceId") REFERENCES chat_channels(id, "workspaceId") ON DELETE CASCADE');
 expect(migration).toContain('UNIQUE ("workspaceId", "channelId", "eventId", event)');
 expect(migration).toContain('BEFORE INSERT OR UPDATE ON public.rebuild_chat_deliveries');
 expect(migration).toContain('public.rebuild_reject_purging_workspace_write()');
});
