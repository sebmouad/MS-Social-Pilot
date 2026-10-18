import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaults, install, state } from './sharing-helpers';

vi.mock('@/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: async () => ({provider:{in:['test-provider']}}) }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => (defaults as Record<string, unknown>)[key], runtimeConfigBatch: async (keys: readonly string[]) => Object.fromEntries(keys.map(key => [key, (defaults as Record<string, unknown>)[key]])) }));
vi.mock('@/server/entitlements', async () => (await import('./sharing-helpers')).entitlementMock());
vi.mock('@/server/permissions', async () => (await import('./sharing-helpers')).permissionMock());
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({ pageScope: state.scope }) }));
vi.mock('@/server/data-control/guard', async () => {
  const { OperationError } = await import('@/lib/operation-error');
  return { assertWorkspaceNotPurging: async () => { if (state.purging) throw new OperationError('conflict', 'Workspace data deletion is in progress.'); }, withWorkspaceOperation: async () => { throw new Error('sharing must not nest the workspace operation helper'); } };
});

import { createShareLink, deleteShareLink, listShareFeedback, listShareLinks, listShareableChannels, revokeShareLink, rotateShareLink, updateShareLink } from '../src/modules/sharing/server/links';
import { executeSharingTool, sharingToolDefinitions, sharingTools, sharingWriteTools } from '../src/modules/sharing/mcp';
import { SHARING_TOOL_ACCESS } from '../src/modules/sharing/semantics';
import { hashToken, linkVersion } from '../src/modules/sharing/contracts';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const create = { kind: 'review', title: 'Spring', targetIds: ['t1'], confirmation: 'CREATE SHARE LINK Spring' };
const linkRow = (targets: string[], extra: object = {}) => ({ id: 'shl_1', kind: 'review', decides: false, title: 'Spring', targetIds: targets, revokedAt: null, expiresAt: new Date('2099-01-01T00:00:00.000Z'), ...extra });
const listRow = (extra: object = {}) => ({ ...linkRow(['t1']), kind: 'review', description: null, daysBack: 7, daysAhead: 30, allowComments: true, decides: false, createdAt: new Date(), createdById: 'u', decisions: 0, ...extra });
const createWorld = () => { state.respond = sqlText => sqlText.includes('FROM targets') ? [{ id: 't1' }] : sqlText.includes('COUNT(*)') ? [{ count: BigInt(0) }] : undefined; };
beforeEach(() => install());

describe('sharing owner services', () => {
  it('selects channels only through a current same-workspace connection', async () => {
    await listShareableChannels(actor);
    const query = state.queries.find(q => q.sql.includes('FROM targets'))!;
    expect(query.sql).toContain('JOIN social_accounts');
    expect(query.sql).toContain('"invalidatedAt" IS NULL');
    expect(query.sql).toContain('a."workspaceId" = t."workspaceId"');
  });

  it('requires exact confirmation and strict input before touching the database', async () => {
    await expect(createShareLink(actor, { ...create, confirmation: 'create share link spring' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createShareLink(actor, { ...create, extra: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(revokeShareLink(actor, { id: 'shl_1', confirmation: 'REVOKE SHARE LINK other' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('allows only active owners and admins whose plan and role include the sharing feature', async () => {
    for (const role of ['editor', 'contributor', 'viewer', 'client']) { state.role = role; await expect(createShareLink(actor, create)).rejects.toMatchObject({ code: 'forbidden' }); }
    state.role = 'none'; await expect(createShareLink(actor, create)).rejects.toMatchObject({ code: 'unauthorized' });
    state.role = 'owner'; state.disabled = true; await expect(listShareLinks(actor)).rejects.toMatchObject({ code: 'unauthorized' });
    state.disabled = false; state.entitled = false; await expect(listShareLinks(actor)).rejects.toMatchObject({ code: 'forbidden' });
    state.entitled = true; state.moduleOn = false; await expect(listShareLinks(actor)).rejects.toMatchObject({ code: 'forbidden' });
    state.moduleOn = true; state.planDenied = ['settings/sharing']; await expect(listShareLinks(actor)).rejects.toMatchObject({ code: 'forbidden' });
    state.planDenied = []; state.writeDenied = ['settings/sharing']; await expect(createShareLink(actor, create)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listShareLinks(actor)).resolves.toMatchObject({ links: [] });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('keeps sharing and bio as independent features', async () => {
    const { readBioPage } = await import('../src/modules/sharing/server/bio');
    state.planDenied = ['settings/bio']; await expect(readBioPage(actor)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listShareLinks(actor)).resolves.toBeDefined();
    state.planDenied = ['settings/sharing']; await expect(listShareLinks(actor)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(readBioPage(actor)).resolves.toMatchObject({ page: null });
  });

  it('refuses writes in a suspended workspace and everything during erasure, reading still works when suspended', async () => {
    state.suspended = true; await expect(createShareLink(actor, create)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listShareLinks(actor)).resolves.toBeDefined();
    state.suspended = false; state.purging = true;
    await expect(createShareLink(actor, create)).rejects.toMatchObject({ code: 'conflict' });
    await expect(listShareLinks(actor)).rejects.toMatchObject({ code: 'conflict' });
    expect(state.executions).toHaveLength(0);
  });

  it('re-checks the actor, suspension and purge inside the write transaction, on one connection', async () => {
    createWorld(); await createShareLink(actor, create);
    expect(state.transactions).toBe(1);
    const order = state.queries.map(q => q.sql);
    const lockIndex = order.findIndex(s => s.includes('FROM workspaces WHERE id') && s.includes('FOR SHARE'));
    const purgeIndex = order.findIndex(s => s.startsWith('SELECT status::text FROM workspace_data_purges'));
    expect(lockIndex).toBeGreaterThanOrEqual(0); expect(purgeIndex).toBeGreaterThan(lockIndex);
    // A change committed between the preflight and the lock wins.
    state.respond = sqlText => sqlText.includes('FOR SHARE OF m, u, w') ? [{ role: 'editor', suspendedAt: null }] : sqlText.includes('FROM targets') ? [{ id: 't1' }] : undefined;
    await expect(createShareLink(actor, create)).rejects.toMatchObject({ code: 'unauthorized' });
    state.respond = sqlText => sqlText.includes('FOR SHARE OF m, u, w') ? [{ role: 'owner', suspendedAt: new Date() }] : undefined;
    await expect(createShareLink(actor, create)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('stores only a hash of a 256-bit token, returns the secret once, and never audits it', async () => {
    createWorld();
    const result = await createShareLink(actor, create);
    const token = result.path.replace('/share/', '');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const insert = state.executions.find(e => e.sql.includes('INSERT INTO share_links'))!;
    expect(insert.values).toContain(hashToken(token)); expect(insert.values).not.toContain(token);
    expect(insert.values).toContain('workspace-a'); expect(insert.sql).toContain('"expiresAt"');
    const audit = state.executions.find(e => e.sql.includes('activity_logs'))!;
    expect(JSON.stringify(audit.values)).not.toContain(token); expect(JSON.stringify(audit.values)).not.toContain(hashToken(token));
    expect(JSON.stringify(audit.values)).toContain('sharing.link_created');
    expect(result.expiresInDays).toBe(30);
  });

  it('rejects foreign or disabled channels, over-long lifetimes and deciding calendars', async () => {
    state.respond = sqlText => sqlText.includes('FROM targets') ? [] : undefined;
    await expect(createShareLink(actor, create)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createShareLink(actor, { ...create, expiresInDays: 400 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createShareLink(actor, { ...create, kind: 'calendar', decides: true })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.executions.some(e => e.sql.includes('INSERT INTO share_links'))).toBe(false);
  });

  it('requires approval permission for deciding links and keeps scoped members inside their channels', async () => {
    state.canApprove = false; await expect(createShareLink(actor, { ...create, decides: true })).rejects.toMatchObject({ code: 'forbidden' });
    state.canApprove = true; state.scope = { all: false, ids: ['t2'] };
    state.respond = sqlText => sqlText.includes('FROM targets') ? [{ id: 't1' }] : undefined;
    await expect(createShareLink(actor, create)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createShareLink(actor, { ...create, targetIds: [] })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('enforces the per-workspace link ceiling', async () => {
    state.respond = sqlText => sqlText.includes('FROM targets') ? [{ id: 't1' }] : sqlText.includes('COUNT(*)') ? [{ count: BigInt(200) }] : undefined;
    await expect(createShareLink(actor, create)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('lists with workspace scope and reports status without exposing hashes', async () => {
    state.respond = sqlText => sqlText.includes('FROM share_links l') ? [listRow({ decisions: BigInt(2) }), listRow({ id: 'shl_2', targetIds: [], revokedAt: new Date(), kind: 'calendar', decisions: 0 })] : undefined;
    const page = await listShareLinks(actor);
    expect(page.links.map(l => l.status)).toEqual(['active', 'revoked']); expect(page.links[0]!.feedbackCount).toBe(2);
    expect(JSON.stringify(page)).not.toContain('tokenHash');
    expect(state.queries.find(q => q.sql.includes('FROM share_links l'))!.values).toContain('workspace-a');
    await expect(listShareLinks(actor, { page: 0 })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('never returns more than a key result ceiling and pages with hasMore', async () => {
    state.respond = sqlText => sqlText.includes('FROM share_links l') ? [listRow(), listRow({ id: 'shl_2' }), listRow({ id: 'shl_3' })] : undefined;
    const page = await listShareLinks(actor, {}, { maxItems: 2 });
    expect(page.links).toHaveLength(2); expect(page.hasMore).toBe(true); expect(page.pageSize).toBe(2);
    expect(state.queries.find(q => q.sql.includes('FROM share_links l'))!.values).toContain(3);
  });

  it('narrows a scoped list to links wholly inside the actor scope', async () => {
    state.scope = { all: false, ids: ['t1'] };
    state.respond = sqlText => sqlText.includes('FROM share_links l') ? [] : undefined;
    await listShareLinks(actor);
    const q = state.queries.find(x => x.sql.includes('FROM share_links l'))!;
    expect(q.sql).toContain('NOT EXISTS'); expect(q.sql).toContain('jsonb_array_length'); expect(q.values).toContainEqual(['t1']);
  });

  it('lists only enabled, in-scope channels', async () => {
    state.scope = { all: false, ids: ['t1'] };
    state.respond = sqlText => sqlText.includes('FROM targets') ? [{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }] : undefined;
    expect(await listShareableChannels(actor)).toEqual([{ id: 't1', name: 'A' }]);
    expect(state.queries.find(q => q.sql.includes('FROM targets'))!.sql).toContain('enabled = true');
  });

  it('revokes, rotates and deletes only in-workspace, in-scope links with audit', async () => {
    state.respond = sqlText => sqlText.includes('FROM share_links WHERE id') ? [linkRow(['t1'])] : undefined;
    await expect(revokeShareLink(actor, { id: 'shl_1', confirmation: 'REVOKE SHARE LINK shl_1' })).resolves.toMatchObject({ status: 'revoked' });
    expect(state.queries.find(q => q.sql.includes('FROM share_links WHERE id'))!.values).toEqual(['shl_1', 'workspace-a']);
    const rotated = await rotateShareLink(actor, { id: 'shl_1', confirmation: 'ROTATE SHARE LINK shl_1' });
    const update = state.executions.find(e => e.sql.includes('SET "tokenHash"'))!;
    expect(update.values[0]).toBe(hashToken(rotated.path.replace('/share/', '')));
    await expect(deleteShareLink(actor, { id: 'shl_1', confirmation: 'DELETE SHARE LINK shl_1' })).resolves.toMatchObject({ deleted: true });
    const actions = state.executions.filter(e => e.sql.includes('activity_logs')).map(e => String(e.values[3]));
    expect(actions).toEqual(['sharing.link_revoked', 'sharing.link_rotated', 'sharing.link_deleted']);
    expect(JSON.stringify(state.executions)).not.toContain(rotated.path.replace('/share/', ''));
  });

  it('hides links outside the actor scope and links of other workspaces as not found', async () => {
    state.scope = { all: false, ids: ['t2'] };
    state.respond = sqlText => sqlText.includes('FROM share_links WHERE id') ? [linkRow(['t1'])] : undefined;
    await expect(revokeShareLink(actor, { id: 'shl_1', confirmation: 'REVOKE SHARE LINK shl_1' })).rejects.toMatchObject({ code: 'not_found' });
    state.scope = { all: true }; state.respond = sqlText => sqlText.includes('FROM share_links WHERE id') ? [] : undefined;
    await expect(deleteShareLink(actor, { id: 'shl_x', confirmation: 'DELETE SHARE LINK shl_x' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('applies a key channel ceiling on top of the member scope', async () => {
    state.respond = sqlText => sqlText.includes('FROM share_links WHERE id') ? [linkRow(['t1'])] : undefined;
    await expect(revokeShareLink({ ...actor, allowedTargetIds: ['t2'] }, { id: 'shl_1', confirmation: 'REVOKE SHARE LINK shl_1' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(revokeShareLink({ ...actor, allowedTargetIds: ['t1', 't9'] }, { id: 'shl_1', confirmation: 'REVOKE SHARE LINK shl_1' })).resolves.toMatchObject({ status: 'revoked' });
    // An empty ceiling means no channels, never "all".
    await expect(revokeShareLink({ ...actor, allowedTargetIds: [] }, { id: 'shl_1', confirmation: 'REVOKE SHARE LINK shl_1' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses to rotate revoked or expired links', async () => {
    for (const extra of [{ revokedAt: new Date() }, { expiresAt: new Date(Date.now() - 1000) }, { revokedAt: new Date(), expiresAt: null }]) {
      state.respond = sqlText => sqlText.includes('FROM share_links WHERE id') ? [linkRow([], extra)] : undefined;
      await expect(rotateShareLink(actor, { id: 'shl_1', confirmation: 'ROTATE SHARE LINK shl_1' })).rejects.toMatchObject({ code: 'conflict' });
    }
    expect(state.executions.some(e => e.sql.includes('SET "tokenHash"'))).toBe(false);
  });

  it('renews a migrated legacy link without expiry on rotation: new secret and the Root default lifetime', async () => {
    state.respond = sqlText => sqlText.includes('FROM share_links WHERE id') ? [linkRow([], { expiresAt: null })] : undefined;
    const result = await rotateShareLink(actor, { id: 'shl_1', confirmation: 'ROTATE SHARE LINK shl_1' });
    expect(result).toMatchObject({ id: 'shl_1', expiresInDays: defaults['sharing.defaultExpiryDays'] });
    const update = state.executions.find(e => e.sql.includes('SET "tokenHash"'))!;
    expect(update.sql).toContain('"expiresAt" = NOW()'); expect(update.sql).toContain('"expiresAt" IS NULL AND "revokedAt" IS NULL');
    expect(JSON.stringify(state.executions.find(e => e.sql.includes('activity_logs'))!.values)).toContain('renewedForDays');
  });

  it('rolls back (propagates) when the audit write fails and never reports success', async () => {
    state.respond = sqlText => sqlText.includes('FROM share_links WHERE id') ? [linkRow([])] : undefined; state.failAudit = true;
    await expect(revokeShareLink(actor, { id: 'shl_1', confirmation: 'REVOKE SHARE LINK shl_1' })).rejects.toMatchObject({ code: 'upstream_failure' });
  });

  it('fails closed when a Root bound is unreadable', async () => {
    const { sharingLimits } = await import('../src/modules/sharing/server/limits');
    await expect(sharingLimits(async key => (key === 'sharing.pageSize' ? 'x' : 5))).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('client feedback for the owner', () => {
  it('lists answers for an in-scope link with the post status, newest first, paged', async () => {
    state.respond = sqlText => sqlText.includes('FROM share_links WHERE id') ? [linkRow(['t1'])] : sqlText.includes('FROM review_decisions d') ? [
      { id: 'd1', postId: 'p1', decision: 'approved', comment: null, authorName: 'Ana', createdAt: new Date(), postStatus: 'scheduled', postPreview: 'Hello' },
      { id: 'd2', postId: 'p1', decision: 'comment', comment: '<b>hi</b>', authorName: 'Bo', createdAt: new Date(), postStatus: 'scheduled', postPreview: 'Hello' }] : undefined;
    const page = await listShareFeedback(actor, { id: 'shl_1' }, { maxItems: 1 });
    expect(page.feedback).toHaveLength(1); expect(page.hasMore).toBe(true);
    const q = state.queries.find(x => x.sql.includes('FROM review_decisions d'))!;
    expect(q.sql).toContain('ORDER BY d."createdAt" DESC'); expect(q.values).toContain('workspace-a');
  });
  it('withholds post status and previews when Publishing cannot be read by the member or by the key', async () => {
    const rows = () => [{ id: 'd1', postId: 'p1', decision: 'approved', comment: null, authorName: 'Ana', createdAt: new Date(), postStatus: 'scheduled', postPreview: 'Hello' }];
    state.respond = sqlText => sqlText.includes('FROM share_links WHERE id') ? [linkRow(['t1'])] : sqlText.includes('FROM review_decisions d') ? rows() : undefined;
    expect((await listShareFeedback(actor, { id: 'shl_1' })).feedback[0]).toMatchObject({ postStatus: 'scheduled', postPreview: 'Hello' });
    state.readDenied = ['publishing/approvals', 'publishing/posts'];
    expect((await listShareFeedback(actor, { id: 'shl_1' })).feedback[0]).toMatchObject({ postStatus: null, postPreview: null, authorName: 'Ana' });
    state.readDenied = [];
    const keyed = { ...actor, permissionCeiling: { denied: ['publishing/approvals:read', 'publishing/posts:read'] } as never };
    expect((await listShareFeedback(keyed, { id: 'shl_1' })).feedback[0]).toMatchObject({ postStatus: null, postPreview: null });
  });
  it('does not let a Settings-only key or a member without Publishing read mint a link that serves posts', async () => {
    createWorld();
    const settingsOnly = { ...actor, permissionCeiling: { denied: ['publishing/approvals:read', 'publishing/calendar:read', 'publishing/posts:read'] } as never };
    await expect(createShareLink(settingsOnly, create)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createShareLink(settingsOnly, { ...create, kind: 'calendar', confirmation: 'CREATE SHARE LINK Spring' })).rejects.toMatchObject({ code: 'forbidden' });
    state.readDenied = ['publishing/calendar'];
    await expect(createShareLink(actor, { ...create, kind: 'portal' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createShareLink(actor, create)).resolves.toMatchObject({ id: expect.stringMatching(/^shl_/) });
    state.readDenied = ['publishing/approvals'];
    await expect(createShareLink(actor, create)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.executions.filter(e => e.sql.includes('INSERT INTO share_links'))).toHaveLength(1);
  });
  it('answers not found for links outside the workspace or scope, and rejects bad input', async () => {
    state.respond = sqlText => sqlText.includes('FROM share_links WHERE id') ? [] : undefined;
    await expect(listShareFeedback(actor, { id: 'shl_x' })).rejects.toMatchObject({ code: 'not_found' });
    state.scope = { all: false, ids: ['t2'] }; state.respond = sqlText => sqlText.includes('FROM share_links WHERE id') ? [linkRow(['t1'])] : undefined;
    await expect(listShareFeedback(actor, { id: 'shl_1' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(listShareFeedback(actor, { id: 'bad id!' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('MCP definitions', () => {
  it('declare every tool with an access mode and match the executor', async () => {
    const names = sharingToolDefinitions.map(t => t.name).sort();
    expect(names).toEqual(Object.keys(SHARING_TOOL_ACCESS).sort());
    expect([...sharingTools].sort()).toEqual(names);
    expect([...sharingWriteTools].sort()).toEqual(['create_share_link', 'delete_bio_page', 'delete_share_link', 'revoke_share_link', 'rotate_share_link', 'save_bio_page', 'update_share_link']);
    await expect(executeSharingTool(actor, 'nope', {})).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('requires the exact confirmation text in every write tool description', () => {
    for (const tool of sharingToolDefinitions.filter(t => sharingWriteTools.has(t.name))) expect(tool.description).toContain('Confirmation:');
  });
  it('enforces roles, result ceilings and the key feature ceiling through the shared services', async () => {
    state.role = 'viewer'; await expect(executeSharingTool(actor, 'list_share_links', {})).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'owner';
    state.respond = sqlText => sqlText.includes('FROM share_links l') ? [listRow(), listRow({ id: 'shl_2' })] : undefined;
    expect(((await executeSharingTool(actor, 'list_share_links', {}, 1)) as { links: unknown[] }).links).toHaveLength(1);
    await expect(executeSharingTool(actor, 'list_share_links', { page: 'x' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeSharingTool(actor, 'create_share_link', { ...create, confirmation: 'yes' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('a read-only key ceiling blocks writes and the bio feature even for an owner, but still lets it read', async () => {
    const permissionCeiling = { denied: ['settings/sharing:write', 'settings/bio:read', 'settings/bio:write'] } as never;
    const keyed = { ...actor, permissionCeiling };
    await expect(executeSharingTool(keyed, 'create_share_link', create)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeSharingTool(keyed, 'get_bio_page', {})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeSharingTool(keyed, 'list_share_links', {})).resolves.toMatchObject({ links: [] });
    expect(state.executions).toHaveLength(0);
  });
  it('lists shareable channels and feedback through the same services', async () => {
    state.respond = sqlText => sqlText.includes('FROM targets') ? [{ id: 't1', name: 'A' }] : undefined;
    await expect(executeSharingTool(actor, 'list_shareable_channels', {})).resolves.toEqual({ channels: [{ id: 't1', name: 'A' }] });
    await expect(executeSharingTool(actor, 'list_shareable_channels', { x: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeSharingTool(actor, 'list_share_feedback', { id: '../x' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('creating links requires an explicit channel selection', () => {
  it('refuses an empty or omitted selection with a helpful message and never inserts', async () => {
    createWorld();
    await expect(createShareLink(actor, { ...create, targetIds: [] })).rejects.toMatchObject({ code: 'invalid_request', message: expect.stringContaining('at least one channel') });
    const { targetIds: _omitted, ...withoutTargets } = create; void _omitted;
    await expect(createShareLink(actor, withoutTargets)).rejects.toMatchObject({ code: 'invalid_request', message: expect.stringContaining('at least one channel') });
    await expect(executeSharingTool(actor, 'create_share_link', { ...create, targetIds: [] })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.executions.some(e => e.sql.includes('INSERT INTO share_links'))).toBe(false);
  });
  it('exposes targetIds as required with at least one item in the MCP schema', () => {
    const tool = sharingToolDefinitions.find(t => t.name === 'create_share_link')!;
    expect('required' in tool.inputSchema ? tool.inputSchema.required : []).toContain('targetIds'); expect(('targetIds' in tool.inputSchema.properties ? tool.inputSchema.properties.targetIds.minItems : undefined)).toBe(1);
  });
  it('persists exactly the selected ids, deduplicated, with no fallback to all channels', async () => {
    state.respond = sqlText => sqlText.includes('FROM targets') ? [{ id: 't1' }, { id: 't2' }] : sqlText.includes('COUNT(*)') ? [{ count: BigInt(0) }] : undefined;
    await createShareLink(actor, { ...create, targetIds: ['t1', 't2', 't1'] });
    const insert = state.executions.find(e => e.sql.includes('INSERT INTO share_links'))!;
    expect(insert.values).toContain(JSON.stringify(['t1', 't2']));
  });
});

describe('editing links', () => {
  const stored = (extra: object = {}) => ({ ...linkRow(['t1']), kind: 'review', description: null, daysBack: 7, daysAhead: 30, allowComments: true, decides: false, tokenHash: 'old-hash', ...extra });
  const versionOf = (row = stored()) => linkVersion({ ...row, targetIds: row.targetIds as string[], kind: row.kind }, row.tokenHash);
  const world = (row: object = stored(), extra: (sqlText: string) => unknown = () => undefined) => { state.respond = sqlText => sqlText.includes('FROM share_links WHERE id') ? [row] : extra(sqlText); };
  const ok = (extra: object) => ({ id: 'shl_1', expectedVersion: versionOf(), ...extra });
  const confirm = { confirmation: 'UPDATE SHARE LINK shl_1' };
  const auditDetail = () => JSON.parse(String(state.executions.find(e => e.sql.includes('activity_logs'))!.values[4]));
  const accessUpdate = () => state.executions.find(e => e.sql.includes('UPDATE share_links SET kind'));
  const metaUpdate = () => state.executions.find(e => e.sql.includes('UPDATE share_links SET title'));

  it('keeps the address on a metadata-only edit and audits field names only', async () => {
    world();
    const result = await updateShareLink(actor, ok({ title: 'Summer plan', description: 'Hello client' }));
    expect(result).toMatchObject({ id: 'shl_1', rotated: false, changed: ['title', 'description'] }); expect(result).not.toHaveProperty('path');
    expect(metaUpdate()!.sql).not.toContain('tokenHash'); expect(accessUpdate()).toBeUndefined();
    expect(auditDetail()).toEqual({ linkId: 'shl_1', changed: ['title', 'description'], rotated: false });
    expect(JSON.stringify(state.executions.find(e => e.sql.includes('activity_logs'))!.values)).not.toContain('Summer plan');
    expect(result.version).toBe(versionOf(stored({ title: 'Summer plan', description: 'Hello client' })));
  });

  it('rotates the secret atomically with every access change and returns the new path once', async () => {
    for (const change of [{ kind: 'portal' }, { targetIds: ['t1', 't2'] }, { daysAhead: 60 }, { allowComments: false }, { decides: true }, { expiresInDays: 10 }]) {
      state.executions = []; world(stored(), sqlText => sqlText.includes('FROM targets') ? [{ id: 't1' }, { id: 't2' }] : undefined);
      const result = await updateShareLink(actor, ok({ ...change, ...confirm, title: 'Renamed' }));
      expect(result.rotated).toBe(true);
      const token = result.path!.replace('/share/', '');
      const update = accessUpdate()!;
      expect(update.values).toContain(hashToken(token)); expect(JSON.stringify(update.values)).not.toContain(token);
      expect(update.sql).toContain('"revokedAt" IS NULL');
      expect(state.executions.filter(e => e.sql.startsWith('UPDATE share_links'))).toHaveLength(1); // title and access land in one statement
      expect(auditDetail()).toMatchObject({ linkId: 'shl_1', rotated: true }); expect(auditDetail().changed).toEqual(expect.arrayContaining([Object.keys(change)[0]!]));
      expect(JSON.stringify(state.executions.find(e => e.sql.includes('activity_logs'))!.values)).not.toContain(token);
      expect(result.version).not.toBe(versionOf());
    }
  });

  it('requires the exact confirmation only for access changes and writes nothing without it', async () => {
    world();
    await expect(updateShareLink(actor, ok({ allowComments: false }))).rejects.toMatchObject({ code: 'invalid_request', message: expect.stringContaining('UPDATE SHARE LINK shl_1') });
    await expect(updateShareLink(actor, ok({ allowComments: false, confirmation: 'update share link shl_1' }))).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.executions).toHaveLength(0);
    await expect(updateShareLink(actor, ok({ title: 'Only a name' }))).resolves.toMatchObject({ rotated: false });
  });

  it('turns a stale or foreign-rotated version into a conflict without overwriting', async () => {
    world();
    await expect(updateShareLink(actor, { id: 'shl_1', title: 'Mine', expectedVersion: '0'.repeat(32) })).rejects.toMatchObject({ code: 'conflict' });
    world(stored({ tokenHash: 'rotated-by-someone-else' }));
    await expect(updateShareLink(actor, ok({ title: 'Mine' }))).rejects.toMatchObject({ code: 'conflict' });
    world(stored({ title: 'Changed elsewhere' }));
    await expect(updateShareLink(actor, ok({ title: 'Mine' }))).rejects.toMatchObject({ code: 'conflict' });
    expect(state.executions.some(e => e.sql.startsWith('UPDATE share_links'))).toBe(false);
    await expect(updateShareLink(actor, { id: 'shl_1', title: 'x' })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('lists a version that tracks the stored secret without exposing it', async () => {
    state.respond = sqlText => sqlText.includes('FROM share_links l') ? [listRow({ tokenHash: 'a' }), listRow({ tokenHash: 'b' })] : undefined;
    const { links } = await listShareLinks(actor);
    expect(links[0]!.version).toMatch(/^[a-f0-9]{32}$/); expect(links[0]!.version).not.toBe(links[1]!.version);
    expect(JSON.stringify(links)).not.toMatch(/"a"|"b"/);
  });

  it('rejects an edit that changes nothing and unknown or oversized input', async () => {
    world();
    await expect(updateShareLink(actor, ok({ title: 'Spring', allowComments: true, targetIds: ['t1'] }))).rejects.toMatchObject({ code: 'invalid_request', message: 'Nothing was changed.' });
    await expect(updateShareLink(actor, ok({ targetIds: [] }))).rejects.toMatchObject({ code: 'invalid_request', message: expect.stringContaining('at least one channel') });
    await expect(updateShareLink(actor, ok({ creator: 'x', title: 'a' }))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateShareLink(actor, ok({ createdById: 'x', title: 'a' }))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateShareLink(actor, ok({ ...confirm, expiresInDays: 400 }))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateShareLink(actor, ok({ ...confirm, daysAhead: 200 }))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateShareLink(actor, ok({ ...confirm, targetIds: Array.from({ length: 101 }, (_, i) => `t${i}`) }))).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.executions).toHaveLength(0);
  });

  it('refuses foreign, disabled and out-of-scope channels and hides links outside the actor scope', async () => {
    world(stored(), sqlText => sqlText.includes('FROM targets') ? [] : undefined);
    await expect(updateShareLink(actor, ok({ ...confirm, targetIds: ['t1', 'foreign'] }))).rejects.toMatchObject({ code: 'invalid_request' });
    state.scope = { all: false, ids: ['t1'] };
    world(stored(), sqlText => sqlText.includes('FROM targets') ? [{ id: 't1' }, { id: 't2' }] : undefined);
    await expect(updateShareLink(actor, ok({ ...confirm, targetIds: ['t1', 't2'] }))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(updateShareLink({ ...actor, allowedTargetIds: ['t9'] }, ok({ title: 'x' }))).rejects.toMatchObject({ code: 'not_found' });
    state.scope = { all: false, ids: ['t2'] };
    await expect(updateShareLink(actor, ok({ title: 'x' }))).rejects.toMatchObject({ code: 'not_found' });
    world(stored({ targetIds: [] })); state.scope = { all: false, ids: ['t1'] };
    await expect(updateShareLink(actor, { id: 'shl_1', title: 'x', expectedVersion: versionOf(stored({ targetIds: [] })) })).rejects.toMatchObject({ code: 'not_found' });
    expect(state.executions).toHaveLength(0);
  });

  it('keeps a stored legacy all-channel link manageable for unrestricted owners without widening anyone else', async () => {
    const legacy = stored({ targetIds: [] });
    world(legacy);
    const v = versionOf(legacy);
    await expect(updateShareLink(actor, { id: 'shl_1', expectedVersion: v, title: 'Legacy renamed' })).resolves.toMatchObject({ rotated: false });
    world(legacy, sqlText => sqlText.includes('FROM targets') ? [{ id: 't1' }] : undefined);
    await updateShareLink(actor, { id: 'shl_1', expectedVersion: v, targetIds: ['t1'], ...confirm });
    expect(accessUpdate()!.values).toContain(JSON.stringify(['t1']));
  });

  it('enforces write permission, suspension, the role and the key ceiling', async () => {
    world();
    state.writeDenied = ['settings/sharing']; await expect(updateShareLink(actor, ok({ title: 'x' }))).rejects.toMatchObject({ code: 'forbidden' });
    state.writeDenied = []; state.suspended = true; await expect(updateShareLink(actor, ok({ title: 'x' }))).rejects.toMatchObject({ code: 'forbidden' });
    state.suspended = false; state.role = 'editor'; await expect(updateShareLink(actor, ok({ title: 'x' }))).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'owner'; const readOnlyKey = { ...actor, permissionCeiling: { denied: ['settings/sharing:write'] } as never };
    await expect(updateShareLink(readOnlyKey, ok({ title: 'x' }))).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.executions).toHaveLength(0);
  });

  it('re-checks Publishing access, approval permission and calendar rules for the resulting link', async () => {
    world(stored(), sqlText => sqlText.includes('FROM targets') ? [{ id: 't1' }] : undefined);
    state.readDenied = ['publishing/calendar']; await expect(updateShareLink(actor, ok({ kind: 'portal', ...confirm }))).rejects.toMatchObject({ code: 'forbidden' });
    state.readDenied = []; state.canApprove = false; await expect(updateShareLink(actor, ok({ decides: true, ...confirm }))).rejects.toMatchObject({ code: 'forbidden' });
    state.canApprove = true; await expect(updateShareLink(actor, ok({ kind: 'calendar', decides: true, ...confirm }))).rejects.toMatchObject({ code: 'invalid_request' });
    const decides = stored({ decides: true });
    world(decides); state.canApprove = false; // already deciding: renaming does not need the permission, and is not an access change
    await expect(updateShareLink(actor, { id: 'shl_1', expectedVersion: versionOf(decides), title: 'Renamed' })).resolves.toMatchObject({ rotated: false });
    expect(state.executions.filter(e => e.sql.startsWith('UPDATE share_links'))).toHaveLength(1);
  });

  it('renews an expired or never-expiring migrated link only on purpose and rotates its address', async () => {
    for (const extra of [{ expiresAt: new Date(Date.now() - 1000) }, { expiresAt: null }]) {
      state.executions = []; const row = stored(extra); world(row);
      const before = Date.now();
      const result = await updateShareLink(actor, { id: 'shl_1', expectedVersion: versionOf(row), expiresInDays: 14, ...confirm });
      expect(result).toMatchObject({ rotated: true, expiresInDays: 14 });
      const expiry = accessUpdate()!.values.find(v => v instanceof Date) as Date;
      expect(expiry.getTime()).toBeGreaterThanOrEqual(before + 14 * 86_400_000 - 5); expect(expiry.getTime()).toBeLessThanOrEqual(Date.now() + 14 * 86_400_000);
      expect(auditDetail()).toMatchObject({ renewedForDays: 14, rotated: true });
    }
    // An edit that does not ask for renewal keeps the existing expiry, so an expired link stays expired.
    state.executions = []; const expired = stored({ expiresAt: new Date(Date.now() - 1000) }); world(expired);
    await updateShareLink(actor, { id: 'shl_1', expectedVersion: versionOf(expired), allowComments: false, ...confirm });
    expect(accessUpdate()!.values).toContainEqual(expired.expiresAt);
  });

  it('never reactivates or re-addresses a revoked link, but still lets its title change', async () => {
    const revoked = stored({ revokedAt: new Date() }); world(revoked);
    const v = versionOf(revoked);
    for (const change of [{ expiresInDays: 30 }, { allowComments: false }, { targetIds: ['t1', 't2'] }]) await expect(updateShareLink(actor, { id: 'shl_1', expectedVersion: v, ...change, ...confirm })).rejects.toMatchObject({ code: 'conflict' });
    expect(state.executions).toHaveLength(0);
    await expect(updateShareLink(actor, { id: 'shl_1', expectedVersion: v, title: 'Archive name' })).resolves.toMatchObject({ rotated: false });
    expect(metaUpdate()!.sql).not.toContain('revokedAt = NULL'); expect(JSON.stringify(state.executions)).not.toContain('"revokedAt" = ');
  });

  it('does not change the creator and never selects or logs it as an input', async () => {
    world(); await updateShareLink(actor, ok({ title: 'Renamed' }));
    expect(metaUpdate()!.sql).not.toContain('createdById');
    world(); await updateShareLink(actor, ok({ allowComments: false, ...confirm }));
    expect(accessUpdate()!.sql).not.toContain('createdById');
  });

  it('propagates an audit failure instead of reporting success', async () => {
    world(); state.failAudit = true;
    await expect(updateShareLink(actor, ok({ title: 'Renamed' }))).rejects.toMatchObject({ code: 'upstream_failure' });
  });

  it('works through the MCP tool with the same checks and a declared write mode', async () => {
    world();
    expect(sharingWriteTools.has('update_share_link')).toBe(true); expect(SHARING_TOOL_ACCESS.update_share_link).toEqual({ feature: 'settings/sharing', mode: 'write' });
    const tool = sharingToolDefinitions.find(t => t.name === 'update_share_link')!;
    expect('required' in tool.inputSchema ? tool.inputSchema.required : []).toEqual(['id', 'expectedVersion']); expect(tool.description).toContain('UPDATE SHARE LINK <id>');
    await expect(executeSharingTool(actor, 'update_share_link', ok({ title: 'Via MCP' }))).resolves.toMatchObject({ rotated: false });
    await expect(executeSharingTool(actor, 'update_share_link', ok({ allowComments: false }))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeSharingTool(actor, 'update_share_link', ok({ allowComments: false, ...confirm }))).resolves.toMatchObject({ rotated: true, path: expect.stringMatching(/^\/share\//) });
  });
});

describe('capability minting never exceeds the caller’s current rights', () => {
  const rotateInput = { id: 'shl_1', confirmation: 'ROTATE SHARE LINK shl_1' };
  const confirmUpdate = 'UPDATE SHARE LINK shl_1';
  const stored = (extra: object = {}) => ({ ...linkRow(['t1']), kind: 'review', description: null, daysBack: 7, daysAhead: 30, allowComments: true, decides: false, tokenHash: 'old-hash', ...extra });
  const versionOf = (row = stored()) => linkVersion({ ...row, targetIds: row.targetIds as string[], kind: row.kind as 'review' }, row.tokenHash);
  const world = (row: object) => { state.respond = (sqlText, values) => sqlText.includes('FROM share_links WHERE id') ? [row] : sqlText.includes('FROM targets') ? (Array.isArray(values[1]) ? values[1] : ['t1', 't2']).map(id => ({ id })) : sqlText.includes('COUNT(*)') ? [{ count: BigInt(0) }] : undefined; };
  const key = (denied: string[], apiKeyId = 'key_1') => ({ ...actor, apiKeyId, permissionCeiling: { denied } as never });
  const settingsOnly = ['publishing/approvals:read', 'publishing/calendar:read', 'publishing/posts:read'];
  const untouched = () => { expect(state.executions).toHaveLength(0); };
  const auditOf = () => JSON.parse(String(state.executions.find(e => e.sql.includes('activity_logs'))!.values[4]));

  it('refuses to hand a Settings-only key a fresh token for an existing non-deciding link', async () => {
    world(stored());
    await expect(rotateShareLink(key(settingsOnly), rotateInput)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeSharingTool(key(settingsOnly), 'rotate_share_link', rotateInput)).rejects.toMatchObject({ code: 'forbidden' });
    untouched(); // no tokenHash update, no row change, no audit
  });

  it('refuses rotation without current Publishing read for each link kind, but still revokes, deletes and renames (no credential minted)', async () => {
    for (const kind of ['review', 'calendar', 'portal']) {
      world(stored({ kind }));
      await expect(rotateShareLink(key(settingsOnly), rotateInput)).rejects.toMatchObject({ code: 'forbidden' });
    }
    untouched();
    world(stored());
    await expect(updateShareLink(key(settingsOnly), { id: 'shl_1', expectedVersion: versionOf(), title: 'Rename only' })).resolves.toMatchObject({ rotated: false });
    await expect(revokeShareLink(key(settingsOnly), { id: 'shl_1', confirmation: 'REVOKE SHARE LINK shl_1' })).resolves.toMatchObject({ status: 'revoked' });
    await expect(deleteShareLink(key(settingsOnly), { id: 'shl_1', confirmation: 'DELETE SHARE LINK shl_1' })).resolves.toMatchObject({ deleted: true });
  });

  it('refuses a key without approval write when rotating a deciding link, even with Publishing read', async () => {
    world(stored({ decides: true }));
    await expect(rotateShareLink(key(['publishing/approvals:write']), rotateInput)).rejects.toMatchObject({ code: 'forbidden' });
    untouched();
    state.canApprove = false; // the member lost approval
    await expect(rotateShareLink(actor, rotateInput)).rejects.toMatchObject({ code: 'forbidden' });
    untouched();
  });

  it('refuses deciding-link creation when approval rights are lost after preflight', async () => {
    state.respond = sqlText => {
      if (sqlText.includes('FROM workspaces WHERE id')) state.canApprove = false;
      return sqlText.includes('FROM targets') ? [{ id: 't1' }] : sqlText.includes('COUNT(*)') ? [{ count: BigInt(0) }] : undefined;
    };
    await expect(createShareLink(actor, { ...create, decides: true })).rejects.toMatchObject({ code: 'forbidden' });
    untouched();
  });

  it('lets a key with the needed read but no approval write mint only non-deciding links', async () => {
    const noApprove = key(['publishing/approvals:write']);
    world(stored());
    await expect(rotateShareLink(noApprove, rotateInput)).resolves.toMatchObject({ path: expect.stringMatching(/^\/share\//) });
    await expect(createShareLink(noApprove, create)).resolves.toMatchObject({ id: expect.any(String) });
    await expect(createShareLink(noApprove, { ...create, decides: true })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(updateShareLink(noApprove, { id: 'shl_1', expectedVersion: versionOf(), allowComments: false, confirmation: confirmUpdate })).resolves.toMatchObject({ rotated: true });
    state.executions = [];
    await expect(updateShareLink(noApprove, { id: 'shl_1', expectedVersion: versionOf(), decides: true, confirmation: confirmUpdate })).rejects.toMatchObject({ code: 'forbidden' });
    untouched();
  });

  it('requires approval write for every capability-rotating edit of an already-deciding link', async () => {
    const deciding = stored({ decides: true });
    const noApprove = key(['publishing/approvals:write']);
    for (const change of [{ expiresInDays: 10 }, { targetIds: ['t1', 't2'] }, { kind: 'portal' }, { allowComments: false }, { daysAhead: 60 }, { decides: false }]) {
      state.executions = []; world(deciding);
      await expect(updateShareLink(noApprove, { id: 'shl_1', expectedVersion: versionOf(deciding), ...change, confirmation: confirmUpdate })).rejects.toMatchObject({ code: 'forbidden' });
      untouched();
    }
    // Metadata-only edits mint nothing and stay allowed; a caller with approval write can still re-issue.
    world(deciding);
    await expect(updateShareLink(noApprove, { id: 'shl_1', expectedVersion: versionOf(deciding), title: 'Renamed' })).resolves.toMatchObject({ rotated: false });
    state.executions = []; world(deciding);
    await expect(updateShareLink(actor, { id: 'shl_1', expectedVersion: versionOf(deciding), expiresInDays: 10, confirmation: confirmUpdate })).resolves.toMatchObject({ rotated: true });
  });

  it('keeps optimistic-lock conflict and channel scope ahead of any new secret', async () => {
    world(stored({ tokenHash: 'rotated-elsewhere' }));
    await expect(updateShareLink(actor, { id: 'shl_1', expectedVersion: versionOf(), allowComments: false, confirmation: confirmUpdate })).rejects.toMatchObject({ code: 'conflict' });
    state.scope = { all: false, ids: ['t2'] }; world(stored());
    await expect(rotateShareLink(actor, rotateInput)).rejects.toMatchObject({ code: 'not_found' });
    untouched();
  });

  it('attributes key-driven changes exactly and leaves human changes unmarked', async () => {
    world(stored());
    const result = await rotateShareLink(key([], 'key_42'), rotateInput);
    expect(auditOf()).toEqual({ linkId: 'shl_1', apiKeyId: 'key_42', authSource: 'api_key' });
    const secret = result.path.replace('/share/', '');
    const raw = JSON.stringify(state.executions.find(e => e.sql.includes('activity_logs'))!.values);
    expect(raw).not.toContain(secret); expect(raw).not.toContain(hashToken(secret));
    state.executions = []; world(stored());
    await updateShareLink(key([], 'key_42'), { id: 'shl_1', expectedVersion: versionOf(), title: 'Renamed' });
    expect(auditOf()).toEqual({ linkId: 'shl_1', changed: ['title'], rotated: false, apiKeyId: 'key_42', authSource: 'api_key' });
    state.executions = []; world(stored());
    await rotateShareLink(actor, rotateInput);
    expect(auditOf()).toEqual({ linkId: 'shl_1' });
  });
});
