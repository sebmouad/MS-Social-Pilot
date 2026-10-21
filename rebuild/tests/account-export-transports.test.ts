import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpViewer } from '../src/server/mcp/types';
const m = vi.hoisted(() => ({ actor: vi.fn(), viewer: vi.fn(), export: vi.fn() }));
vi.mock('@/modules/settings/server/account-session', () => ({ accountSessionActor: m.actor }));
vi.mock('@/modules/settings/server/account-export', () => ({ exportAccountData: m.export }));
vi.mock('@/server/context', () => ({ requireViewer: m.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://example.test' }));
vi.mock('@/modules/settings/server/account', () => ({}));
vi.mock('@/modules/settings/server/account-security', () => ({}));
import { accountHttp } from '@/modules/settings/server/account-http';
import { ACCOUNT_EXPORT_MCP } from '@/modules/settings/server/account-export-mcp';
const actor = { userId: 'self', workspaceId: 'w1', sessionTokenHash: 'session-hash' };
const viewer = { userId: 'self', workspaceId: 'w1' } as McpViewer;
beforeEach(() => {
  vi.clearAllMocks();
  m.actor.mockResolvedValue(actor);
  m.viewer.mockResolvedValue({ user: { id: 'self' }, workspaceId: 'w1' });
  const content = '{"name":"Émilie"}';
  m.export.mockResolvedValue({ mimeType: 'application/json', content, bytes: Buffer.byteLength(content) });
});
describe('account export transport adapters (host registration pending)', () => {
  it('returns an uncached JSON attachment through the same service', async () => {
    const response = await accountHttp(new Request('https://example.test/api/settings/account/export'), 'export');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toBe('attachment');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toEqual({ name: 'Émilie' });
    expect(m.export).toHaveBeenCalledWith(actor);
  });
  it.each<Record<string, string>>([{ authorization: 'Bearer key' }, { 'x-api-key': 'key' }])('refuses restricted credentials before loading account authority: %j', async headers => {
    expect((await accountHttp(new Request('https://example.test/export', { headers }), 'export')).status).toBe(403);
    expect(m.export).not.toHaveBeenCalled(); expect(m.actor).not.toHaveBeenCalled();
  });
  it('refuses scope query parameters, wrong methods and masks private errors', async () => {
    expect((await accountHttp(new Request('https://example.test/export?userId=other'), 'export')).status).toBe(400);
    expect((await accountHttp(new Request('https://example.test/export', { method: 'POST' }), 'export')).status).toBe(400);
    expect(m.export).not.toHaveBeenCalled();
    m.export.mockRejectedValueOnce(new Error('secret database message'));
    const failed = await accountHttp(new Request('https://example.test/export'), 'export');
    expect(failed.status).toBe(502); expect(await failed.text()).not.toContain('secret database message');
  });
  it('executes MCP through the same session actor and service', async () => {
    expect(ACCOUNT_EXPORT_MCP.features.export_account_data).toBe('settings/account');
    await ACCOUNT_EXPORT_MCP.execute(viewer, 'export_account_data', {}, 1);
    expect(m.actor).toHaveBeenCalledWith('self', 'w1');
    expect(m.export).toHaveBeenCalledWith(actor, {});
    expect(ACCOUNT_EXPORT_MCP.tools[0].inputSchema.additionalProperties).toBe(false);
  });
  it('hides and refuses MCP key access, including direct executor invocation', async () => {
    const key = { ...viewer, apiKeyId: 'key' };
    expect((await ACCOUNT_EXPORT_MCP.available!(key))('export_account_data')).toBe(false);
    expect(() => ACCOUNT_EXPORT_MCP.beforeCall!(key, 'export_account_data', false)).toThrow();
    await expect(ACCOUNT_EXPORT_MCP.execute(key, 'export_account_data', {}, 1)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(ACCOUNT_EXPORT_MCP.execute(viewer, 'unknown', {}, 1)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(m.export).not.toHaveBeenCalled();
  });
});
