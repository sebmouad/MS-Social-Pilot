import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ service: vi.fn(), viewer: vi.fn() }));
vi.mock('@/modules/publishing/server/post-variants', () => ({ postVariants: h.service }));
vi.mock('@/server/context', () => ({ requireViewer: h.viewer }));
import { GET, POST } from '@/app/api/publishing/post-variants/route';
import { PUBLISHING_MCP } from '@/modules/publishing/mcp';
import type { McpViewer } from '@/server/mcp/types';

const listing = { postId: 'post-a', defaultMessage: 'Hello', workspaceLocale: 'en', variants: [], destinations: [] };
beforeEach(() => {
  vi.clearAllMocks();
  h.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w' });
  h.service.mockResolvedValue(listing);
});
it('serves the variant list on GET through the shared service', async () => {
  const response = await GET(new Request('https://example.test/api/publishing/post-variants?postId=post-a'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(listing);
  expect(h.service).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' }, { action: 'list', postId: 'post-a' });
});

it('rejects cross-origin writes and foreign query input before reading', async () => {
  const foreign = new Request('https://example.test/api/publishing/post-variants', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.test' }, body: '{}' });
  expect((await POST(foreign)).status).toBe(403);
  expect((await GET(new Request('https://example.test/api/publishing/post-variants?workspaceId=other'))).status).toBe(400);
  expect(h.service).not.toHaveBeenCalled();
});

it('exposes variant CRUD and destination locales over MCP with the same service', async () => {
  const group = PUBLISHING_MCP.find(g => g.id === 'publishing-variants')!;
  expect(group.writeTools).toEqual(['save_post_variant', 'delete_post_variant', 'set_destination_locale']);
  const viewer = { userId: 'u', workspaceId: 'w' } as unknown as McpViewer;
  expect(await group.execute(viewer, 'list_post_variants', { postId: 'post-a' }, 100)).toEqual(listing);
  h.service.mockResolvedValue({ ok: true });
  await group.execute(viewer, 'save_post_variant', { postId: 'post-a', locale: 'fr', message: 'Bonjour', confirmation: 'ADD VARIANT post-a fr' }, 100);
  expect(h.service).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u' }), { action: 'add', postId: 'post-a', locale: 'fr', message: 'Bonjour', confirmation: 'ADD VARIANT post-a fr' });
  await group.execute(viewer, 'set_destination_locale', { targetId: 'target-a', locale: null, confirmation: 'SET DESTINATION LOCALE target-a' }, 100);
  expect(h.service).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u' }), { action: 'destination-locale', targetId: 'target-a', locale: null, confirmation: 'SET DESTINATION LOCALE target-a' });
});
