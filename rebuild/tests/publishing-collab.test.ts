import { beforeEach, describe, expect, it, vi } from 'vitest';

type Q = { sql: string; values: unknown[] };
const state = vi.hoisted(() => ({
  queries: [] as Q[], executions: [] as Q[], handlers: [] as Array<[string, (values: unknown[]) => unknown]>,
  role: 'owner', all: true, post: { id: 'p1', authorId: 'user-a', status: 'draft', scheduledAt: null } as null | { id: string; authorId: string; status: string; scheduledAt: Date | null },
  failAudit: false, config: {} as Record<string, unknown>, selectedCalls: [] as unknown[],
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(), post: { findFirst: vi.fn(), findMany: vi.fn() } }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => (key in state.config ? state.config[key] : key === 'publishing.labelMaxPerWorkspace' ? 200 : key === 'publishing.searchMaxCharacters' ? 200 : key === 'data.workspaceOperationTimeoutMs' ? 30000 : DEFAULTS[key]) }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, cb: () => Promise<unknown>) => cb() }));
vi.mock('@/modules/publishing/server/access', () => ({
  authorizePublishing: vi.fn(async (actor: { userId: string; workspaceId: string }) => ({
    actor, role: state.role, entitlements: {},
    permissions: { pageScope: state.all ? { all: true, ids: [] } : { all: false, ids: ['t1'] }, features: { 'publishing/collaboration': { read: true, write: true }, 'publishing/queue': { read: true, write: true } } },
  })),
}));
vi.mock('@/modules/publishing/server/read-scope', () => ({
  selectedPublishingTargetIds: vi.fn(async (...args: unknown[]) => { state.selectedCalls.push(args); return ['t1', 't2']; }),
  publishingPostVisibilityWhere: (workspaceId: string, ids: string[], authorId?: string) => ({ workspaceId, visibleTargets: ids, authorId }),
}));

import { COLLAB_CONFIG, COLLAB_DEFAULTS } from '../src/modules/publishing/collaboration/config';
const DEFAULTS: Record<string, unknown> = Object.fromEntries(COLLAB_CONFIG.map(item => [item.key, item.defaultValue]));
import { registerCollaborationPorts } from '../src/modules/publishing/collaboration/ports';
import { assignConfirmation, createFieldConfirmation, updateFieldConfirmation, setFieldValuesConfirmation, addNoteConfirmation, deleteNoteConfirmation, restoreVersionConfirmation, replaceSlotsConfirmation, saveMixConfirmation, setRecycleConfirmation, deleteFieldConfirmation } from '../src/modules/publishing/collaboration/schemas';
import { assignLabels, readPostLabels } from '../src/modules/publishing/collaboration/server/assignments';
import { createCustomField, deleteCustomField, setPostFieldValues, updateCustomField } from '../src/modules/publishing/collaboration/server/custom-fields';
import { addPostNote, deletePostNote } from '../src/modules/publishing/collaboration/server/notes';
import { recordPostVersion, requestVersionRestore } from '../src/modules/publishing/collaboration/server/versions';
import { readQueueSlots, replaceQueueSlots } from '../src/modules/publishing/collaboration/server/queue-slots';
import { readContentMix, saveContentMix } from '../src/modules/publishing/collaboration/server/content-mix';
import { listAssignablePosts } from '../src/modules/publishing/collaboration/server/post-list';
import { readCollaborationLabels } from '../src/modules/publishing/collaboration/server/label-choices';
import { readRecycle, setRecycle } from '../src/modules/publishing/collaboration/server/recycle';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const sql = (strings: TemplateStringsArray, values: unknown[]) => ({ sql: strings.join('?'), values });
const when = (fragment: string, fn: (values: unknown[]) => unknown) => { state.handlers.unshift([fragment, fn]); };
const wrote = (fragment: string) => state.executions.some(q => q.sql.includes(fragment));
const audited = (action: string) => state.executions.some(q => q.sql.includes('activity_logs') && q.values.includes(action));
const writes = () => state.executions.filter(q => !q.sql.includes('activity_logs')).length;

beforeEach(() => {
  vi.clearAllMocks(); registerCollaborationPorts({});
  Object.assign(state, { queries: [], executions: [], handlers: [], role: 'owner', all: true, failAudit: false, config: {}, selectedCalls: [], post: { id: 'p1', authorId: 'user-a', status: 'draft', scheduledAt: null } });
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.post.findFirst.mockImplementation(async () => state.post);
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = sql(strings, values); state.queries.push(q);
    for (const [fragment, fn] of state.handlers) if (q.sql.includes(fragment)) return fn(values);
    if (q.sql.includes('AS "foreignReferences"')) return [{ foreignReferences: false }];
    if (q.sql.includes('memberships m JOIN users u ON u.id = m."userId" WHERE m."userId"')) return [{ role: state.role, disabledAt: null }];
    if (q.sql.includes('FROM targets')) return [{ id: 't1', name: 'Alpha', type: 'page' }, { id: 't2', name: 'Beta', type: 'page' }];
    if (q.sql.includes('COUNT(*)')) return [{ count: BigInt(0) }];
    return [];
  });
  db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = sql(strings, values); state.executions.push(q);
    if (state.failAudit && q.sql.includes('activity_logs')) throw new Error('audit unavailable');
    return 1;
  });
});

describe('label assignment', () => {
  const ok = (over: object = {}) => ({ postIds: ['p1'], labelIds: ['l1'], mode: 'add', confirmation: assignConfirmation('add', 1), ...over });
  const labelsFound = () => when('FROM labels WHERE', () => [{ id: 'l1' }]);

  it('requires exact confirmation, strict fields and bulk bounds before touching the database', async () => {
    await expect(assignLabels(actor, ok({ confirmation: 'ADD LABELS ON 2 POSTS' }))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(assignLabels(actor, ok({ extra: 1 }))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(assignLabels(actor, ok({ labelIds: [] }))).rejects.toMatchObject({ code: 'invalid_request' });
    const many = Array.from({ length: COLLAB_DEFAULTS.bulkPostLimit + 1 }, (_, i) => `p${i}`);
    await expect(assignLabels(actor, ok({ postIds: many, confirmation: assignConfirmation('add', many.length) }))).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('adds labels atomically with set-based SQL, workspace-scoped label check and an audit record', async () => {
    labelsFound();
    let afterRead = 0;
    when('FROM post_labels WHERE "postId" = ANY', () => (afterRead++ === 0 ? [] : [{ postId: 'p1', labelId: 'l1' }]));
    const result = await assignLabels(actor, ok());
    expect(result).toMatchObject({ added: 1, removed: 0, posts: [{ postId: 'p1', labelIds: ['l1'] }] });
    expect(wrote('INSERT INTO post_labels')).toBe(true);
    expect(audited('publishing.post_labels_changed')).toBe(true);
    expect(db.$transaction).toHaveBeenCalledOnce();
    const labelCheck = state.queries.find(q => q.sql.includes('FROM labels WHERE'))!;
    expect(labelCheck.values).toContain('workspace-a');
    expect(db.post.findFirst.mock.calls[0]![0].where).toMatchObject({ id: 'p1', workspaceId: 'workspace-a', visibleTargets: ['t1', 't2'] });
  });

  it('replaces (set) by removing labels outside the chosen set first', async () => {
    labelsFound();
    await assignLabels(actor, ok({ mode: 'set', confirmation: assignConfirmation('set', 1) }));
    const del = state.executions.find(q => q.sql.includes('DELETE FROM post_labels'))!;
    expect(del.sql).toContain('NOT ("labelId"');
  });

  it('refuses a post the caller cannot see and changes nothing', async () => {
    state.post = null; labelsFound();
    await expect(assignLabels(actor, ok())).rejects.toMatchObject({ code: 'not_found' });
    expect(writes()).toBe(0); expect(audited('publishing.post_labels_changed')).toBe(false);
  });

  it('limits contributors to their own posts and visibility to their channel grants', async () => {
    state.role = 'contributor'; state.post = { id: 'p1', authorId: 'someone-else', status: 'draft', scheduledAt: null }; labelsFound();
    await expect(assignLabels(actor, ok())).rejects.toMatchObject({ code: 'forbidden' });
    expect(writes()).toBe(0);
    expect(db.post.findFirst.mock.calls[0]![0].where.authorId).toBe('user-a');
  });

  it('rejects labels from another workspace and caps labels per post, rolling back through the thrown error', async () => {
    when('FROM labels WHERE', () => []);
    await expect(assignLabels(actor, ok())).rejects.toMatchObject({ code: 'invalid_request' });
    expect(wrote('INSERT INTO post_labels')).toBe(false);
    state.handlers = []; labelsFound();
    when('FROM post_labels WHERE "postId" = ANY(?::text[]) ORDER', () => Array.from({ length: COLLAB_DEFAULTS.labelsPerPostLimit + 1 }, (_, i) => ({ postId: 'p1', labelId: `x${i}` })));
    await expect(assignLabels(actor, ok())).rejects.toMatchObject({ code: 'conflict' });
    expect(audited('publishing.post_labels_changed')).toBe(false);
  });

  it('does not report success when the audit write fails', async () => {
    labelsFound(); state.failAudit = true;
    await expect(assignLabels(actor, ok())).rejects.toMatchObject({ code: 'upstream_failure' });
  });

  it('reads a single post only when it is visible', async () => {
    state.post = null;
    await expect(readPostLabels(actor, 'p1')).rejects.toMatchObject({ code: 'not_found' });
    await expect(readPostLabels(actor, '')).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('custom fields', () => {
  const create = { name: 'Campaign', kind: 'text', options: [], confirmation: createFieldConfirmation('Campaign') };

  it('lets only owners/admins with all-channel access manage definitions', async () => {
    state.role = 'editor';
    await expect(createCustomField(actor, create)).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'admin'; state.all = false;
    await expect(createCustomField(actor, create)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(deleteCustomField(actor, { id: 'f1', confirmation: deleteFieldConfirmation('f1') })).rejects.toMatchObject({ code: 'forbidden' });
    expect(writes()).toBe(0);
  });

  it('creates with position, dedupes choice options and audits; maps duplicates and the workspace limit', async () => {
    when('COUNT(*)', () => [{ count: BigInt(2) }]);
    const result = await createCustomField(actor, { name: 'Product', kind: 'choice', options: ['A', 'B', 'A'], confirmation: createFieldConfirmation('Product') });
    expect(result).toMatchObject({ options: ['A', 'B'], position: 2 });
    expect(audited('publishing.custom_field_created')).toBe(true);
    db.$executeRaw.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(createCustomField(actor, create)).rejects.toMatchObject({ code: 'conflict' });
    state.handlers = []; when('COUNT(*)', () => [{ count: BigInt(COLLAB_DEFAULTS.fieldLimit) }]);
    await expect(createCustomField(actor, create)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('validates field shape: choice needs two options, text has none', async () => {
    await expect(createCustomField(actor, { name: 'X', kind: 'choice', options: ['only'], confirmation: createFieldConfirmation('X') })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createCustomField(actor, { name: 'X', kind: 'text', options: ['a'], confirmation: createFieldConfirmation('X') })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('refuses an option change that would orphan stored values, and reports removed values on delete', async () => {
    when('FROM custom_fields WHERE id', () => [{ id: 'f1', name: 'Product', position: 0 }]);
    when('NOT (value = ANY', () => [{ count: BigInt(3) }]);
    await expect(updateCustomField(actor, { id: 'f1', name: 'Product', kind: 'choice', options: ['A', 'B'], confirmation: updateFieldConfirmation('f1') })).rejects.toMatchObject({ code: 'conflict' });
    expect(wrote('UPDATE custom_fields')).toBe(false);
    when('FROM post_field_values WHERE "fieldId"', () => [{ count: BigInt(4) }]);
    await expect(deleteCustomField(actor, { id: 'f1', confirmation: deleteFieldConfirmation('f1') })).resolves.toEqual({ id: 'f1', deleted: true, valuesRemoved: 4 });
    expect(audited('publishing.custom_field_deleted')).toBe(true);
  });

  it('sets and clears values; rejects unknown fields and choices outside the options', async () => {
    const values = { f1: ' hello ', f2: '' };
    when('FROM custom_fields WHERE "workspaceId"', () => [{ id: 'f1', kind: 'text', options: [] }, { id: 'f2', kind: 'text', options: [] }]);
    await expect(setPostFieldValues(actor, { postId: 'p1', values, confirmation: setFieldValuesConfirmation('p1') })).resolves.toEqual({ postId: 'p1', set: 1, cleared: 1 });
    expect(state.executions.find(q => q.sql.includes('INSERT INTO post_field_values'))!.values).toContain('hello');
    state.handlers = []; when('FROM custom_fields WHERE "workspaceId"', () => []);
    await expect(setPostFieldValues(actor, { postId: 'p1', values: { other: 'x' }, confirmation: setFieldValuesConfirmation('p1') })).rejects.toMatchObject({ code: 'invalid_request' });
    state.handlers = []; when('FROM custom_fields WHERE "workspaceId"', () => [{ id: 'f1', kind: 'choice', options: ['A', 'B'] }]);
    await expect(setPostFieldValues(actor, { postId: 'p1', values: { f1: 'C' }, confirmation: setFieldValuesConfirmation('p1') })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('blocks contributors from other authors posts', async () => {
    state.role = 'contributor'; state.post = { id: 'p1', authorId: 'zed', status: 'draft', scheduledAt: null };
    await expect(setPostFieldValues(actor, { postId: 'p1', values: {}, confirmation: setFieldValuesConfirmation('p1') })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('internal notes', () => {
  const add = (over: object = {}) => ({ postId: 'p1', body: 'Check this @Mia', mentionIds: ['mia', 'user-a', 'ghost'], confirmation: addNoteConfirmation('p1'), ...over });
  const members = () => when('FROM memberships m JOIN users u ON u.id = m."userId"\n', () => []);
  const candidates = () => when('NOT EXISTS (', () => [{ id: 'mia', name: 'Mia' }, { id: 'user-a', name: 'Me' }]);

  it('keeps only mentionable members named in the text, excludes the author, and audits', async () => {
    candidates();
    const result = await addPostNote(actor, add({ body: 'Check this @Mia and @Me' }));
    expect(result).toMatchObject({ mentionIds: ['mia'], notified: 'unavailable' });
    const insert = state.executions.find(q => q.sql.includes('INSERT INTO post_notes'))!;
    expect(insert.values).toContainEqual(['mia']);
    expect(audited('publishing.post_note_added')).toBe(true);
    members();
  });

  it('notifies after commit and reports delivery honestly without undoing the note', async () => {
    candidates();
    const notify = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('smtp secret'));
    registerCollaborationPorts({ mentions: { notifyNoteMention: notify } });
    await expect(addPostNote(actor, add())).resolves.toMatchObject({ notified: 'sent' });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-a', recipientIds: ['mia'] }));
    const failed = await addPostNote(actor, add());
    expect(failed.notified).toBe('failed');
    expect(JSON.stringify(failed)).not.toContain('smtp');
    state.handlers = []; candidates();
    await expect(addPostNote(actor, add({ body: 'no mention', mentionIds: [] }))).resolves.toMatchObject({ notified: 'none' });
  });

  it('refuses invisible posts, over-long notes and the per-post limit', async () => {
    state.post = null;
    await expect(addPostNote(actor, add())).rejects.toMatchObject({ code: 'not_found' });
    state.post = { id: 'p1', authorId: 'user-a', status: 'draft', scheduledAt: null };
    await expect(addPostNote(actor, add({ body: 'x'.repeat(COLLAB_DEFAULTS.noteMax + 1) }))).rejects.toMatchObject({ code: 'invalid_request' });
    when('FROM post_notes WHERE "postId"', () => [{ count: BigInt(COLLAB_DEFAULTS.notesPerPostLimit) }]);
    await expect(addPostNote(actor, add())).rejects.toMatchObject({ code: 'conflict' });
    expect(wrote('INSERT INTO post_notes')).toBe(false);
  });

  it('lets authors and editors delete, and hides others notes from contributors', async () => {
    when('FROM post_notes n JOIN posts p', () => [{ id: 'n1', postId: 'p1', authorId: 'user-a' }]);
    await expect(deletePostNote(actor, { noteId: 'n1', confirmation: deleteNoteConfirmation('n1') })).resolves.toEqual({ id: 'n1', deleted: true });
    expect(audited('publishing.post_note_deleted')).toBe(true);
    state.handlers = []; state.executions = [];
    when('FROM post_notes n JOIN posts p', () => [{ id: 'n1', postId: 'p1', authorId: 'other' }]);
    state.role = 'contributor';
    await expect(deletePostNote(actor, { noteId: 'n1', confirmation: deleteNoteConfirmation('n1') })).rejects.toMatchObject({ code: 'not_found' });
    state.role = 'editor';
    await expect(deletePostNote(actor, { noteId: 'n1', confirmation: deleteNoteConfirmation('n1') })).resolves.toMatchObject({ deleted: true });
    state.post = null;
    await expect(deletePostNote(actor, { noteId: 'n1', confirmation: deleteNoteConfirmation('n1') })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('version history', () => {
  const restore = { postId: 'p1', versionId: 'v1', confirmation: restoreVersionConfirmation('v1') };
  const version = { id: 'v1', message: 'old', firstComment: null, link: null, media: [], format: 'post', targetIds: ['t1'], labelIds: [], scheduledAt: null, timezone: 'UTC' };

  it('is unavailable until the lifecycle port is registered and never edits the post itself', async () => {
    await expect(requestVersionRestore(actor, restore)).rejects.toMatchObject({ code: 'unavailable' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('checks the version belongs to the post, hands a snapshot to the lifecycle and audits request and result', async () => {
    const port = { restorePostVersion: vi.fn().mockResolvedValue({ postId: 'p1', status: 'draft', approvalReset: true }) };
    registerCollaborationPorts({ versions: port });
    when('FROM post_versions v JOIN posts p', (values) => (values.includes('v1') && values.includes('workspace-a') ? [version] : []));
    await expect(requestVersionRestore(actor, restore)).resolves.toEqual({ postId: 'p1', versionId: 'v1', status: 'draft', approvalReset: true });
    expect(port.restorePostVersion).toHaveBeenCalledWith({ actor, postId: 'p1', snapshot: expect.objectContaining({ versionId: 'v1', message: 'old' }) });
    expect(audited('publishing.version_restore_requested')).toBe(true);
    expect(audited('publishing.version_restored')).toBe(true);
    expect(wrote('UPDATE posts')).toBe(false);
    state.handlers = [];
    await expect(requestVersionRestore(actor, { ...restore, versionId: 'v9', confirmation: restoreVersionConfirmation('v9') })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses published posts, other authors for contributors and hides lifecycle failures', async () => {
    const port = { restorePostVersion: vi.fn().mockRejectedValue(new Error('internal stack')) };
    registerCollaborationPorts({ versions: port });
    when('FROM post_versions v JOIN posts p', () => [version]);
    state.post = { id: 'p1', authorId: 'user-a', status: 'published', scheduledAt: null };
    await expect(requestVersionRestore(actor, restore)).rejects.toMatchObject({ code: 'conflict' });
    state.post = { id: 'p1', authorId: 'user-a', status: 'draft', scheduledAt: null };
    await expect(requestVersionRestore(actor, restore)).rejects.toSatisfy((e: unknown) => !(e as Error).message.includes('internal'));
    state.role = 'contributor'; state.post = { id: 'p1', authorId: 'zed', status: 'draft', scheduledAt: null };
    port.restorePostVersion.mockClear();
    await expect(requestVersionRestore(actor, restore)).rejects.toMatchObject({ code: 'forbidden' });
    expect(port.restorePostVersion).not.toHaveBeenCalled();
  });

  it('records versions through a lifecycle helper, pruning only after an insert', async () => {
    await expect(recordPostVersion(db as never, 'p1', 'u', 0)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(recordPostVersion(db as never, 'p1', 'u', 50)).resolves.toBe(true);
    expect(wrote('DELETE FROM post_versions')).toBe(true);
    state.executions = []; db.$executeRaw.mockResolvedValueOnce(0);
    await expect(recordPostVersion(db as never, 'p1', 'u', 50)).resolves.toBe(false);
    expect(wrote('DELETE FROM post_versions')).toBe(false);
  });
});

describe('queue times', () => {
  beforeEach(() => registerCollaborationPorts({ queue: { available: true } }));
  it('is unavailable until the host registers the queue scheduler', async () => {
    registerCollaborationPorts({});
    await expect(readQueueSlots(actor)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(replaceQueueSlots(actor, { targetId: null, slots: [], confirmation: replaceSlotsConfirmation(null) })).rejects.toMatchObject({ code: 'unavailable' });
    expect(writes()).toBe(0);
  });
  const slots = [{ dayOfWeek: 1, hour: 9, minute: 0 }, { dayOfWeek: 1, hour: 9, minute: 0 }, { dayOfWeek: 2, hour: 18, minute: 30 }];
  const body = (targetId: string | null, over: object = {}) => ({ targetId, slots, confirmation: replaceSlotsConfirmation(targetId), ...over });

  it('replaces a timetable atomically, collapses duplicates and audits before/after counts', async () => {
    when('COUNT(*)', () => [{ count: BigInt(4) }]);
    await expect(replaceQueueSlots(actor, body(null))).resolves.toEqual({ targetId: null, count: 2, replaced: 4 });
    expect(state.executions.filter(q => q.sql.includes('INSERT INTO queue_slots'))).toHaveLength(2);
    expect(state.executions.find(q => q.sql.includes('DELETE FROM queue_slots'))!.values).toEqual(['workspace-a', null]);
    expect(audited('publishing.queue_times_replaced')).toBe(true);
  });

  it('is admin-only; the shared timetable also needs all channels; unknown channels are hidden', async () => {
    state.role = 'editor';
    await expect(replaceQueueSlots(actor, body('t1'))).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'admin'; state.all = false;
    await expect(replaceQueueSlots(actor, body(null))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(replaceQueueSlots(actor, body('t-foreign'))).rejects.toMatchObject({ code: 'not_found' });
    await expect(replaceQueueSlots(actor, body('t1'))).resolves.toMatchObject({ targetId: 't1' });
  });

  it('validates times, the confirmation and the per-timetable limit', async () => {
    await expect(replaceQueueSlots(actor, body(null, { slots: [{ dayOfWeek: 7, hour: 1, minute: 1 }] }))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(replaceQueueSlots(actor, body(null, { confirmation: 'REPLACE QUEUE TIMES t1' }))).rejects.toMatchObject({ code: 'invalid_request' });
    state.config['publishing.collab.queueSlotLimit'] = 1;
    await expect(replaceQueueSlots(actor, body(null))).rejects.toMatchObject({ code: 'invalid_request' });
    expect(writes()).toBe(0);
  });

  it('reads only shared times plus usable channels and rejects a foreign channel filter', async () => {
    await expect(readQueueSlots(actor, { targetId: 'zzz' })).rejects.toMatchObject({ code: 'not_found' });
    const result = await readQueueSlots(actor, {});
    expect(result.targets.map(t => t.id)).toEqual(['t1', 't2']);
    expect(state.queries.at(-1)!.values).toEqual(['workspace-a', ['t1', 't2']]);
  });
});

describe('content mix', () => {
  beforeEach(() => registerCollaborationPorts({ mix: { available: true } }));
  it('is unavailable until the host registers the mix executor', async () => {
    registerCollaborationPorts({});
    await expect(readContentMix(actor)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(saveContentMix(actor, { scope: { targetId: 't1' }, rules: [], confirmation: saveMixConfirmation({ targetId: 't1' }) })).rejects.toMatchObject({ code: 'unavailable' });
    expect(writes()).toBe(0);
  });
  const save = (scope: object, over: object = {}) => ({ scope, rules: [{ labelId: 'l1', perWeek: 3 }], confirmation: saveMixConfirmation(scope), ...over });

  it('saves one channel mix, keeping the dry marker of surviving labels', async () => {
    const dry = new Date('2026-01-01T00:00:00Z');
    when('FROM labels WHERE', () => [{ id: 'l1' }]);
    when('FOR UPDATE', () => [{ labelId: 'l1', dryNotifiedAt: dry }]);
    await expect(saveContentMix(actor, save({ targetId: 't1' }))).resolves.toEqual({ scope: { targetId: 't1' }, rules: 1, replaced: 1 });
    expect(state.executions.find(q => q.sql.includes('INSERT INTO content_mix_rules'))!.values).toContain(dry);
    expect(audited('publishing.content_mix_saved')).toBe(true);
  });

  it('enforces roles, scope shape, group access, workspace-owned labels and bounds', async () => {
    state.role = 'editor';
    await expect(saveContentMix(actor, save({ targetId: 't1' }))).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'admin'; state.all = false;
    await expect(saveContentMix(actor, save({ groupId: 'g1' }))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(saveContentMix(actor, save({ targetId: 't-foreign' }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(saveContentMix(actor, save({ targetId: 't1', groupId: 'g1' }, { confirmation: 'x' }))).rejects.toMatchObject({ code: 'invalid_request' });
    when('FROM labels WHERE', () => []);
    await expect(saveContentMix(actor, save({ targetId: 't1' }))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(saveContentMix(actor, save({ targetId: 't1' }, { rules: [{ labelId: 'l1', perWeek: COLLAB_DEFAULTS.mixMaxPerWeek + 1 }] }))).rejects.toMatchObject({ code: 'invalid_request' });
    expect(wrote('DELETE FROM content_mix_rules')).toBe(false);
  });

  it('shows group rules only to callers with all-channel access and computes the effective plan per channel', async () => {
    const rules = [{ id: 'r1', targetId: null, groupId: 'g1', labelId: 'l1', perWeek: 4, dryNotifiedAt: null }, { id: 'r2', targetId: 't2', groupId: null, labelId: 'l2', perWeek: 2, dryNotifiedAt: null }];
    when('FROM content_mix_rules', () => rules);
    when('FROM page_group_targets', () => [{ groupId: 'g1', targetId: 't1' }, { groupId: 'g1', targetId: 't2' }]);
    when('p.status::text = ANY', () => [{ targetId: 't1', labelId: 'l1', n: BigInt(1) }]);
    const result = await readContentMix(actor, new Date('2026-03-01T00:00:00Z'));
    expect(result.status).toEqual([
      { targetId: 't1', lines: [{ labelId: 'l1', perWeek: 4, planned: 1, readyDrafts: 0 }] },
      { targetId: 't2', lines: [{ labelId: 'l2', perWeek: 2, planned: 0, readyDrafts: 0 }] },
    ]);
    expect(result.canEditGroups).toBe(true);
    state.all = false;
    const restricted = await readContentMix(actor);
    expect(restricted.groups).toEqual([]); expect(restricted.canEditGroups).toBe(false);
  });
});

describe('recycle', () => {
  const row = { recycleEnabled: false, recycleEveryDays: null, recycleLimit: null, recycleCount: 0, recycleNextAt: null, variants: [], originPostId: null, publishedAt: new Date('2026-03-01T00:00:00Z'), scheduledAt: null };
  const set = (over: object = {}) => ({ postId: 'p1', enabled: true, everyDays: 7, confirmation: setRecycleConfirmation('p1'), ...over });
  beforeEach(() => { registerCollaborationPorts({ recycle: { available: true } }); when('FROM posts WHERE id', () => [row]); });

  it('is unavailable without an executor, for reads and writes', async () => {
    registerCollaborationPorts({});
    await expect(readRecycle(actor, { postId: 'p1' })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(setRecycle(actor, set())).rejects.toMatchObject({ code: 'unavailable' });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('enables repeating from the publication time on the chosen cadence and audits it', async () => {
    await setRecycle(actor, set());
    const update = state.executions.find(q => q.sql.includes('UPDATE posts SET "recycleEnabled"'))!;
    expect(update.values[0]).toBe(true); expect(update.values[3]).toEqual(new Date('2026-03-08T00:00:00Z'));
    expect(audited('publishing.recycle_enabled')).toBe(true);
  });

  it('disables without scheduling, refuses repeats, exhausted runs and bad states', async () => {
    await setRecycle(actor, set({ enabled: false }));
    expect(state.executions.find(q => q.sql.includes('UPDATE posts SET "recycleEnabled"'))!.values[3]).toBeNull();
    state.handlers = []; when('FROM posts WHERE id', () => [{ ...row, originPostId: 'orig' }]);
    await expect(setRecycle(actor, set())).rejects.toMatchObject({ code: 'conflict' });
    state.handlers = []; when('FROM posts WHERE id', () => [{ ...row, recycleCount: 3, recycleLimit: 3 }]);
    await expect(setRecycle(actor, set({ limit: 3 }))).rejects.toMatchObject({ code: 'conflict' });
    state.post = { id: 'p1', authorId: 'user-a', status: 'failed', scheduledAt: null };
    await expect(setRecycle(actor, set())).rejects.toMatchObject({ code: 'conflict' });
    await expect(setRecycle(actor, set({ everyDays: COLLAB_DEFAULTS.recycleMaxIntervalDays + 1 }))).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('keeps unreviewed alternate wordings behind editor standing when approvals are required', async () => {
    state.role = 'contributor';
    when('SELECT "requiresApproval"', () => [{ requiresApproval: true }]);
    await expect(setRecycle(actor, set({ variants: ['New wording'] }))).rejects.toMatchObject({ code: 'forbidden' });
    expect(wrote('UPDATE posts SET')).toBe(false);
    await expect(setRecycle(actor, set())).resolves.toBeDefined();
    state.role = 'contributor'; state.post = { id: 'p1', authorId: 'zed', status: 'draft', scheduledAt: null };
    await expect(setRecycle(actor, set())).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('runtime bounds', () => {
  it('fails closed when a Root value is invalid or timeouts exceed the workspace operation', async () => {
    state.config['publishing.collab.bulkPostLimit'] = 0;
    await expect(assignLabels(actor, { postIds: ['p1'], labelIds: ['l1'], mode: 'add', confirmation: assignConfirmation('add', 1) })).rejects.toMatchObject({ code: 'unavailable' });
    state.config = { 'publishing.collab.transactionTimeoutMs': 29000, 'publishing.collab.transactionMaxWaitMs': 5000 };
    await expect(assignLabels(actor, { postIds: ['p1'], labelIds: ['l1'], mode: 'add', confirmation: assignConfirmation('add', 1) })).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('assignable post list', () => {
  it('lists only visible posts (own posts for contributors), escapes nothing into SQL and joins workspace labels', async () => {
    state.role = 'contributor';
    db.post.findMany.mockResolvedValue([{ id: 'p1', message: 'Hello', status: 'draft', scheduledAt: null }]);
    when('FROM post_labels pl JOIN labels l', () => [{ postId: 'p1', id: 'l1', name: 'Spring', color: 'green' }]);
    const result = await listAssignablePosts(actor, { q: 'hel', page: 2 });
    const call = db.post.findMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ workspaceId: 'workspace-a', authorId: 'user-a', message: { contains: 'hel' } });
    expect(call.skip).toBe(COLLAB_DEFAULTS.bulkPostLimit);
    expect(result.posts[0]).toMatchObject({ id: 'p1', labels: [{ id: 'l1', name: 'Spring', color: 'green' }] });
    expect(state.queries.at(-1)!.values).toContain('workspace-a');
    await expect(listAssignablePosts(actor, { page: 0 })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('complete collaboration label choices', () => {
  it('returns every allowed choice under the Root ceiling using a workspace predicate', async () => {
    when('SELECT id, name, color FROM labels', () => [{ id: 'l1', name: 'One', color: 'blue' }, { id: 'l2', name: 'Two', color: 'green' }]);
    expect((await readCollaborationLabels(actor)).labels).toHaveLength(2);
    const query = state.queries.find(q => q.sql.includes('SELECT id, name, color FROM labels'))!;
    expect(query.sql).toContain('WHERE "workspaceId" =');
    expect(query.values).toEqual([actor.workspaceId, 201]);
  });
  it('refuses oversized choices rather than showing a partial picker', async () => {
    state.config['publishing.labelMaxPerWorkspace'] = 1;
    when('SELECT id, name, color FROM labels', () => [{ id: 'l1' }, { id: 'l2' }]);
    await expect(readCollaborationLabels(actor)).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('plain notes without notification delivery', () => {
  it('does not read a mention directory for a note with no requested mentions', async () => {
    await addPostNote(actor, { postId: 'p1', body: 'A plain team note', confirmation: addNoteConfirmation('p1') });
    expect(state.queries.some(q => q.sql.includes('ORDER BY u.name ASC, u.id ASC'))).toBe(false);
  });
});
