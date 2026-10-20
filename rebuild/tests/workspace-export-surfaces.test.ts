import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ viewer: vi.fn(), list: vi.fn(), request: vi.fn(), download: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: m.viewer }));
vi.mock('../src/modules/settings/server/exports', () => ({ listWorkspaceExports: m.list, requestWorkspaceExport: m.request, downloadWorkspaceExport: m.download }));
import { GET, POST } from '../src/app/api/settings/data/exports/route';
import { GET as download } from '../src/app/api/settings/data/exports/[id]/route';
import { WORKSPACE_EXPORT_MCP as group } from '../src/modules/settings/export-mcp';
import type { McpViewer } from '../src/server/mcp/types';
const viewer = { userId: 'u', workspaceId: 'w', apiKeyId: 'key' } as McpViewer;
beforeEach(() => { vi.clearAllMocks(); m.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w' }); m.list.mockResolvedValue([]); m.request.mockResolvedValue({ id: 'job' }); m.download.mockResolvedValue({ id: 'job', content: Buffer.from('ZIP') }); });
it('lists no-store jobs scoped to the current workspace', async () => {
  const r = await GET(); expect(r.headers.get('cache-control')).toBe('no-store'); expect(await r.json()).toEqual({ jobs: [] }); expect(m.list).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' });
});
it('blocks cross-origin and malformed requests before job creation', async () => {
  const request = (origin: string, body: string) => new Request('https://app.test/api/settings/data/exports', { method: 'POST', headers: { origin }, body });
  expect((await POST(request('https://other.test', '{}'))).status).toBe(403); expect((await POST(request('https://app.test', '{'))).status).toBe(400); expect(m.request).not.toHaveBeenCalled();
  expect((await POST(request('https://app.test', JSON.stringify({ confirmation: 'REQUEST WORKSPACE EXPORT w' })))).status).toBe(202); expect(m.viewer).toHaveBeenCalledWith({ feature: 'settings/data', write: true });
});
it('rechecks HTTP authority and delegates download without leaking unexpected errors', async () => {
  const run = () => download(new Request('https://app.test'), { params: Promise.resolve({ id: 'job' }) });
  const r = await run(); expect(r.headers.get('content-type')).toBe('application/zip'); expect(await r.text()).toBe('ZIP'); expect(m.download).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' }, 'job');
  m.download.mockRejectedValueOnce(new Error('private path')); expect(JSON.stringify(await (await run()).json())).not.toContain('private path');
});
it('declares manager-only workspace scope and exact confirmed self-locked writes', async () => {
  expect(group.scope.workspaceTools).toContain('download_workspace_export'); expect(group.selfLockedWrites).toEqual(['request_workspace_export']); expect(group.resources?.[0]).toMatchObject({ managerOnly: true, guardedRead: true }); expect(group.managers?.[0]).toMatchObject({ inExecutor: true, beforeArguments: true });
  await expect(group.execute(viewer, 'request_workspace_export', { confirmation: 'REQUEST WORKSPACE EXPORT other' }, 100)).rejects.toMatchObject({ code: 'invalid_request' }); expect(m.request).not.toHaveBeenCalled();
  await group.execute(viewer, 'request_workspace_export', { confirmation: 'REQUEST WORKSPACE EXPORT w' }, 100); expect(m.request).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w', apiKeyId: 'key' }, 'REQUEST WORKSPACE EXPORT w');
});
it('uses the shared download service for MCP content and rejects extra arguments', async () => {
  expect(await group.execute(viewer, 'download_workspace_export', { id: 'job' }, 100)).toEqual({ id: 'job', mimeType: 'application/zip', contentBase64: Buffer.from('ZIP').toString('base64') });
  await expect(group.execute(viewer, 'download_workspace_export', { id: 'job', workspaceId: 'other' }, 100)).rejects.toMatchObject({ code: 'invalid_request' });
});
