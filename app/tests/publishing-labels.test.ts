import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; values: unknown[] }>, executions: [] as Array<{ sql: string; values: unknown[] }>,
  authorize: vi.fn(), workspace: vi.fn(), failAudit: false, nameTaken: false, count: 0, zeroExecution: false,
  config: {} as Record<string, number>,
}));
const row = { id: 'lbl_a', name: 'Spring', color: 'green', createdAt: new Date('2026-01-01T00:00:00Z'), posts: BigInt(3), templates: BigInt(2), contentMixRules: BigInt(1) };
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => state.config[key] ?? ({
  'publishing.labelPageSize': 50, 'publishing.labelMaxPerWorkspace': 200, 'publishing.labelSearchMaxCharacters': 120, 'publishing.labelNameMaxCharacters': 60,
  'publishing.labelTransactionTimeoutMs': 5000, 'publishing.labelTransactionMaxWaitMs': 2000, 'data.workspaceOperationTimeoutMs': 30000,
})[key] }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: state.authorize }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: state.workspace }));

import { createLabel, deleteLabel, readLabelPage, updateLabel } from '../src/modules/publishing/server/labels';
import { executeLabelTool, labelToolDefinitions, labelWriteTools } from '../src/modules/publishing/labels-mcp';
import { LABEL_CONFIG, LABEL_DEFAULTS } from '../src/modules/publishing/labels-config';
import { createLabelConfirmation, deleteLabelConfirmation, describeLabelRemoval, updateLabelConfirmation } from '../src/modules/publishing/labels';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const sql = (strings: TemplateStringsArray, values: unknown[]) => ({ sql: strings.join('?'), values });
const auth = (all: boolean) => ({ role: 'member', actor, entitlements: {}, permissions: { pageScope: all ? { all: true, ids: [] } : { all: false, ids: ['t1'] } } });

beforeEach(() => {
  vi.clearAllMocks(); state.queries = []; state.executions = []; state.failAudit = false; state.nameTaken = false; state.count = 0; state.zeroExecution = false; state.config = {};
  state.authorize.mockResolvedValue(auth(true));
  state.workspace.mockImplementation((_id: string, callback: () => Promise<unknown>) => callback());
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = sql(strings, values); state.queries.push(query);
    if (query.sql.includes('memberships m JOIN users')) return [{ role: 'owner', disabledAt: null }];
    if (query.sql.includes('lower(name)')) return state.nameTaken ? [{ id: 'other' }] : [];
    if (query.sql.includes('COUNT(*)::bigint')) return [{ count: BigInt(state.count) }];
    if (query.sql.includes('FROM labels l')) return [row];
    return [{ acquired: true }];
  });
  db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = sql(strings, values); state.executions.push(query);
    if (state.failAudit && query.sql.includes('activity_logs')) throw new Error('audit write failed');
    return state.zeroExecution ? 0 : 1;
  });
});

describe('publishing labels', () => {
  it('requires exact confirmations and strict fields before any database access', async () => {
    await expect(createLabel(actor, { name: 'Spring', color: 'green', confirmation: 'CREATE LABEL spring' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createLabel(actor, { name: 'Spring', color: 'magenta', confirmation: createLabelConfirmation('Spring') })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateLabel(actor, { id: 'lbl_a', name: 'Spring', color: 'green', extra: 1, confirmation: updateLabelConfirmation('lbl_a') })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(deleteLabel(actor, { id: 'lbl_a', confirmation: 'DELETE LABEL other' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('reads tenant-scoped labels with usage and escapes search wildcards', async () => {
    const result = await readLabelPage(actor, { q: '50%_off' });
    expect(result.labels[0]).toMatchObject({ id: 'lbl_a', usage: { posts: 3, templates: 2, contentMixRules: 1 } });
    const query = state.queries.at(-1)!;
    expect(query.sql).toContain('"workspaceId" = ?');
    expect(query.values).toContain('workspace-a');
    expect(query.values).toContain('%50\\%\\_off%');
    expect(query.sql).toContain('JOIN posts p ON p.id = pl."postId"');
    expect(query.sql).toContain('p."workspaceId" = l."workspaceId"');
    expect(state.authorize).toHaveBeenCalledWith(actor, 'publishing/labels', 'read');
    expect(result.limits).toEqual({ maxSearchCharacters: 120, maxNameCharacters: 60 });
  });

  it('honors Root-raised name and search limits and fails closed on invalid Root values', async () => {
    state.config['publishing.labelNameMaxCharacters'] = 120;
    state.config['publishing.labelSearchMaxCharacters'] = 500;
    const name = 'N'.repeat(120);
    await createLabel(actor, { name, confirmation: createLabelConfirmation(name) });
    expect(state.executions.some(query => query.sql.includes('INSERT INTO labels') && query.values.includes(name))).toBe(true);
    const search = 'q'.repeat(500);
    await expect(readLabelPage(actor, { q: search })).resolves.toMatchObject({ limits: { maxNameCharacters: 120, maxSearchCharacters: 500 }, query: search });
    state.config['publishing.labelNameMaxCharacters'] = 121;
    await expect(readLabelPage(actor)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('withholds workspace-wide usage from channel-restricted members', async () => {
    state.authorize.mockResolvedValue(auth(false));
    const result = await readLabelPage(actor);
    expect(result.workspaceWide).toBe(false);
    expect(result.labels[0]!.usage).toBeNull();
  });

  it('creates a label atomically with a duplicate check and an audit record', async () => {
    const created = await createLabel(actor, { name: ' Spring ', color: 'green', confirmation: createLabelConfirmation('Spring') });
    expect(created.name).toBe('Spring');
    expect(state.executions.some(q => q.sql.includes('INSERT INTO labels'))).toBe(true);
    expect(state.executions.some(q => q.sql.includes('activity_logs') && String(q.values[3]) === 'publishing.label_created')).toBe(true);
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it('maps database uniqueness races before generic error wrapping and checks SQL receipts', async () => {
    db.$executeRaw.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2010', meta: { code: '23505' } }));
    await expect(createLabel(actor, { name: 'Spring', confirmation: createLabelConfirmation('Spring') })).rejects.toMatchObject({ code: 'conflict' });
    db.$executeRaw.mockImplementation(async () => 0);
    await expect(createLabel(actor, { name: 'No row', confirmation: createLabelConfirmation('No row') })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('rejects duplicate names case-insensitively and enforces the workspace limit', async () => {
    state.nameTaken = true;
    await expect(createLabel(actor, { name: 'spring', color: 'blue', confirmation: createLabelConfirmation('spring') })).rejects.toMatchObject({ code: 'conflict' });
    state.nameTaken = false; state.count = 200;
    await expect(createLabel(actor, { name: 'New', color: 'blue', confirmation: createLabelConfirmation('New') })).rejects.toMatchObject({ code: 'conflict' });
    expect(state.executions.some(q => q.sql.includes('INSERT INTO labels'))).toBe(false);
  });

  it('lets a channel-restricted member create but not rename or delete workspace-wide labels', async () => {
    state.authorize.mockResolvedValue(auth(false));
    await expect(createLabel(actor, { name: 'Mine', color: 'blue', confirmation: createLabelConfirmation('Mine') })).resolves.toMatchObject({ usage: null });
    await expect(updateLabel(actor, { id: 'lbl_a', name: 'X', color: 'blue', confirmation: updateLabelConfirmation('lbl_a') })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(deleteLabel(actor, { id: 'lbl_a', confirmation: deleteLabelConfirmation('lbl_a') })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.executions.some(q => q.sql.includes('DELETE FROM labels') || q.sql.includes('UPDATE labels'))).toBe(false);
  });

  it('updates inside the workspace and records previous values', async () => {
    await updateLabel(actor, { id: 'lbl_a', name: 'Summer', color: 'orange', confirmation: updateLabelConfirmation('lbl_a') });
    const update = state.executions.find(q => q.sql.includes('UPDATE labels'))!;
    expect(update.values).toEqual(['Summer', 'orange', 'lbl_a', 'workspace-a']);
    const log = state.executions.find(q => q.sql.includes('activity_logs'))!;
    expect(String(log.values[4])).toContain('"previousName":"Spring"');
  });

  it('fails closed if legacy post-label links cross workspace boundaries', async () => {
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = sql(strings, values); state.queries.push(query);
      if (query.sql.includes('memberships m JOIN users')) return [{ role: 'owner', disabledAt: null }];
      if (query.sql.includes('lower(name)')) return [];
      if (query.sql.includes('FROM labels l')) return [{ ...row, foreignPosts: BigInt(1) }];
      return [{ acquired: true }];
    });
    await expect(updateLabel(actor, { id: 'lbl_a', name: 'Spring new', confirmation: updateLabelConfirmation('lbl_a') })).rejects.toMatchObject({ code: 'unavailable' });
    expect(state.executions.some(q => q.sql.includes('UPDATE labels'))).toBe(false);
  });

  it('deletes only inside the workspace and audits what was detached', async () => {
    const result = await deleteLabel(actor, { id: 'lbl_a', confirmation: deleteLabelConfirmation('lbl_a') });
    expect(result).toEqual({ id: 'lbl_a', deleted: true, detached: { posts: 3, templates: 2, contentMixRules: 1 } });
    const del = state.executions.find(q => q.sql.includes('DELETE FROM labels'))!;
    expect(del.values).toEqual(['lbl_a', 'workspace-a']);
    expect(String(state.executions.find(q => q.sql.includes('activity_logs'))!.values[4])).toContain('"posts":3');
  });

  it('reports not_found for labels outside the workspace and rolls back when audit fails', async () => {
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('?').includes('memberships m JOIN') ? [{ role: 'owner', disabledAt: null }] : []);
    await expect(deleteLabel(actor, { id: 'lbl_x', confirmation: deleteLabelConfirmation('lbl_x') })).rejects.toMatchObject({ code: 'not_found' });
    state.failAudit = true;
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('?').includes('memberships m JOIN') ? [{ role: 'owner', disabledAt: null }] : strings.join('?').includes('FROM labels l') ? [row] : []);
    await expect(deleteLabel(actor, { id: 'lbl_a', confirmation: deleteLabelConfirmation('lbl_a') })).rejects.toMatchObject({ code: 'upstream_failure' });
  });

  it('denies a disabled actor and a suspended or purging workspace', async () => {
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => strings.join('?').includes('memberships m JOIN') ? [{ role: 'owner', disabledAt: new Date() }] : []);
    await expect(createLabel(actor, { name: 'A', color: 'blue', confirmation: createLabelConfirmation('A') })).rejects.toMatchObject({ code: 'unauthorized' });
    state.authorize.mockRejectedValue(Object.assign(new Error('purging'), { code: 'forbidden' }));
    await expect(readLabelPage(actor)).rejects.toThrow('purging');
  });

  it('describes removal consequences plainly', () => {
    expect(describeLabelRemoval({ posts: 1, templates: 0, contentMixRules: 2 })).toContain('1 post, clears it from 0 templates, and removes 2 content-mix rules');
    expect(describeLabelRemoval(null)).toContain('every post in the workspace');
  });

  it('exposes MCP tools with write confirmation parity and typed active config', async () => {
    expect(labelToolDefinitions.map(t => t.name)).toEqual(['list_post_labels', 'create_post_label', 'update_post_label', 'delete_post_label']);
    expect([...labelWriteTools]).toHaveLength(3);
    for (const tool of labelToolDefinitions.filter(t => labelWriteTools.has(t.name))) expect((tool.inputSchema as { required?: readonly string[] }).required).toContain('confirmation');
    await expect(executeLabelTool(actor, 'list_post_labels', { page: 0 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeLabelTool(actor, 'delete_post_label', { id: 'lbl_a', confirmation: 'no' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeLabelTool(actor, 'nope', {})).rejects.toMatchObject({ code: 'invalid_request' });
    expect((await executeLabelTool(actor, 'list_post_labels', {}) as { labels: unknown[] }).labels).toHaveLength(1);
    for (const item of LABEL_CONFIG) { expect(item.consumption).toBe('active'); expect(item.schema.safeParse(item.defaultValue).success).toBe(true); }
    expect(LABEL_CONFIG).toHaveLength(Object.keys(LABEL_DEFAULTS).length);
  });
});
