import { CONFIG_BY_KEY } from '@/lib/config/registry';
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => CONFIG_BY_KEY.get(key)?.defaultValue }));
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ credential: vi.fn(), overview: vi.fn(), clients: vi.fn() }));
vi.mock('@/modules/settings/person-keys/service', () => ({ assertPersonCredential: m.credential }));
vi.mock('./server/agency', () => ({ agencyOverview: m.overview, listAgencyClients: m.clients }));
import { handleMcpMessage } from '@/server/mcp/server';
import type { McpIdentity } from '@/server/mcp/types';
const person = { scope: 'person', userId: 'u', personKeyId: 'pk', readFeature: 'agency/overview' } satisfies McpIdentity;
const message = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) });
beforeEach(() => { vi.clearAllMocks(); m.credential.mockResolvedValue(undefined); m.overview.mockResolvedValue({ workspaces: [{ id: 'current' }] }); });
it('advertises only the overview tool and person resource', async () => {
 expect((await (await handleMcpMessage(person, message('tools/list'))).json()).result.tools.map((t: {name: string}) => t.name)).toEqual(['get_agency_overview']);
 expect((await (await handleMcpMessage(person, message('resources/list'))).json()).result.resources.map((r: {uri: string}) => r.uri)).toEqual(['msp://agency/overview']);
 const initialized = await (await handleMcpMessage(person, message('initialize'))).json();
 expect(initialized.result.instructions).toContain('Read-only person');
});
it.each(['create_draft', 'list_posts', 'list_agency_clients', 'get_root_config', 'set_root_config', 'issue_person_key', 'unknown'])('refuses %s before any domain call', async name => {
 const result = await (await handleMcpMessage(person, message('tools/call', { name, arguments: { confirmation: 'YES' } }))).json();
 expect(result.result.isError).toBe(true); expect(result.result.structuredContent.code).toBe('forbidden'); expect(m.overview).not.toHaveBeenCalled(); expect(m.clients).not.toHaveBeenCalled();
});
it.each(['msp://workspace', 'msp://root/config', 'msp://agency/clients', 'unknown'])('refuses resource %s', async uri => {
 expect((await (await handleMcpMessage(person, message('resources/read', { uri }))).json()).error).toBeDefined(); expect(m.overview).not.toHaveBeenCalled();
});
it('rechecks the key and calls the shared overview on every tool and resource read', async () => {
 const call = message('tools/call', { name: 'get_agency_overview', arguments: { q: 'Studio' } });
 expect((await (await handleMcpMessage(person, call)).json()).result.structuredContent.workspaces).toEqual([{ id: 'current' }]);
 expect(m.overview).toHaveBeenLastCalledWith({ userId: 'u' }, { q: 'Studio' });
 m.overview.mockResolvedValueOnce({ workspaces: [] });
 const resource = await (await handleMcpMessage(person, message('resources/read', { uri: 'msp://agency/overview' }))).json();
 expect(JSON.parse(resource.result.contents[0].text).workspaces).toEqual([]);
 expect(m.credential).toHaveBeenCalledTimes(2);
 m.credential.mockRejectedValueOnce(Object.assign(new Error('revoked'), { code: 'forbidden' }));
 expect((await (await handleMcpMessage(person, call)).json()).error).toBeDefined(); expect(m.overview).toHaveBeenCalledTimes(2);
});
it.each([null, [], 'oops', 1])('refuses malformed arguments %j', async args => {
 const result = await (await handleMcpMessage(person, message('tools/call', { name: 'get_agency_overview', arguments: args }))).json();
 expect(result.result.isError).toBe(true); expect(result.result.structuredContent.code).toBe('invalid_request');
});
it.each([{ jsonrpc: '1.0', id: 1, method: 'tools/list' }, { jsonrpc: '2.0', id: {}, method: 'tools/list' }, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: [] }])('refuses invalid envelopes before dispatch %j', async value => {
 expect((await (await handleMcpMessage(person, value)).json()).error.code).toBe(-32600); expect(m.credential).not.toHaveBeenCalled();
});
it('refuses unsupported methods without entering the domain service', async () => {
 expect((await (await handleMcpMessage(person, message('prompts/get'))).json()).error.code).toBe(-32601); expect(m.overview).not.toHaveBeenCalled();
});
