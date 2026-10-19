import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: { postComment: { findFirst: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() },
  config: vi.fn(), authorize: vi.fn(), workspace: vi.fn(), permissions: vi.fn(), capabilities: vi.fn(), moderate: vi.fn(), reply: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/modules/inbox/server/access', () => ({ authorizeInbox: mocks.authorize }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: mocks.workspace }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('@/modules/inbox/server/providers', () => ({ inboxCapabilities: mocks.capabilities }));
vi.mock('@/modules/inbox/server/actions', () => ({ moderateInboxComment: mocks.moderate, replyToInbox: mocks.reply }));

import { fillModerationReply, foldText, matchesModerationRule, moderationConfirmation, moderationCopy } from '../src/modules/inbox/moderation';
import { performInboxModerationAction, readInboxModeration, runInboxModerationRules } from '../src/modules/inbox/server/moderation';
import { executeInboxModerationTool, inboxModerationToolDefinitions, inboxModerationWriteTools } from '../src/modules/inbox/moderation-mcp';

const actor = { userId: 'member-a', workspaceId: 'workspace-a' };
const caps = { 'inbox.moderationRuleLimit': 50, 'inbox.moderationLogLimit': 100, 'inbox.moderationFreshHours': 48, 'inbox.moderationRunMaxComments': 200 };
const sqlText = (query: unknown) => Array.isArray(query) ? query.join('?') : (query as { sql?: string; strings?: string[] })?.strings?.join('?') ?? (query as { sql?: string })?.sql ?? String(query);
const rule = { name: 'Spam links', enabled: true, targetIds: [] as string[], match: 'links', keywords: [] as string[], action: 'hide', replyText: null as string | null, dailyCap: 20, oncePerUser: true };
let rules: Array<typeof rule & { id: string }> = []; let comments: unknown[] = []; let logRows: unknown[] = []; let counts = 0; let claimed = 1;

beforeEach(() => {
  vi.clearAllMocks(); rules = []; comments = []; logRows = []; counts = 0; claimed = 1;
  mocks.config.mockImplementation(async (key: string) => caps[key as keyof typeof caps]);
  mocks.authorize.mockResolvedValue({ channelIds: ['channel-a'], channels: [{ id: 'channel-a', name: 'Bakery' }], timeZone: 'UTC' });
  mocks.permissions.mockResolvedValue({ pageScope: { all: true, ids: [] } });
  mocks.capabilities.mockResolvedValue({ reply: true, hide: true, remove: true });
  mocks.moderate.mockResolvedValue({ ok: true }); mocks.reply.mockResolvedValue({ ok: true });
  mocks.workspace.mockImplementation(async (_w: string, operation: () => Promise<unknown>) => operation());
  mocks.prisma.$transaction.mockImplementation(async (operation: (tx: typeof mocks.prisma) => Promise<unknown>) => operation(mocks.prisma));
  mocks.prisma.$queryRaw.mockImplementation(async (query: unknown) => {
    const sql = sqlText(query);
    if (sql.includes('FROM moderation_rules WHERE "workspaceId"') && sql.includes('SELECT id, name')) return rules;
    if (sql.includes('SELECT "targetIds" FROM moderation_rules')) return rules.slice(0, 1).map(r => ({ targetIds: r.targetIds }));
    if (sql.includes('COUNT(*)')) return [{ count: counts }];
    if (sql.includes('FROM post_comments')) return comments;
    if (sql.includes('FROM moderation_actions WHERE "workspaceId"')) return logRows;
    if (sql.includes('FROM moderation_actions WHERE id')) return logRows;
    return [];
  });
  mocks.prisma.$executeRaw.mockImplementation(async (query: unknown) => sqlText(query).includes('INSERT INTO moderation_actions') ? claimed : 1);
});

describe('moderation matcher (ported from legacy)', () => {
  it('finds links, phone numbers and folded keywords', () => {
    expect(matchesModerationRule({ match: 'links', keywords: [] }, 'see https://example.com/x')).toBe(true);
    expect(matchesModerationRule({ match: 'links', keywords: [] }, 'visit www.example.org now')).toBe(true);
    expect(matchesModerationRule({ match: 'links', keywords: [] }, 'great post, thanks!')).toBe(false);
    expect(matchesModerationRule({ match: 'phones', keywords: [] }, 'call +1 (555) 123-4567')).toBe(true);
    expect(matchesModerationRule({ match: 'phones', keywords: [] }, 'we were 12 people')).toBe(false);
    expect(matchesModerationRule({ match: 'keywords', keywords: ['Giveaway'] }, 'Free GÍVEAWAY here')).toBe(true);
    expect(matchesModerationRule({ match: 'keywords', keywords: ['giveaway'] }, 'nothing to see')).toBe(false);
    expect(matchesModerationRule({ match: 'keywords', keywords: ['x'] }, '   ')).toBe(false);
    expect(foldText('Prómo')).toBe('promo');
  });
  it('fills reply placeholders', () => {
    expect(fillModerationReply('Hi {first_name}, thanks from {page}!', { name: 'Alex Martin', channel: 'Client A' })).toBe('Hi Alex, thanks from Client A!');
    expect(fillModerationReply('Hi {first_name}, welcome', { name: null, channel: 'Client A' })).toBe('Hi, welcome');
  });
  it('ships every customer string in English and French', () => {
    expect(Object.keys(moderationCopy.fr).sort()).toEqual(Object.keys(moderationCopy.en).sort());
    for (const value of Object.values(moderationCopy.fr)) expect(value.trim()).not.toBe('');
  });
  it('keeps provider names out of shared moderation code', () => {
    for (const file of ['src/modules/inbox/moderation.ts', 'src/modules/inbox/server/moderation.ts', 'src/modules/inbox/moderation-mcp.ts', 'src/modules/inbox/components/ModerationRules.tsx']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/facebook|instagram|graph/i);
    }
  });
});

describe('moderation rules service', () => {
  it('requires the exact confirmation before writing', async () => {
    await expect(performInboxModerationAction(actor, { action: 'rule.create', rule, confirmation: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('creates a workspace rule with audit', async () => {
    const result = await performInboxModerationAction(actor, { action: 'rule.create', rule, confirmation: moderationConfirmation.create('Spam links') });
    expect(result).toMatchObject({ ok: true, action: 'rule.create' });
    const sql = mocks.prisma.$executeRaw.mock.calls.map(call => sqlText(call[0]));
    expect(sql.some(s => s.includes('INSERT INTO moderation_rules'))).toBe(true);
    expect(sql.some(s => s.includes('INSERT INTO activity_logs'))).toBe(true);
  });
  it('refuses incomplete rules and all-channel rules for limited members', async () => {
    await expect(performInboxModerationAction(actor, { action: 'rule.create', rule: { ...rule, match: 'keywords' }, confirmation: moderationConfirmation.create('Spam links') })).rejects.toMatchObject({ code: 'invalid_request' });
    mocks.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['channel-a'] } });
    await expect(performInboxModerationAction(actor, { action: 'rule.create', rule, confirmation: moderationConfirmation.create('Spam links') })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(performInboxModerationAction(actor, { action: 'rule.create', rule: { ...rule, targetIds: ['channel-b'] }, confirmation: moderationConfirmation.create('Spam links') })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('hides rules naming channels outside scope and limits credential ceilings', async () => {
    rules = [{ ...rule, id: 'r1' }, { ...rule, id: 'r2', targetIds: ['channel-b'] }];
    const all = await readInboxModeration(actor);
    expect(all.rules.map(r => r.id)).toEqual(['r1']);
    const limited = await readInboxModeration({ ...actor, allowedChannelIds: ['channel-a'] });
    expect(limited.rules).toEqual([]);
    expect(limited.canTargetAllChannels).toBe(false);
  });
  it('runs matching rules once through the shared hide service and skips the channel’s own words', async () => {
    rules = [{ ...rule, id: 'r1' }];
    comments = [
      { id: 'c1', remoteId: 'rc1', parentRemoteId: null, message: 'buy at spam.shop', fromId: 'person', fromName: 'Alex', targetId: 'channel-a', targetName: 'Bakery', channelIdentity: 'channel-remote', provider: 'p' },
      { id: 'c2', remoteId: 'rc2', parentRemoteId: null, message: 'see www.ours.com', fromId: 'channel-remote', fromName: null, targetId: 'channel-a', targetName: 'Bakery', channelIdentity: 'channel-remote', provider: 'p' },
      { id: 'c3', remoteId: 'rc3', parentRemoteId: null, message: 'lovely', fromId: 'person', fromName: 'Alex', targetId: 'channel-a', targetName: 'Bakery', channelIdentity: 'channel-remote', provider: 'p' },
    ];
    const result = await runInboxModerationRules(actor, null);
    expect(result).toMatchObject({ examined: 3, acted: 1, failed: 0 });
    expect(mocks.moderate).toHaveBeenCalledTimes(1);
    expect(mocks.moderate).toHaveBeenCalledWith(actor, { id: 'c1', hidden: true });
    claimed = 0; mocks.moderate.mockClear();
    await runInboxModerationRules(actor, null);
    expect(mocks.moderate).not.toHaveBeenCalled();
  });
  it('skips actions the channel module does not support and records failures', async () => {
    rules = [{ ...rule, id: 'r1' }];
    comments = [{ id: 'c1', remoteId: 'rc1', parentRemoteId: null, message: 'visit spam.shop', fromId: 'p1', fromName: 'A', targetId: 'channel-a', targetName: 'Bakery', channelIdentity: 'me', provider: 'p' }];
    mocks.capabilities.mockResolvedValue({ reply: false, hide: false, remove: false });
    expect(await runInboxModerationRules(actor, null)).toMatchObject({ acted: 0, skipped: 1 });
    mocks.capabilities.mockResolvedValue({ reply: true, hide: true, remove: true });
    const { OperationError } = await import('../src/lib/operation-error');
    mocks.moderate.mockRejectedValue(new OperationError('upstream_failure', 'Platform refused.'));
    expect(await runInboxModerationRules(actor, null)).toMatchObject({ acted: 0, failed: 1 });
    expect(mocks.prisma.$executeRaw.mock.calls.some(call => sqlText(call[0]).includes('SET error'))).toBe(true);
  });
  it('respects the daily cap and refuses an unknown channel', async () => {
    rules = [{ ...rule, id: 'r1', dailyCap: 1 }]; counts = 1;
    comments = [{ id: 'c1', remoteId: 'rc1', parentRemoteId: null, message: 'visit spam.shop', fromId: 'p1', fromName: 'A', targetId: 'channel-a', targetName: 'Bakery', channelIdentity: 'me', provider: 'p' }];
    expect(await runInboxModerationRules(actor, null)).toMatchObject({ acted: 0, skipped: 1 });
    await expect(runInboxModerationRules(actor, 'channel-z')).rejects.toMatchObject({ code: 'not_found' });
  });
  it('undoes only a visible, successful hide', async () => {
    logRows = [{ id: 'a1', targetId: 'channel-a', remoteCommentId: 'rc1', action: 'hide', error: null, undoneAt: null, ruleName: 'Spam' }];
    mocks.prisma.postComment.findFirst.mockResolvedValue({ id: 'c1' });
    const result = await performInboxModerationAction(actor, { action: 'action.undo', id: 'a1', confirmation: moderationConfirmation.undo('a1') });
    expect(result).toMatchObject({ ok: true, id: 'a1' });
    expect(mocks.moderate).toHaveBeenCalledWith(actor, { id: 'c1', hidden: false });
    logRows = [{ id: 'a2', targetId: 'channel-b', remoteCommentId: 'rc', action: 'hide', error: null, undoneAt: null, ruleName: 'S' }];
    await expect(performInboxModerationAction(actor, { action: 'action.undo', id: 'a2', confirmation: moderationConfirmation.undo('a2') })).rejects.toMatchObject({ code: 'not_found' });
    logRows = [{ id: 'a3', targetId: 'channel-a', remoteCommentId: 'rc', action: 'reply', error: null, undoneAt: null, ruleName: 'S' }];
    await expect(performInboxModerationAction(actor, { action: 'action.undo', id: 'a3', confirmation: moderationConfirmation.undo('a3') })).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('moderation MCP tools', () => {
  it('declares confirmations for every write and dispatches to the shared service', async () => {
    for (const tool of inboxModerationToolDefinitions) if (inboxModerationWriteTools.has(tool.name)) expect(tool.inputSchema.required).toContain('confirmation');
    rules = [{ ...rule, id: 'r1' }];
    await expect(executeInboxModerationTool(actor, 'get_inbox_moderation', {})).resolves.toMatchObject({ ok: true });
    await expect(executeInboxModerationTool(actor, 'delete_inbox_moderation_rule', { id: 'r1', confirmation: 'wrong' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeInboxModerationTool(actor, 'delete_inbox_moderation_rule', { id: 'r1', confirmation: moderationConfirmation.remove('r1') })).resolves.toMatchObject({ ok: true, action: 'rule.delete' });
  });
});
