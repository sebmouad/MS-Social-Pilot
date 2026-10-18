import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const ops = {} as Record<string, ReturnType<typeof vi.fn>>;
  return { viewer: vi.fn(), ops, op: (name: string) => (ops[name] ??= vi.fn(async () => ({ ok: name }))) };
});
vi.mock('@/server/context', () => ({ requireViewer: h.viewer }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => 50 }));
vi.mock('@/modules/publishing/collaboration/server/label-choices', () => ({ readCollaborationLabels: h.op('labelChoices') }));
vi.mock('@/modules/publishing/collaboration/server/assignments', () => ({ assignLabels: h.op('assign'), readPostLabels: h.op('readLabels') }));
vi.mock('@/modules/publishing/collaboration/server/custom-fields', () => ({ createCustomField: h.op('createField'), readCustomFields: h.op('readFields'), updateCustomField: h.op('updateField'), deleteCustomField: h.op('deleteField'), readPostFieldValues: h.op('readValues'), setPostFieldValues: h.op('setValues') }));
vi.mock('@/modules/publishing/collaboration/server/notes', () => ({ addPostNote: h.op('addNote'), deletePostNote: h.op('deleteNote'), readPostNotes: h.op('readNotes') }));
vi.mock('@/modules/publishing/collaboration/server/versions', () => ({ readPostVersions: h.op('readVersions'), requestVersionRestore: h.op('restore') }));
vi.mock('@/modules/publishing/collaboration/server/queue-slots', () => ({ readQueueSlots: h.op('readSlots'), replaceQueueSlots: h.op('replaceSlots') }));
vi.mock('@/modules/publishing/collaboration/server/content-mix', () => ({ readContentMix: h.op('readMix'), saveContentMix: h.op('saveMix') }));
vi.mock('@/modules/publishing/collaboration/server/recycle', () => ({ readRecycle: h.op('readRecycle'), setRecycle: h.op('setRecycle') }));

import { POST as assignPost, GET as assignGet } from '../src/app/api/publishing/assignments/route';
import { PUT as fieldPut, DELETE as fieldDelete } from '../src/app/api/publishing/custom-fields/[id]/route';
import { PUT as valuesPut } from '../src/app/api/publishing/custom-fields/posts/[postId]/route';
import { DELETE as noteDelete } from '../src/app/api/publishing/notes/[id]/route';
import { GET as notesGet } from '../src/app/api/publishing/notes/route';
import { PUT as slotsPut, GET as slotsGet } from '../src/app/api/publishing/queue-slots/route';
import { PUT as mixPut } from '../src/app/api/publishing/content-mix/route';
import { GET as versionsGet } from '../src/app/api/publishing/versions/route';
import { executeCollaborationTool, collaborationToolDefinitions, collaborationWriteTools, availableCollaborationTools } from '../src/modules/publishing/collaboration/mcp';
import { registerCollaborationPorts } from '../src/modules/publishing/collaboration/ports';
import { COLLAB_CONFIG, COLLAB_DEFAULTS } from '../src/modules/publishing/collaboration/config';
import { effectiveMix, mentionedIn, nextRecycleAt, FIELD_CREATE, MIX_SAVE, slotKey } from '../src/modules/publishing/collaboration/schemas';

const base = 'https://app.test/api/publishing';
const post = (url: string, body = '{}', method = 'POST', origin: string | null = 'https://app.test') => new Request(url, { method, body, ...(origin ? { headers: { origin } } : {}) });
const ctx = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
beforeEach(() => { vi.clearAllMocks(); h.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w' }); registerCollaborationPorts({}); });

describe('collaboration HTTP', () => {
  it('rejects query strings on writes before authentication', async () => {
    expect((await assignPost(post(`${base}/assignments?x=1`))).status).toBe(400);
    expect(h.viewer).not.toHaveBeenCalled();
  });
  it('denies cross-origin and origin-less writes before authentication', async () => {
    expect((await assignPost(post(`${base}/assignments`, '{}', 'POST', null))).status).toBe(403);
    expect((await slotsPut(post(`${base}/queue-slots`, '{}', 'PUT', 'https://evil.test'))).status).toBe(403);
    expect(h.viewer).not.toHaveBeenCalled();
  });

  it('uses the owning feature and write flag, and answers 401 when the viewer is not authorized', async () => {
    await slotsPut(post(`${base}/queue-slots`, '{"targetId":null}', 'PUT'));
    expect(h.viewer).toHaveBeenLastCalledWith({ feature: 'publishing/queue', channelScoped: true, write: true });
    await mixPut(post(`${base}/content-mix`, '{}', 'PUT'));
    expect(h.viewer).toHaveBeenLastCalledWith({ feature: 'publishing/queue', channelScoped: true, write: true });
    await assignPost(post(`${base}/assignments`, '{"postIds":["a"]}'));
    expect(h.viewer).toHaveBeenLastCalledWith({ feature: 'publishing/collaboration', channelScoped: true, write: true });
    expect(h.ops.assign).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' }, { postIds: ['a'] });
    h.viewer.mockRejectedValue(new Error('redirect'));
    expect((await slotsGet(new Request(`${base}/queue-slots`))).status).toBe(401);
  });

  it('never trusts ids in bodies for path-addressed resources and rejects malformed input safely', async () => {
    expect((await fieldPut(post(`${base}/custom-fields/f1`, '{"id":"f2"}', 'PUT'), ctx({ id: 'f1' }))).status).toBe(400);
    expect((await fieldDelete(post(`${base}/custom-fields/f1`, '{"confirmation":"x"}', 'DELETE'), ctx({ id: 'f1' }))).status).toBe(200);
    expect(h.ops.deleteField).toHaveBeenCalledWith(expect.anything(), { confirmation: 'x', id: 'f1' });
    expect((await valuesPut(post(`${base}/custom-fields/posts/p1`, '{"postId":"p2","values":{}}', 'PUT'), ctx({ postId: 'p1' }))).status).toBe(400);
    expect((await noteDelete(post(`${base}/notes/n1`, '{"noteId":"n2"}', 'DELETE'), ctx({ id: 'n1' }))).status).toBe(400);
    const broken = await assignPost(post(`${base}/assignments`, '{not json'));
    expect(broken.status).toBe(400);
    expect(JSON.stringify(await broken.json())).not.toMatch(/Unexpected|position/);
  });

  it('accepts only known query parameters, once each', async () => {
    expect((await notesGet(new Request(`${base}/notes?postId=p&x=1`))).status).toBe(400);
    expect((await notesGet(new Request(`${base}/notes?postId=p&postId=q`))).status).toBe(400);
    expect((await notesGet(new Request(`${base}/notes?postId=p&page=0`))).status).toBe(400);
    expect((await versionsGet(new Request(`${base}/versions?postId=p&page=2`))).status).toBe(200);
    expect(h.ops.readVersions).toHaveBeenCalledWith(expect.anything(), { postId: 'p', page: 2 });
    expect((await assignGet(new Request(`${base}/assignments?postId=p`))).status).toBe(200);
  });

  it('turns service failures into safe typed responses', async () => {
    const { OperationError } = await import('../src/lib/operation-error');
    h.ops.assign!.mockRejectedValueOnce(new OperationError('forbidden', 'You can only change your own posts.'));
    const denied = await assignPost(post(`${base}/assignments`));
    expect(denied.status).toBe(403); expect(await denied.json()).toEqual({ error: 'You can only change your own posts.', code: 'forbidden' });
    h.ops.assign!.mockRejectedValueOnce(new Error('connection string postgres://secret'));
    const leak = await assignPost(post(`${base}/assignments`));
    expect(leak.status).toBe(502); expect(JSON.stringify(await leak.json())).not.toContain('secret');
  });
});

describe('collaboration MCP', () => {
  it('defines unique tools whose write set matches confirmation-bearing schemas', () => {
    const names = collaborationToolDefinitions.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of collaborationToolDefinitions) {
      const required = (tool.inputSchema as { required?: readonly string[] }).required ?? [];
      expect(required.includes('confirmation'), tool.name).toBe(collaborationWriteTools.has(tool.name));
    }
  });

  it('hides abilities that need a host port until it is registered', () => {
    const names = () => availableCollaborationTools().map(t => t.name);
    expect(names()).not.toContain('restore_post_version'); expect(names()).not.toContain('set_post_recycle'); expect(names()).not.toContain('get_post_recycle');
    registerCollaborationPorts({ versions: { restorePostVersion: vi.fn() }, recycle: { available: true } });
    expect(names()).toEqual(expect.arrayContaining(['restore_post_version', 'set_post_recycle', 'get_post_recycle']));
  });

  it('routes calls to the shared services with the actor and rejects unknown tools', async () => {
    const actor = { userId: 'u', workspaceId: 'w' };
    await executeCollaborationTool(actor, 'replace_queue_times', { targetId: null });
    expect(h.ops.replaceSlots).toHaveBeenCalledWith(actor, { targetId: null });
    await executeCollaborationTool(actor, 'get_post_field_values', { postId: 'p1' });
    expect(h.ops.readValues).toHaveBeenCalledWith(actor, 'p1');
    await expect(executeCollaborationTool(actor, 'nope', {})).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('collaboration contracts', () => {
  it('distinguishes consumed Root limits from pending execution policy', () => {
    const keys = COLLAB_CONFIG.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of COLLAB_CONFIG) { expect(item.key.startsWith('publishing.collab.')).toBe(true); expect(item.consumption).toBe(['bulkPostLimit', 'labelsPerPostLimit', 'fieldLimit', 'fieldNameMax', 'fieldOptionMax', 'fieldOptionsLimit', 'fieldValueMax', 'mentionDirectoryLimit', 'noteMax', 'notePageSize', 'noteMentionLimit', 'notesPerPostLimit', 'versionPageSize', 'versionRetention', 'queueSlotLimit', 'queueLookaheadDays', 'transactionTimeoutMs', 'transactionMaxWaitMs'].some(key => item.key === `publishing.collab.${key}`) ? 'active' : 'planned'); expect(item.schema.safeParse(item.defaultValue).success).toBe(true); }
    expect(keys).toHaveLength(Object.keys(COLLAB_DEFAULTS).length);
  });

  it('computes the recycle cadence without bursts after downtime', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(nextRecycleAt({ everyDays: 7, limit: null, count: 0, from })).toEqual(new Date('2026-01-08T00:00:00Z'));
    expect(nextRecycleAt({ everyDays: 7, limit: null, count: 0, from, now: new Date('2026-01-20T00:00:00Z') })).toEqual(new Date('2026-01-22T00:00:00Z'));
    expect(nextRecycleAt({ everyDays: 7, limit: 2, count: 2, from })).toBeNull();
    expect(nextRecycleAt({ everyDays: null, limit: null, count: 0, from })).toBeNull();
  });

  it('applies mentions only for names present in the text and orders channel rules over group rules', () => {
    const members = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }];
    expect(mentionedIn('hi @Ann', members, ['a', 'b'])).toEqual(['a']);
    expect(mentionedIn('hi @Annabel', members, ['a'])).toEqual([]);
    expect(mentionedIn('hi @Sam Lee!', [{ id: 's', name: 'Sam' }, { id: 'l', name: 'Sam Lee' }], ['s', 'l'])).toEqual(['l']);
    expect(mentionedIn('hi @Ann', members, ['b'])).toEqual([]);
    const rules = [{ id: '1', targetId: null, groupId: 'g', labelId: 'x', perWeek: 5 }, { id: '2', targetId: null, groupId: 'h', labelId: 'x', perWeek: 7 }, { id: '3', targetId: 't2', groupId: null, labelId: 'y', perWeek: 1 }];
    const mix = effectiveMix(rules, ['t1', 't2', 't3'], new Map([['t1', ['g', 'h']], ['t2', ['g']]]));
    expect(mix.get('t1')!.get('x')!.perWeek).toBe(7);
    expect([...mix.get('t2')!.keys()]).toEqual(['y']);
    expect(mix.has('t3')).toBe(false);
  });

  it('validates schemas strictly', () => {
    expect(FIELD_CREATE.safeParse({ name: 'A', kind: 'choice', options: ['x', 'x'], confirmation: 'c' }).success).toBe(false);
    expect(FIELD_CREATE.safeParse({ name: 'A\u0000', kind: 'text', confirmation: 'c' }).success).toBe(false);
    expect(MIX_SAVE.safeParse({ scope: { targetId: 't', groupId: 'g' }, rules: [], confirmation: 'c' }).success).toBe(false);
    expect(MIX_SAVE.safeParse({ scope: { targetId: 't' }, rules: [{ labelId: 'a', perWeek: 1 }, { labelId: 'a', perWeek: 2 }], confirmation: 'c' }).success).toBe(false);
    expect(slotKey({ dayOfWeek: 1, hour: 2, minute: 3 })).toBe('1-2-3');
  });
});

describe('collaboration MCP request and result ceilings', () => {
  const actor = { userId: 'u', workspaceId: 'w' };
  it('refuses oversized complete read results instead of returning a shortened directory', async () => {
    h.ops.readFields!.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    await expect(executeCollaborationTool(actor, 'list_custom_fields', {}, 1)).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('refuses an oversized mutation before dispatching it', async () => {
    await expect(executeCollaborationTool(actor, 'assign_post_labels', { postIds: ['a', 'b'] }, 1)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.ops.assign).not.toHaveBeenCalled();
  });
  it('rejects unknown directory arguments instead of ignoring them', async () => {
    await expect(executeCollaborationTool(actor, 'list_custom_fields', { workspaceId: 'foreign' }, 10)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.ops.readFields).not.toHaveBeenCalled();
  });
});

describe('post organization label discovery parity', () => {
  it('exposes association reads and pages label choices at the current MCP ceiling', async () => {
    h.ops.labelChoices!.mockResolvedValueOnce({ labels: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    expect(await executeCollaborationTool({ userId: 'u', workspaceId: 'w' }, 'list_post_label_choices', { page: 2 }, 2)).toEqual({ labels: [{ id: 'c' }], page: 2, pageSize: 2, hasMore: false, total: 3 });
    await executeCollaborationTool({ userId: 'u', workspaceId: 'w' }, 'get_post_labels', { postId: 'p' }, 2);
    expect(h.ops.readLabels).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' }, 'p');
  });
});
