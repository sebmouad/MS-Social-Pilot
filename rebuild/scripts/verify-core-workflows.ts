/** Guarded, synthetic-only localhost/PostgreSQL/MCP verification for core batch 63 workflows. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';

class ProbeFailure extends Error {}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new ProbeFailure(message); }
let stage = 'preview guards';

const configKeys = [
  'mcp.enabled', 'mcp.authenticatedRoles', 'entitlements.features.publishing/templates',
  'entitlements.features.settings/team', 'entitlements.features.settings/workspace',
  'entitlements.features.inbox/conversations', 'platforms.facebook.enabled',
] as const;

async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
  const origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && origin && databaseUrl === process.env.DATABASE_URL && process.env.NODE_ENV !== 'production', 'An explicit matching preview database configuration is required.');
  const database = new URL(databaseUrl), previewOrigin = new URL(origin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only an isolated loopback _preview database is allowed.');
  check(origin === 'http://localhost:3200' && previewOrigin.origin === origin && previewOrigin.protocol === 'http:' && previewOrigin.hostname === 'localhost' && previewOrigin.port === '3200', 'Only the explicit canonical localhost:3200 HTTP preview origin is allowed.');

  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_core63_${randomUUID().replaceAll('-', '')}`;
  const workspaceA = `${prefix}_workspace_a`, workspaceB = `${prefix}_workspace_b`, userId = `${prefix}_owner`, teammateId = `${prefix}_teammate`, foreignUserId = `${prefix}_foreign`;
  const workspaceIds = [workspaceA, workspaceB], userIds = [userId, teammateId, foreignUserId];
  const sessionToken = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + 30 * 60_000);
  const readBearer = `mcp_${randomBytes(32).toString('base64url')}`, writeBearerA = `mcp_${randomBytes(32).toString('base64url')}`, writeBearerB = `mcp_${randomBytes(32).toString('base64url')}`;
  const keyIds = [`${prefix}_read`, `${prefix}_write_a`, `${prefix}_write_b`];
  const mcpFeatures = ['publishing/templates', 'settings/workspace', 'inbox/conversations'];
  const sessionCookie = `msp_session=${sessionToken}`;
  const originalSettings = new Map<string, { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date } | null>();
  const previousConfigAudits = new Set<string>(), changedConfigAudits = new Set<string>();
  let settingsCaptured = false, fixtureStarted = false;
  const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');

  async function http(path: string, method = 'GET', body?: unknown, workspaceId = workspaceA) {
    return fetch(new URL(path, previewOrigin), {
      method, redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { origin: previewOrigin.origin, cookie: `${sessionCookie}; sp_workspace=${workspaceId}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function json(response: Response): Promise<any> { try { return await response.json(); } catch { return null; } }
  async function saveSetting(key: string, value: unknown) {
    const response = await http('/api/root/config', 'PUT', { key, value });
    const body = await json(response);
    check(response.ok && body?.ok === true, 'Synthetic Root configuration was not accepted.');
  }
  async function mcp(tool: string, args: unknown = {}, bearer = writeBearerA) {
    const response = await fetch(new URL('/api/mcp?scope=workspace', previewOrigin), {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { origin: previewOrigin.origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name: tool, arguments: args } }),
    });
    return { response, body: await json(response) };
  }
  async function insertInboxFixture(workspaceId: string, suffix: string) {
    const socialId = `${prefix}_${suffix}_social`, targetId = `${prefix}_${suffix}_target`, conversationId = `${prefix}_${suffix}_conversation`;
    stage = `insert synthetic social account ${suffix}`;
    await db.$executeRaw`INSERT INTO social_accounts (id, "workspaceId", provider, "providerUserId", name, "accessToken", "createdAt", "updatedAt") VALUES (${socialId}, ${workspaceId}, 'facebook', ${`${suffix}_synthetic`}, 'Synthetic local channel', 'synthetic-not-a-credential', NOW(), NOW())`;
    stage = `insert synthetic target ${suffix}`;
    await db.$executeRaw`INSERT INTO targets (id, "workspaceId", "socialAccountId", type, "providerId", name, enabled, "createdAt", "updatedAt") VALUES (${targetId}, ${workspaceId}, ${socialId}, 'page'::"TargetType", ${`${suffix}_synthetic`}, 'Synthetic local channel', true, NOW(), NOW())`;
    stage = `insert synthetic conversation ${suffix}`;
    await db.$executeRaw`INSERT INTO conversations (id, "targetId", "remoteId", snippet, "updatedTime", "fetchedAt") VALUES (${conversationId}, ${targetId}, ${`${suffix}_synthetic_conversation`}, 'Synthetic preview conversation', NOW(), NOW())`;
    return { socialId, targetId, conversationId };
  }
  async function workspacePolicy(workspaceId: string) {
    return (await db.$queryRaw<Array<{ timezone: string; requiresApproval: boolean }>>`SELECT timezone, "requiresApproval" FROM workspaces WHERE id = ${workspaceId}`)[0] ?? null;
  }
  function requireCode(result: any, code: string, message: string) {
    check(result?.isError === true && result?.structuredContent?.code === code, message);
  }

  try {
    stage = 'verify preview tables and capture settings';
    const tables = await db.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY(${['workspaces','users','memberships','sessions','mcp_api_keys','app_settings','root_activities','activity_logs','social_accounts','targets','conversations','posts','post_targets','post_comments','post_templates','labels','saved_replies','inbox_notes']}::text[])`;
    check(tables.length === 18, 'Required legacy preview tables are unavailable; no fixture writes were attempted.');
    const preflight = await fetch(new URL('/sign-in', previewOrigin), { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    check(preflight.status < 500 && new URL(preflight.url).origin === previewOrigin.origin, 'The expected localhost preview is not responding.');
    await db.appSetting.findMany({ where: { key: { in: [...configKeys] } }, select: { key: true, value: true, encrypted: true } });
    const stored = await db.appSetting.findMany({ where: { key: { in: [...configKeys] } }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
    for (const key of configKeys) originalSettings.set(key, stored.find(row => row.key === key) ?? null);
    settingsCaptured = true;
    const existing = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId" = ${userId} AND action = 'config.changed' AND detail->>'key' = ANY(${[...configKeys]}::text[])`;
    for (const row of existing) previousConfigAudits.add(row.id);

    stage = 'create workspace A';
    fixtureStarted = true;
    await db.workspace.create({ data: { id: workspaceA, slug: workspaceA, name: 'Disposable core workflow A', timezone: 'UTC' } });
    stage = 'create workspace B';
    await db.workspace.create({ data: { id: workspaceB, slug: workspaceB, name: 'Disposable core workflow B', timezone: 'America/Toronto' } });
    stage = 'create synthetic owner user';
    await db.user.create({ data: { id: userId, email: `${userId}@example.test`, name: 'Disposable preview owner', passwordHash: 'unusable-preview-password', isInstanceOwner: true, totpEnabledAt: new Date() } });
    stage = 'create synthetic workspace A teammate';
    await db.user.create({ data: { id: teammateId, email: `${teammateId}@example.test`, name: 'Disposable preview teammate', passwordHash: 'unusable-preview-password' } });
    stage = 'create synthetic workspace B teammate';
    await db.user.create({ data: { id: foreignUserId, email: `${foreignUserId}@example.test`, name: 'Disposable foreign teammate', passwordHash: 'unusable-preview-password' } });
    stage = 'create owner membership in workspace A';
    await db.membership.create({ data: { id: `${prefix}_owner_a`, userId, workspaceId: workspaceA, role: 'owner' } });
    stage = 'create owner membership in workspace B';
    await db.membership.create({ data: { id: `${prefix}_owner_b`, userId, workspaceId: workspaceB, role: 'owner' } });
    stage = 'create teammate membership in workspace A';
    await db.membership.create({ data: { id: `${prefix}_teammate_a`, userId: teammateId, workspaceId: workspaceA, role: 'contributor' } });
    stage = 'create foreign teammate membership in workspace B';
    await db.membership.create({ data: { id: `${prefix}_foreign_b`, userId: foreignUserId, workspaceId: workspaceB, role: 'contributor' } });
    stage = 'initialize workspace B policy fixture';
    await db.$executeRaw`UPDATE workspaces SET timezone = 'America/Toronto', "requiresApproval" = false WHERE id = ${workspaceB}`;
    stage = 'create authenticated synthetic session';
    await db.session.create({ data: { id: `${prefix}_session`, userId, tokenHash: hashSessionToken(sessionToken)!, expiresAt, pending: null } });
    for (const [index, bearer] of [readBearer, writeBearerA, writeBearerB].entries()) {
      stage = `create synthetic MCP key ${index + 1}`;
      const workspaceId = index === 2 ? workspaceB : workspaceA;
      await db.mcpApiKey.create({ data: { id: keyIds[index]!, workspaceId, createdById: userId, name: 'Disposable core workflow key', tokenHash: tokenHash(bearer), tokenPrefix: bearer.slice(0, 12), expiresAt, readFeatures: mcpFeatures, writeFeatures: index === 0 ? [] : mcpFeatures } });
    }
    stage = 'create synthetic workspace A inbox channel and conversation';
    const inboxA = await insertInboxFixture(workspaceA, 'a');
    stage = 'create synthetic workspace B inbox channel and conversation';
    const inboxB = await insertInboxFixture(workspaceB, 'b');
    const labelA = `${prefix}_label_a`, labelB = `${prefix}_label_b`;
    stage = 'create synthetic workspace labels';
    await db.$executeRaw`INSERT INTO labels (id, "workspaceId", name, color, "createdAt") VALUES (${labelA}, ${workspaceA}, 'Synthetic local label', 'blue', NOW()), (${labelB}, ${workspaceB}, 'Foreign synthetic label', 'blue', NOW())`;
    stage = 'create pending approval draft and scheduled post fixtures';
    const draftApprovalPostId = `${prefix}_approval_draft`, scheduledApprovalPostId = `${prefix}_approval_scheduled`;
    const submittedAt = new Date(), scheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    for (const [id, due] of [[draftApprovalPostId, null], [scheduledApprovalPostId, scheduledAt]] as const) {
      await db.$executeRaw`INSERT INTO posts (id, "workspaceId", "authorId", message, status, "approvalStatus", "submittedById", "submittedAt", "scheduledAt", timezone, "updatedAt") VALUES (${id}, ${workspaceA}, ${teammateId}, ${`Synthetic approval ${due ? 'scheduled' : 'draft'}`}, 'pending_approval'::"PostStatus", 'pending'::"ApprovalStatus", ${teammateId}, ${submittedAt}, ${due}, 'UTC', NOW())`;
      await db.$executeRaw`INSERT INTO post_targets (id, "postId", "targetId", status, "updatedAt") VALUES (${`${id}_target`}, ${id}, ${inboxA.targetId}, 'pending'::"PostTargetStatus", NOW())`;
    }

    stage = 'enable local modules and configure workspace MCP';
    await saveSetting('mcp.enabled', true);
    await saveSetting('mcp.authenticatedRoles', ['owner', 'admin']);
    await saveSetting('entitlements.features.publishing/templates', true);
    await saveSetting('entitlements.features.settings/team', true);
    await saveSetting('entitlements.features.settings/workspace', true);
    await saveSetting('entitlements.features.inbox/conversations', true);
    await saveSetting('platforms.facebook.enabled', true);

    stage = 'workspace policy HTTP, MCP and transaction denial checks';
    const initialPolicy = await json(await http('/api/settings/workspace/policy'));
    check(initialPolicy?.ok === true && initialPolicy.timezone === 'UTC' && initialPolicy.requiresApproval === false, 'Workspace A policy did not load the synthetic initial state.');
    const wrongConfirm = await http('/api/settings/workspace/policy', 'POST', { timezone: 'Europe/Paris', requiresApproval: true, confirmation: 'UPDATE WORKSPACE POLICY wrong' });
    check(wrongConfirm.status === 400 && await workspacePolicy(workspaceA).then(row => row?.timezone === 'UTC' && row.requiresApproval === false), 'Invalid policy confirmation must not mutate or audit the workspace.');
    const policyChanged = await http('/api/settings/workspace/policy', 'POST', { timezone: 'Europe/Paris', requiresApproval: true, confirmation: `UPDATE WORKSPACE POLICY ${workspaceA}` });
    const policyChangedBody = await json(policyChanged);
    check(policyChanged.ok, `Workspace policy HTTP update failed (status ${policyChanged.status}, code ${typeof policyChangedBody?.code === 'string' ? policyChangedBody.code : 'unknown'}).`);
    const changedA = await workspacePolicy(workspaceA);
    const unchangedB = await workspacePolicy(workspaceB);
    check(changedA?.timezone === 'Europe/Paris' && changedA.requiresApproval && unchangedB?.timezone === 'America/Toronto' && !unchangedB.requiresApproval, 'Workspace policy mutation escaped tenant scope.');
    const deniedPolicy = await mcp('update_workspace_policies', { timezone: 'UTC', requiresApproval: false, confirmation: `UPDATE WORKSPACE POLICY ${workspaceA}` }, readBearer);
    requireCode(deniedPolicy.body?.result, 'forbidden', 'Read-only MCP key must not change workspace policy.');
    const mcpPolicy = await mcp('update_workspace_policies', { timezone: 'UTC', requiresApproval: false, confirmation: `UPDATE WORKSPACE POLICY ${workspaceA}` });
    const mcpPolicyCode = mcpPolicy.body?.result?.structuredContent?.code;
    const releasedPosts = await db.$queryRaw<Array<{ id: string; status: string; approvalStatus: string; submittedById: string | null; submittedAt: Date | null; reviewedById: string | null; reviewedAt: Date | null; reviewNote: string | null }>>`SELECT id, status::text AS status, "approvalStatus"::text AS "approvalStatus", "submittedById", "submittedAt", "reviewedById", "reviewedAt", "reviewNote" FROM posts WHERE id = ANY(${[draftApprovalPostId, scheduledApprovalPostId]}::text[]) ORDER BY id`;
    check(mcpPolicy.body?.result?.structuredContent?.ok === true && (await workspacePolicy(workspaceA))?.timezone === 'UTC' && (await workspacePolicy(workspaceA))?.requiresApproval === false, `MCP policy update did not use the shared workspace service (code ${typeof mcpPolicyCode === 'string' ? mcpPolicyCode : 'unknown'}).`);
    check(releasedPosts.length === 2 && releasedPosts.some(row => row.id === draftApprovalPostId && row.status === 'draft' && row.approvalStatus === 'not_required')
      && releasedPosts.some(row => row.id === scheduledApprovalPostId && row.status === 'scheduled' && row.approvalStatus === 'not_required')
      && releasedPosts.every(row => row.submittedById === teammateId && row.submittedAt?.getTime() === submittedAt.getTime() && row.reviewedById === null && row.reviewedAt === null && row.reviewNote === null), 'Disabling approval did not release pending drafts/scheduled posts safely or preserve review metadata.');
    const policyAudit = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${workspaceA} AND action = 'workspace.policy_updated'`;
    check(policyAudit[0]?.count === BigInt(2), 'Workspace policy writes were not durably audited exactly once each.');
    const releaseAudit = await db.$queryRaw<Array<{ detail: any }>>`SELECT detail FROM activity_logs WHERE "workspaceId" = ${workspaceA} AND action = 'approvals.disabled'`;
    check(releaseAudit.length === 1 && releaseAudit[0]?.detail?.released === 2 && releaseAudit[0]?.detail?.scheduled === 1 && releaseAudit[0]?.detail?.drafts === 1, 'Approval disable release counts were not durably audited.');

    stage = 'template HTTP and MCP CRUD, label scope, tenant and rollback checks';
    const createTemplate = (workspaceId: string, name: string, labelId: string) => http('/api/publishing/templates', 'POST', { name, category: 'Synthetic', body: 'Synthetic message', hashtags: '#preview', firstComment: 'Synthetic comment', labelId, confirmation: `CREATE TEMPLATE ${name}` }, workspaceId);
    const createdTemplateResponse = await createTemplate(workspaceA, 'Probe HTTP template', labelA);
    const createdTemplate = await json(createdTemplateResponse);
    check(createdTemplateResponse.status === 201 && createdTemplate?.id && createdTemplate.labelId === labelA, 'HTTP template create did not return the saved local label.');
    const storedTemplate = await db.$queryRaw<Array<{ id: string; workspaceId: string; labelId: string | null }>>`SELECT id, "workspaceId", "labelId" FROM post_templates WHERE id = ${createdTemplate.id}`;
    check(storedTemplate[0]?.workspaceId === workspaceA && storedTemplate[0].labelId === labelA, 'Template or label was not saved in the correct workspace.');
    const invalidLabel = await json(await createTemplate(workspaceA, 'Probe rollback template', labelB));
    check(invalidLabel?.code === 'invalid_request' && await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM post_templates WHERE "workspaceId" = ${workspaceA} AND name = 'Probe rollback template'`.then(rows => rows[0]?.count === BigInt(0))
      && await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${workspaceA} AND action = 'publishing.template_created' AND detail->>'name' = 'Probe rollback template'`.then(rows => rows[0]?.count === BigInt(0)), 'Foreign-workspace label failure must roll back template creation and audit.');
    const listA = await json(await http('/api/publishing/templates', 'GET', undefined, workspaceA));
    const listB = await json(await http('/api/publishing/templates', 'GET', undefined, workspaceB));
    check(listA?.templates?.some((row: { id: string }) => row.id === createdTemplate.id) && !listB?.templates?.some((row: { id: string }) => row.id === createdTemplate.id), 'Template listing crossed workspace scope.');
    const foreignUpdate = await http(`/api/publishing/templates/${createdTemplate.id}`, 'PUT', { name: 'Foreign overwrite', body: 'Should not write', confirmation: `UPDATE TEMPLATE ${createdTemplate.id}` }, workspaceB);
    check(foreignUpdate.status === 404 && (await db.$queryRaw<Array<{ name: string }>>`SELECT name FROM post_templates WHERE id = ${createdTemplate.id}`)[0]?.name === 'Probe HTTP template', 'A foreign workspace could not update the template.');
    const deniedTemplate = await mcp('create_post_template', { name: 'Read-only template', body: 'No write', confirmation: 'CREATE TEMPLATE Read-only template' }, readBearer);
    requireCode(deniedTemplate.body?.result, 'forbidden', 'Read-only MCP key must not create templates.');
    check(await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM post_templates WHERE "workspaceId" = ${workspaceA} AND name = 'Read-only template'`.then(rows => rows[0]?.count === BigInt(0)), 'Read-only MCP template denial changed the database.');
    const mcpCreated = await mcp('create_post_template', { name: 'Probe MCP template', body: 'MCP synthetic body', confirmation: 'CREATE TEMPLATE Probe MCP template' });
    const mcpTemplate = mcpCreated.body?.result?.structuredContent;
    check(mcpTemplate?.id && mcpTemplate.name === 'Probe MCP template', 'MCP template create did not return a saved record.');
    const mcpList = await mcp('list_post_templates');
    check(mcpList.body?.result?.structuredContent?.templates?.some((row: { id: string }) => row.id === mcpTemplate.id), 'MCP template listing did not read the shared service record.');
    const updatedTemplate = await http(`/api/publishing/templates/${createdTemplate.id}`, 'PUT', { name: 'Probe HTTP template updated', category: 'Updated', body: 'Updated synthetic message', hashtags: '#updated', firstComment: '', labelId: labelA, confirmation: `UPDATE TEMPLATE ${createdTemplate.id}` });
    check(updatedTemplate.ok && (await json(updatedTemplate))?.name === 'Probe HTTP template updated', 'HTTP template update failed.');
    const mcpDelete = await mcp('delete_post_template', { id: mcpTemplate.id, confirmation: `DELETE TEMPLATE ${mcpTemplate.id}` });
    check(mcpDelete.body?.result?.structuredContent?.deleted === true && await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM post_templates WHERE id = ${mcpTemplate.id}`.then(rows => rows[0]?.count === BigInt(0)), 'MCP template delete did not remove its current-workspace record.');
    const httpDelete = await http(`/api/publishing/templates/${createdTemplate.id}`, 'DELETE', { confirmation: `DELETE TEMPLATE ${createdTemplate.id}` });
    check(httpDelete.ok && (await json(httpDelete))?.deleted === true, 'HTTP template delete failed.');

    stage = 'Inbox assignment, private notes, saved replies, tenant and read-only checks';
    const itemUrl = `/api/inbox/productivity?kind=message&id=${inboxA.conversationId}`;
    const productivity = await json(await http(itemUrl));
    check(productivity?.ok === true && productivity.assignment.assigneeId === null && productivity.notes.length === 0, 'Inbox productivity did not load the synthetic conversation.');
    const noteBody = 'Synthetic private note; should never enter audit detail.';
    const noteResponse = await http('/api/inbox/productivity', 'POST', { action: 'note.add', kind: 'message', id: inboxA.conversationId, body: noteBody, confirmation: `ADD PRIVATE NOTE message ${inboxA.conversationId}` });
    const note = await json(noteResponse);
    check(noteResponse.ok && note?.ok === true && typeof note.id === 'string', 'Private note HTTP create did not return a matching receipt.');
    const noteRows = await db.$queryRaw<Array<{ id: string; body: string; authorId: string | null }>>`SELECT id, body, "authorId" FROM inbox_notes WHERE id = ${note.id} AND "workspaceId" = ${workspaceA}`;
    const noteAudit = await db.$queryRaw<Array<{ detail: unknown }>>`SELECT detail FROM activity_logs WHERE "workspaceId" = ${workspaceA} AND action = 'inbox.private_note_added' AND detail->>'noteId' = ${note.id}`;
    check(noteRows[0]?.body === noteBody && noteRows[0]?.authorId === userId && noteAudit.length === 1 && !JSON.stringify(noteAudit[0]?.detail).includes(noteBody), 'Private note content/author persistence or audit redaction failed.');
    const assign = await http('/api/inbox/productivity', 'POST', { action: 'assign', kind: 'message', id: inboxA.conversationId, assigneeId: teammateId, confirmation: `ASSIGN INBOX message ${inboxA.conversationId} TO ${teammateId}` });
    check(assign.ok && (await json(assign))?.assigneeId === teammateId && (await db.conversation.findUnique({ where: { id: inboxA.conversationId }, select: { assigneeId: true } }))?.assigneeId === teammateId, 'Valid active workspace assignee was not applied.');
    const invalidAssignee = await http('/api/inbox/productivity', 'POST', { action: 'assign', kind: 'message', id: inboxA.conversationId, assigneeId: foreignUserId, confirmation: `ASSIGN INBOX message ${inboxA.conversationId} TO ${foreignUserId}` });
    check(invalidAssignee.status === 400 && (await db.conversation.findUnique({ where: { id: inboxA.conversationId }, select: { assigneeId: true } }))?.assigneeId === teammateId
      && await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${workspaceA} AND action = 'inbox.assignment_changed' AND detail->>'assigneeId' = ${foreignUserId}`.then(rows => rows[0]?.count === BigInt(0)), 'Foreign-workspace assignee changed the conversation or produced a committed audit.');
    const readOnlyNote = await mcp('add_inbox_private_note', { kind: 'message', id: inboxA.conversationId, body: 'No write through a read-only key', confirmation: `ADD PRIVATE NOTE message ${inboxA.conversationId}` }, readBearer);
    requireCode(readOnlyNote.body?.result, 'forbidden', 'Read-only MCP key must not append private notes.');
    const crossTenantItem = await http(`/api/inbox/productivity?kind=message&id=${inboxA.conversationId}`, 'GET', undefined, workspaceB);
    check(crossTenantItem.status === 404, 'Workspace B received a productivity record for Workspace A.');
    const crossTenantMcp = await mcp('get_inbox_productivity', { kind: 'message', id: inboxA.conversationId }, writeBearerB);
    requireCode(crossTenantMcp.body?.result, 'not_found', 'Workspace B MCP key read an item belonging to Workspace A.');
    const crossReplyList = await mcp('list_inbox_saved_replies', {}, writeBearerB);
    check(crossReplyList.body?.result?.structuredContent?.replies?.length === 0, 'Workspace B MCP key read saved replies from Workspace A.');
    const noteDelete = await mcp('delete_inbox_private_note', { id: note.id, confirmation: `DELETE PRIVATE NOTE ${note.id}` });
    check(noteDelete.body?.result?.structuredContent?.ok === true && await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM inbox_notes WHERE id = ${note.id}`.then(rows => rows[0]?.count === BigInt(0)), 'MCP private note delete did not remove its scoped record.');

    const savedReply = await json(await http('/api/inbox/productivity', 'POST', { action: 'reply.create', name: 'Probe saved reply', body: 'Synthetic saved reply', confirmation: 'CREATE SAVED REPLY Probe saved reply' }));
    check(savedReply?.ok === true && typeof savedReply.id === 'string', 'HTTP saved reply create failed.');
    const savedReplyList = await json(await http('/api/inbox/productivity?view=saved-replies&limit=10'));
    check(savedReplyList?.replies?.some((row: { id: string }) => row.id === savedReply.id), 'HTTP saved reply listing did not return the stored record.');
    const mcpReplyUpdate = await mcp('update_inbox_saved_reply', { id: savedReply.id, name: 'Probe saved reply updated', body: 'Updated synthetic reply', confirmation: `UPDATE SAVED REPLY ${savedReply.id}` });
    const persistedReply = await db.$queryRaw<Array<{ workspaceId: string; name: string; body: string }>>`SELECT "workspaceId", name, body FROM saved_replies WHERE id = ${savedReply.id}`;
    check(mcpReplyUpdate.body?.result?.structuredContent?.ok === true && persistedReply[0]?.workspaceId === workspaceA && persistedReply[0]?.name === 'Probe saved reply updated' && persistedReply[0]?.body === 'Updated synthetic reply', 'MCP saved reply update did not atomically persist the scoped content.');
    const replyReadOnlyDelete = await mcp('delete_inbox_saved_reply', { id: savedReply.id, confirmation: `DELETE SAVED REPLY ${savedReply.id}` }, readBearer);
    requireCode(replyReadOnlyDelete.body?.result, 'forbidden', 'Read-only MCP key must not delete a saved reply.');
    const mcpReplyDelete = await mcp('delete_inbox_saved_reply', { id: savedReply.id, confirmation: `DELETE SAVED REPLY ${savedReply.id}` });
    check(mcpReplyDelete.body?.result?.structuredContent?.ok === true && await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM saved_replies WHERE id = ${savedReply.id}`.then(rows => rows[0]?.count === BigInt(0)), 'MCP saved reply delete did not remove its current-workspace record.');

    stage = 'durable audit scope and fixture read-back';
    const auditCounts = await db.$queryRaw<Array<{ templates: bigint; inbox: bigint; policies: bigint }>>`SELECT
      COUNT(*) FILTER (WHERE action LIKE 'publishing.template_%')::bigint AS templates,
      COUNT(*) FILTER (WHERE action LIKE 'inbox.%')::bigint AS inbox,
      COUNT(*) FILTER (WHERE action = 'workspace.policy_updated')::bigint AS policies
      FROM activity_logs WHERE "workspaceId" = ${workspaceA}`;
    check(Number(auditCounts[0]?.templates ?? 0) >= 4 && Number(auditCounts[0]?.inbox ?? 0) >= 5 && Number(auditCounts[0]?.policies ?? 0) === 2, 'Expected shared-service audit events were not persisted.');
    check(await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${workspaceB} AND (action LIKE 'publishing.template_%' OR action LIKE 'inbox.%' OR action = 'workspace.policy_updated')`.then(rows => rows[0]?.count === BigInt(0)), 'Workspace A operations wrote audit events into Workspace B.');
    console.log('PASS: guarded local API/MCP database probe verified workspace policy, pending draft/scheduled approval release and metadata, template CRUD/label scope, Inbox assignment/private note/saved reply CRUD, scoped audits, cross-workspace denials and read-only MCP authorization.');
  } finally {
    const workStage = stage;
    const cleanupErrors: string[] = [];
    async function cleanup(label: string, action: () => Promise<unknown>) { try { await action(); } catch { cleanupErrors.push(label); } }
    if (settingsCaptured) {
      for (const key of configKeys) {
        const previous = originalSettings.get(key);
        await cleanup(`setting:${key}`, async () => {
          await db.appSetting.deleteMany({ where: { key } });
          if (previous) await db.appSetting.create({ data: { ...previous, value: previous.value as Prisma.InputJsonValue } });
        });
      }
    }
    if (settingsCaptured) await cleanup('Root config audits', async () => {
      const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId" = ${userId} AND action = 'config.changed' AND detail->>'key' = ANY(${[...configKeys]}::text[])`;
      for (const row of rows) if (!previousConfigAudits.has(row.id)) changedConfigAudits.add(row.id);
      if (changedConfigAudits.size) await db.$executeRaw`DELETE FROM root_activities WHERE id = ANY(${[...changedConfigAudits]}::text[])`;
    });
    if (fixtureStarted) {
      await cleanup('MCP keys', () => db.mcpApiKey.deleteMany({ where: { id: { in: keyIds } } }));
      await cleanup('sessions', () => db.session.deleteMany({ where: { userId } }));
      await cleanup('workspaces and dependent synthetic records', () => db.workspace.deleteMany({ where: { id: { in: workspaceIds } } }));
      await cleanup('synthetic users', () => db.user.deleteMany({ where: { id: { in: userIds } } }));
      await cleanup('fixture cleanup verification', async () => {
      check(await db.user.count({ where: { id: { in: userIds } } }) === 0 && await db.workspace.count({ where: { id: { in: workspaceIds } } }) === 0
        && await db.session.count({ where: { userId } }) === 0 && await db.mcpApiKey.count({ where: { id: { in: keyIds } } }) === 0
        && (await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ANY(${workspaceIds}::text[])`)[0]?.count === BigInt(0)
        && (await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM root_activities WHERE id = ANY(${[...changedConfigAudits]}::text[])`)[0]?.count === BigInt(0), 'Synthetic users, workspaces, sessions, keys or audit records remain after cleanup.');
      for (const key of configKeys) {
        const restored = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
        check(JSON.stringify(restored) === JSON.stringify(originalSettings.get(key)), 'A Root setting was not restored exactly to its original stored row.');
      }
      });
    }
    await db.$disconnect().catch(() => { cleanupErrors.push('database disconnect'); });
    if (cleanupErrors.length) stage = `cleanup after ${workStage}`;
    check(cleanupErrors.length === 0, 'Disposable records or Root settings could not be restored and verified.');
    if (fixtureStarted) console.log('Disposable users, tenants, channels, content, notes, saved replies, MCP keys, audits and exact prior Root settings restored and verified.');
  }
}

main().catch(error => {
  const errorType = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(error.name) ? error.name : 'Error';
  const errorCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,24}$/.test(error.code) ? ` code=${error.code}` : '';
  const meta = error && typeof error === 'object' && 'meta' in error && error.meta && typeof error.meta === 'object' ? error.meta : null;
  const databaseCode = meta && 'code' in meta && typeof meta.code === 'string' && /^[0-9A-Z]{5}$/.test(meta.code) ? ` dbCode=${meta.code}` : '';
  console.error(`Core workflow probe failed at ${stage}: ${error instanceof ProbeFailure ? error.message : `unexpected ${errorType}${errorCode}${databaseCode} (details withheld)`}`);
  process.exitCode = 1;
});
