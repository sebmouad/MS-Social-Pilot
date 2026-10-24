import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpViewer } from '@/server/mcp/types';
import { OperationError } from '@/lib/operation-error';

const m = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn(), viewer: vi.fn(), audit: vi.fn() }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({ createPost: m.create, updatePost: m.update, deletePost: m.remove }));
vi.mock('@/server/data', () => ({ prisma: {} }));
vi.mock('@/server/context', () => ({ requireViewer: m.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://app.example' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/mcp/kit', async original => ({ ...await original<typeof import('@/server/mcp/kit')>(), auditedReceipt: m.audit }));
import { PUBLISHING_MCP } from '@/modules/publishing/mcp';
import { POST } from '@/app/api/publishing/posts/route';
import { PATCH, DELETE } from '@/app/api/publishing/posts/[id]/route';
import { createPostForApi } from '@/modules/publishing/server/api';
import { createPublishingPost, updatePublishingPost, deletePublishingPost } from '@/modules/publishing/server/api-writes';

const actor = { userId: 'u', workspaceId: 'w', allowedTargetIds: ['channel'] };
const viewer = { userId: 'u', workspaceId: 'w', permissions: { pageScope: { all: false, ids: ['channel'] } } } as unknown as McpViewer;
const group = PUBLISHING_MCP.find(group => group.features.create_draft)!;
const context = { params: Promise.resolve({ id: 'p' }) };
const request = (body: object, method = 'POST') => new Request('https://app.example/api/publishing/posts', {
  method, headers: { origin: 'https://app.example' }, body: JSON.stringify(body),
});
const call = (name: string, args: Record<string, unknown>) => group.execute(viewer, name, args, 100);

beforeEach(() => {
  vi.resetAllMocks();
  m.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w', permissions: viewer.permissions, membership: { workspace: { timezone: 'UTC' } } });
  m.create.mockResolvedValue({ id: 'p' });
  m.remove.mockResolvedValue({ postId: 'p', state: 'needs_review', localConfirmed: false, operations: [] });
  m.audit.mockImplementation((_viewer, _name, _detail, result) => result);
});

describe('Publishing legacy draft aliases share REST consent, validation and lifecycle', () => {
  it('creates through the same scoped, Root-validated lifecycle as REST and create_post', async () => {
    const input = { message: 'Example draft', confirmation: 'CREATE POST' };
    const draft = await call('create_draft', input);
    const canonical = await call('create_post', { ...input, targetIds: [] });
    const rest = await POST(request({ ...input, targetIds: [] }));
    expect(rest.status).toBe(201);
    expect(await rest.json()).toEqual(draft);
    expect(canonical).toEqual(draft);
    expect(m.create).toHaveBeenCalledTimes(3);
    for (const args of m.create.mock.calls) expect(args).toEqual([actor, expect.objectContaining({ message: input.message, targetIds: [], media: [] })]);
    expect(m.audit).toHaveBeenCalledWith(viewer, 'create_draft', { postId: 'p' }, draft);
  });

  it('replaces content and explicit destinations identically through both tools and REST', async () => {
    const input = { message: '', targetIds: ['channel'], media: [{ kind: 'image', url: 'https://example.test/p.jpg', altText: 'Example' }], firstComment: 'More', confirmation: 'UPDATE POST p' };
    const alias = await call('update_draft', { ...input, postId: 'p' });
    expect(await call('update_post', { ...input, postId: 'p' })).toEqual(alias);
    const response = await PATCH(request(input, 'PATCH'), context);
    expect(await response.json()).toEqual(alias);
    expect(m.update).toHaveBeenCalledTimes(3);
    for (const args of m.update.mock.calls) expect(args).toEqual([actor, expect.objectContaining({ postId: 'p', message: '', targetIds: ['channel'], media: input.media, firstComment: 'More' })]);
  });

  it('returns the same durable local deletion receipt, including uncertain results', async () => {
    const input = { confirmation: 'DELETE POST p LOCAL' };
    const alias = await call('delete_draft', { ...input, postId: 'p' });
    expect(await call('delete_post', { ...input, postId: 'p', deleteRemote: false })).toEqual(alias);
    expect(await (await DELETE(request({ ...input, deleteRemote: false }, 'DELETE'), context)).json()).toEqual(alias);
    expect(alias).toMatchObject({ state: 'needs_review', localConfirmed: false });
    expect(m.remove).toHaveBeenCalledTimes(3);
    for (const args of m.remove.mock.calls) expect(args).toEqual([actor, 'p', false]);
  });

  it('refuses an internal API create caller that omits consent', async () => {
    await expect(createPostForApi(actor, { message: 'Example', targetIds: [] })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(m.create).not.toHaveBeenCalled();
  });

  it.each([
    ['create_draft', { message: 'Example', confirmation: 'CREATE DRAFT' }, () => createPublishingPost(actor, { message: 'Example', targetIds: [], confirmation: 'CREATE DRAFT' })],
    ['update_draft', { postId: 'p', message: 'Example', targetIds: [], confirmation: 'UPDATE DRAFT p' }, () => updatePublishingPost(actor, 'p', { message: 'Example', targetIds: [], confirmation: 'UPDATE DRAFT p' })],
    ['delete_draft', { postId: 'p', confirmation: 'DELETE DRAFT p' }, () => deletePublishingPost(actor, 'p', { deleteRemote: false, confirmation: 'DELETE DRAFT p' })],
  ] as const)('rejects obsolete consent in %s and direct service calls', async (name, args, direct) => {
    await expect(call(name, args)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(direct()).rejects.toMatchObject({ code: 'invalid_request' });
    expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });

  it.each([
    { targetIds: undefined }, { targetIds: ['channel', 1] }, { message: 42 },
    { media: [{ kind: 'image', url: 'https://example.test/p.jpg' }], imageUrl: 'https://example.test/other.jpg' },
    { media: null },
    { media: [{ kind: 'audio', url: 'https://example.test/p.mp3' }] },
  ])('rejects the same malformed replacement in MCP and REST: %j', async invalid => {
    const input = { postId: 'p', message: 'Example', targetIds: ['channel'], confirmation: 'UPDATE POST p', ...invalid };
    await expect(call('update_draft', input)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(call('update_post', input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect((await PATCH(request(input, 'PATCH'), context)).status).toBe(400);
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });

  it.each(['forbidden', 'not_found', 'conflict', 'invalid_request'] as const)('preserves lifecycle %s failures without a successful MCP receipt', async code => {
    m.update.mockRejectedValue(new OperationError(code, 'Review this post.'));
    const input = { postId: 'p', message: 'Example', targetIds: [], confirmation: 'UPDATE POST p' };
    await expect(call('update_draft', input)).rejects.toMatchObject({ code });
    const response = await PATCH(request(input, 'PATCH'), context);
    expect(await response.json()).toEqual({ code, error: 'Review this post.' });
    expect(m.audit).not.toHaveBeenCalled();
  });
});
