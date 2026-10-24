import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_COPY, CHAT_POLICY } from '@/modules/notifications/chat-channels/config';
import { chatConfirmation } from '@/modules/notifications/chat-channels/contracts';

const mocks = vi.hoisted(() => ({
  user: vi.fn(), member: vi.fn(), query: vi.fn(), txQuery: vi.fn(), execute: vi.fn(), purge: vi.fn(), transaction: vi.fn(),
  entitlement: vi.fn(), permission: vi.fn(), feature: vi.fn(), access: vi.fn(), config: vi.fn(), deliver: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: { user: { findUnique: mocks.user }, membership: { findUnique: mocks.member }, $queryRaw: mocks.query, $transaction: mocks.transaction } }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: mocks.entitlement, canUseFeature: mocks.feature }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: mocks.permission }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: mocks.access }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/server/secret-crypto', () => ({ encryptSecret: mocks.encrypt, decryptSecret: mocks.decrypt }));
vi.mock('@/modules/notifications/chat-channels/server/transport', async original => ({ ...await original<typeof import('@/modules/notifications/chat-channels/server/transport')>(), deliverChat: mocks.deliver }));
import { createChatChannel, deleteChatChannel, listChatChannels, testChatChannel, updateChatChannel } from '@/modules/notifications/chat-channels/server/service';
import { executeChatTool } from '@/modules/notifications/chat-channels/mcp';

const actor = { userId: 'owner', workspaceId: 'workspace-a' };
const row = { id: 'destination-a', kind: 'slack', name: 'Team', enabled: true, events: ['publishFailure'], lastSentAt: null, hasError: true };
const input = { kind: 'slack', name: 'Team', url: 'https://hooks.slack.com/services/T00000000/B00000000/abcdefghijklmnopqrstuv', events: ['publishFailure'], confirmation: chatConfirmation.create('Team') };
function sql(strings: TemplateStringsArray) { return strings.join('?'); }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ disabledAt: null }); mocks.member.mockResolvedValue({ role: 'owner' });
  mocks.entitlement.mockResolvedValue({ workspaceId: actor.workspaceId }); mocks.permission.mockResolvedValue({ pageScope: { all: true } }); mocks.feature.mockReturnValue(true); mocks.access.mockReturnValue(true);
  mocks.config.mockImplementation(async key => key === 'notifications.chatPolicy' ? CHAT_POLICY : CHAT_COPY);
  mocks.query.mockImplementation(async (strings: TemplateStringsArray) => sql(strings).includes('FROM workspaces') ? [{ suspendedAt: null }] : sql(strings).includes('FROM users') ? [{ locale: 'en' }] : [row]);
  mocks.txQuery.mockImplementation(async (strings: TemplateStringsArray) => {
    const query = sql(strings);
    if (query.includes('FROM workspaces')) return [{ suspendedAt: null }];
    if (query.includes('COUNT(*)')) return [{ count: BigInt(0) }];
    if (query.includes('FROM chat_channels')) return [{ ...row, secret: 'encrypted-secret' }];
    return [{ id: 'member-a' }];
  });
  mocks.execute.mockResolvedValue(1); mocks.purge.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async run => run({ $queryRaw: mocks.txQuery, $executeRaw: mocks.execute, workspaceDataPurge: { findUnique: mocks.purge } }));
  mocks.encrypt.mockReturnValue('encrypted-secret'); mocks.decrypt.mockReturnValue(JSON.stringify({ url: input.url })); mocks.deliver.mockResolvedValue('accepted');
});
describe('team chat service security and writes', () => {
  it.each(['owner', 'admin'])('permits current %s and strips credentials/errors from reads', async role => {
    mocks.member.mockResolvedValue({ role }); const result = await listChatChannels(actor);
    expect(result.channels).toEqual([row]); expect(JSON.stringify(result)).not.toContain('encrypted-secret');
    const query = mocks.query.mock.calls.find(call => sql(call[0]).includes('FROM chat_channels'));
    expect(query?.slice(1)).toContain('workspace-a');
  });
  it.each(['member', 'viewer', 'editor', 'client'])('denies %s before destination reads or writes', async role => {
    mocks.member.mockResolvedValue({ role });
    await expect(listChatChannels(actor)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createChatChannel(actor, input)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('denies nonmembers, disabled accounts, suspended tenants and restricted keys', async () => {
    mocks.member.mockResolvedValue(null); await expect(listChatChannels(actor)).rejects.toMatchObject({ code: 'forbidden' });
    mocks.member.mockResolvedValue({ role: 'owner' }); mocks.user.mockResolvedValue({ disabledAt: new Date() });
    await expect(listChatChannels(actor)).rejects.toMatchObject({ code: 'forbidden' });
    mocks.user.mockResolvedValue({ disabledAt: null });
    await expect(listChatChannels({ ...actor, allowedChannelIds: [] })).rejects.toMatchObject({ code: 'forbidden' });
    mocks.query.mockResolvedValue([{ suspendedAt: new Date() }]);
    await expect(listChatChannels(actor)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('denies stale entitlements and revoked feature permissions', async () => {
    mocks.entitlement.mockResolvedValue({ workspaceId: 'other-tenant' }); await expect(listChatChannels(actor)).rejects.toMatchObject({ code: 'forbidden' });
    mocks.entitlement.mockResolvedValue({ workspaceId: actor.workspaceId }); mocks.access.mockReturnValue(false); await expect(listChatChannels(actor)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('creates encrypted legacy-compatible records with atomic content-free audit', async () => {
    const result = await createChatChannel(actor, input);
    expect(result.saved).toBe(true); expect(mocks.encrypt).toHaveBeenCalledWith(JSON.stringify({ url: input.url }));
    const audits = mocks.execute.mock.calls.filter(call => sql(call[0]).includes('activity_logs'));
    expect(audits).toHaveLength(1); expect(JSON.stringify(audits)).not.toContain(input.url); expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it('enforces non-default Root limits and complete directory refusal', async () => {
    mocks.config.mockImplementation(async key => key === 'notifications.chatPolicy' ? { ...CHAT_POLICY, maxNameCharacters: 2, maxChannels: 1 } : CHAT_COPY);
    await expect(createChatChannel(actor, input)).rejects.toMatchObject({ code: 'invalid_request' });
    mocks.query.mockImplementation(async strings => sql(strings).includes('FROM chat_channels') ? [row, row] : sql(strings).includes('FROM workspaces') ? [{ suspendedAt: null }] : [{ locale: 'en' }]);
    await expect(listChatChannels(actor)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('refuses missing confirmation equally through MCP and direct service', async () => {
    await expect(createChatChannel(actor, { ...input, confirmation: '' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeChatTool(actor, 'create_chat_channel', { ...input, confirmation: '' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each(['update', 'delete', 'test'] as const)('prevents cross-workspace %s with scoped row lookup', async action => {
    mocks.txQuery.mockImplementation(async strings => sql(strings).includes('FROM chat_channels') ? [] : [{ suspendedAt: null }]);
    const value = { id: 'other-tenant-destination', confirmation: chatConfirmation[action]('other-tenant-destination'), ...(action === 'update' ? { enabled: false } : {}) };
    const operation = action === 'update' ? updateChatChannel : action === 'delete' ? deleteChatChannel : testChatChannel;
    await expect(operation(actor, value)).rejects.toMatchObject({ code: 'not_found' });
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.deliver).not.toHaveBeenCalled();
    const query = mocks.txQuery.mock.calls.find(call => sql(call[0]).includes('FROM chat_channels'));
    expect(query?.slice(1)).toContain('workspace-a');
  });
  it('rechecks role under lock and blocks purge before mutation', async () => {
    mocks.member.mockResolvedValueOnce({ role: 'owner' }).mockResolvedValue({ role: 'viewer' });
    await expect(createChatChannel(actor, input)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.execute).not.toHaveBeenCalled();
    mocks.member.mockResolvedValue({ role: 'owner' }); mocks.purge.mockResolvedValue({ status: 'running' });
    await expect(createChatChannel(actor, input)).rejects.toMatchObject({ code: 'conflict' });
  });
  it('reports uncertain delivery without retry or raw secret errors', async () => {
    mocks.deliver.mockResolvedValue('uncertain');
    const result = await testChatChannel(actor, { id: row.id, confirmation: chatConfirmation.test(row.id) });
    expect(result).toEqual({ id: row.id, outcome: 'uncertain' }); expect(mocks.deliver).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls.some(call => sql(call[0]).includes('"lastSentAt" = CASE'))).toBe(true);
  });
  it('uses the saved French Root catalog for tests', async () => {
    mocks.query.mockImplementation(async strings => sql(strings).includes('FROM users') ? [{ locale: 'fr' }] : [{ suspendedAt: null }]);
    await testChatChannel(actor, { id: row.id, confirmation: chatConfirmation.test(row.id) });
    expect(mocks.deliver.mock.calls[0]?.[2]).toBe(CHAT_COPY.fr.testMessage);
  });
});
