import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; values: unknown[] }>, executions: [] as Array<{ sql: string; values: unknown[] }>,
  authorize: vi.fn(), workspace: vi.fn(), failAudit: false, overrides: {} as Record<string, number>,
}));
const row = { id: 'tpl_a', name: 'Welcome', category: '', body: 'Hello {first_name}', hashtags: '#welcome', firstComment: '', labelId: null, createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z') };
const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => state.overrides[key] ?? ({
  'publishing.templateLabelLimit': 200, 'publishing.templatePageSize': 25, 'publishing.templateMaxPerWorkspace': 500, 'publishing.templateSearchMaxCharacters': 120,
  'publishing.templateNameMaxCharacters': 120, 'publishing.templateCategoryMaxCharacters': 80, 'publishing.templateBodyMaxCharacters': 5000,
  'publishing.templateHashtagsMaxCharacters': 1000, 'publishing.templateFirstCommentMaxCharacters': 2000,
  'publishing.templateTransactionTimeoutMs': 5000, 'publishing.templateTransactionMaxWaitMs': 2000, 'data.workspaceOperationTimeoutMs': 30000,
  'data.workspaceOperationLockWaitMs': 2000,
})[key] }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: state.authorize }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: state.workspace }));

import { OperationError } from '../src/lib/operation-error';
import { createTemplate, deleteTemplate, readTemplatePage, readTemplateLabels, updateTemplate } from '../src/modules/publishing/server/templates';
import { createTemplateConfirmation, deleteTemplateConfirmation, updateTemplateConfirmation } from '../src/modules/publishing/templates';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
function sql(strings: TemplateStringsArray, values: unknown[]) { return { sql: strings.join('?'), values }; }

beforeEach(() => {
  vi.clearAllMocks(); state.queries = []; state.executions = []; state.failAudit = false; state.overrides = {};
  state.authorize.mockResolvedValue({ role: 'owner', actor, entitlements: {}, permissions: {} });
  state.workspace.mockImplementation((_id: string, callback: () => Promise<unknown>) => callback());
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = sql(strings, values); state.queries.push(query);
    if (query.sql.includes('memberships m JOIN users')) return [{ role: 'owner', disabledAt: null }];
    if (query.sql.includes('COUNT(*)')) return [{ count: BigInt(0) }];
    if (query.sql.includes('SELECT id, name FROM post_templates')) return [{ id: 'tpl_a', name: 'Welcome' }];
    if (query.sql.includes('SELECT id, name, category')) return [row];
    if (query.sql.includes('SELECT id FROM post_templates')) return [{ id: 'tpl_a' }];
    return [{ acquired: true }];
  });
  db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = sql(strings, values); state.executions.push(query);
    if (state.failAudit && query.sql.includes('activity_logs')) throw new Error('audit write failed');
    return 1;
  });
});

const draft = { name: 'Welcome', category: '', body: 'Hello {first_name}', hashtags: '#welcome', firstComment: '', labelId: null };

describe('workspace publishing templates', () => {
  it('requires exact confirmations and strict fields before any database access', async () => {
    await expect(createTemplate(actor, { ...draft, confirmation: 'CREATE TEMPLATE welcome' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateTemplate(actor, { id: 'tpl_a', ...draft, unknown: 'ignored', confirmation: updateTemplateConfirmation('tpl_a') })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(deleteTemplate(actor, { id: 'tpl_a', confirmation: 'DELETE TEMPLATE other' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('authorizes reads and bounds search to the current workspace with stable pagination', async () => {
    const result = await readTemplatePage(actor, { q: 'welcome', page: 2 });
    expect(result).toMatchObject({ page: 2, pageSize: 25, query: 'welcome' });
    expect(state.authorize).toHaveBeenCalledWith(actor, 'publishing/templates', 'read');
    const statement = state.queries.at(-1)!;
    expect(statement.sql).toContain('"workspaceId" = ?');
    expect(statement.values).toContain(actor.workspaceId);
    expect(statement.values).toContain('%welcome%');
    await expect(readTemplatePage(actor, { q: 'x'.repeat(121) })).rejects.toBeInstanceOf(OperationError);
  });

  it('creates and updates locally with transactional, workspace-scoped audit records', async () => {
    const created = await createTemplate(actor, { ...draft, confirmation: createTemplateConfirmation('Welcome') });
    expect(created.id).toBe('tpl_a');
    const insert = state.executions.find(query => query.sql.includes('INSERT INTO post_templates'))!;
    expect(insert.values).toContain(actor.workspaceId);
    const update = await updateTemplate(actor, { id: 'tpl_a', ...draft, name: 'Welcome again', confirmation: updateTemplateConfirmation('tpl_a') });
    expect(update.id).toBe('tpl_a');
    expect(state.executions.filter(query => query.sql.includes('activity_logs'))).toHaveLength(2);
    expect(state.executions.every(query => query.sql.includes('activity_logs') ? query.values.includes(actor.workspaceId) : true)).toBe(true);
    expect(state.authorize).toHaveBeenCalledWith(actor, 'publishing/templates', 'write');
  });

  it('does not return a create receipt if audit fails inside the atomic transaction', async () => {
    state.failAudit = true;
    await expect(createTemplate(actor, { ...draft, confirmation: createTemplateConfirmation('Welcome') })).rejects.toMatchObject({ code: 'upstream_failure' });
  });

  it('deletes only a template visible in this workspace and returns explicit local receipt', async () => {
    const receipt = await deleteTemplate(actor, { id: 'tpl_a', confirmation: deleteTemplateConfirmation('tpl_a') });
    expect(receipt).toEqual({ id: 'tpl_a', deleted: true });
    const deletion = state.executions.find(query => query.sql.includes('DELETE FROM post_templates'))!;
    expect(deletion.values).toContain(actor.workspaceId);
  });
  it('honors raised Root bounds and zero optional-field limits rather than fixed defaults', async () => {
    state.overrides = { 'publishing.templateSearchMaxCharacters': 500, 'publishing.templateBodyMaxCharacters': 10000, 'publishing.templateHashtagsMaxCharacters': 0, 'publishing.templateFirstCommentMaxCharacters': 0 };
    await expect(readTemplatePage(actor, { q: 'x'.repeat(200) })).resolves.toMatchObject({ query: 'x'.repeat(200) });
    await expect(createTemplate(actor, { ...draft, body: 'x'.repeat(6000), hashtags: '', confirmation: createTemplateConfirmation('Welcome') })).resolves.toMatchObject({ id: 'tpl_a' });
    await expect(createTemplate(actor, { ...draft, confirmation: createTemplateConfirmation('Welcome') })).rejects.toMatchObject({ code: 'invalid_request' });
    state.overrides['publishing.templateNameMaxCharacters'] = 999999;
    await expect(readTemplatePage(actor)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('refuses a label directory exceeding its Root cap without silently dropping choices', async () => {
    state.overrides['publishing.templateLabelLimit'] = 1;
    db.$queryRaw.mockResolvedValueOnce([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    await expect(readTemplateLabels(actor)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('keeps uniqueness conflicts distinguishable from uncertain database outcomes', async () => {
    db.$transaction.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'P2002' }));
    await expect(createTemplate(actor, { ...draft, confirmation: createTemplateConfirmation('Welcome') })).rejects.toMatchObject({ code: 'conflict' });
  });

});
