import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ person: vi.fn(), workspace: vi.fn(), cookies: vi.fn(), dispatch: vi.fn(), config: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: m.cookies }));
vi.mock('@/server/mcp/bearer', () => ({ authenticateBearerHeader: m.workspace }));
vi.mock('@/modules/settings/person-keys/service', () => ({ authenticatePersonBearer: m.person }));
vi.mock('@/server/mcp/server', () => ({ handleMcpMessage: m.dispatch }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
import { POST } from '@/app/api/mcp/route';
import { reset } from '@/server/rate-limit';
const identity = { scope: 'person', userId: 'u', personKeyId: 'pk', readFeature: 'agency/overview' };
const request = (suffix = '', authorization = `Bearer mcp_person_${'a'.repeat(43)}`) => new Request(`http://app.test/api/mcp${suffix}`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
beforeEach(() => { vi.clearAllMocks(); reset(); m.person.mockResolvedValue(identity); m.dispatch.mockResolvedValue(Response.json({ ok: true })); m.config.mockImplementation(async key => key === 'mcp.keys.requestsPerMinute' ? 1 : 1048576); });
it('dispatches a person credential and rate-limits it by key without loading workspace/cookies', async () => {
 expect((await POST(request())).status).toBe(200); expect(m.dispatch.mock.calls[0][0]).toEqual(identity);
 expect((await POST(request())).status).toBe(429); expect(m.workspace).not.toHaveBeenCalled(); expect(m.cookies).not.toHaveBeenCalled();
});
it.each(['?scope=workspace', '?scope=installation'])('refuses scope escalation %s without fallback', async suffix => {
 expect((await POST(request(suffix))).status).toBe(401); expect(m.person).not.toHaveBeenCalled(); expect(m.workspace).not.toHaveBeenCalled(); expect(m.cookies).not.toHaveBeenCalled();
});
it('never falls back from a revoked or invalid person credential', async () => {
 m.person.mockResolvedValue(null); expect((await POST(request())).status).toBe(401); expect(m.cookies).not.toHaveBeenCalled(); expect(m.workspace).not.toHaveBeenCalled();
});
it('keeps ordinary workspace credentials on the workspace authenticator', async () => {
 m.workspace.mockResolvedValue(null); expect((await POST(request('', `Bearer mcp_${'a'.repeat(43)}`))).status).toBe(401); expect(m.person).not.toHaveBeenCalled(); expect(m.workspace).toHaveBeenCalled();
});
