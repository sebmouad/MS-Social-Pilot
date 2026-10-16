import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn(), run: vi.fn(), operations: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: state.actor }));
vi.mock('../src/server/root/diagnostics', () => ({ listRootDiagnostics: state.list, runRootDiagnostics: state.run }));
vi.mock('../src/server/root/operations', () => ({ loadRootOperations: state.operations }));
import { GET, POST } from '../src/app/api/root/diagnostics/route';
import { GET as operations } from '../src/app/api/root/operations/route';
import { OperationError } from '../src/lib/operation-error';
const request = (body = {}, origin: string | null = 'http://localhost:3200') => new Request('http://localhost:3200/api/root/diagnostics', { method: 'POST', headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); state.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true }); state.list.mockResolvedValue({ history: [] }); state.run.mockResolvedValue({ id: 'receipt', auditRecorded: true }); state.operations.mockResolvedValue({ runs: [] }); });
describe('private diagnostics HTTP boundary', () => {
  it.each([null, { id: 'member', isInstanceOwner: false }])('refuses anonymous/members without any reads or probes', async actor => {
    state.actor.mockResolvedValue(actor);
    expect((await GET(new Request('http://localhost:3200/api/root/diagnostics'))).status).toBe(actor ? 403 : 401);
    expect((await POST(request())).status).toBe(actor ? 403 : 401);
    expect(state.list).not.toHaveBeenCalled(); expect(state.run).not.toHaveBeenCalled();
  });
  it.each([null, 'https://evil.test'])('requires same origin for audit-creating runs', async origin => {
    expect((await POST(request({}, origin))).status).toBe(403); expect(state.actor).not.toHaveBeenCalled(); expect(state.run).not.toHaveBeenCalled();
  });
  it('shares services, keeps no-store and rejects ambiguous filters', async () => {
    const response = await GET(new Request('http://localhost:3200/api/root/diagnostics?scope=platform:facebook'));
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(state.list).toHaveBeenCalledWith('root', 'platform:facebook');
    const input = { scope: 'shared', confirmation: 'RUN DIAGNOSTICS shared' };
    expect((await POST(request(input))).status).toBe(200); expect(state.run).toHaveBeenCalledWith('root', input);
    expect((await GET(new Request('http://localhost:3200/api/root/diagnostics?scope=shared&scope=shared'))).status).toBe(400);
    expect((await operations(new Request('http://localhost:3200/api/root/operations?moduleId=inbox'))).status).toBe(200); expect(state.operations).toHaveBeenCalledWith('root', 'inbox');
  });
  it('keeps deliberate failures and masks unknown data/provider errors', async () => {
    state.run.mockRejectedValueOnce(new OperationError('conflict', 'Wait for interval.'));
    expect(await (await POST(request())).json()).toEqual({ code: 'conflict', error: 'Wait for interval.' });
    state.run.mockRejectedValueOnce(new Error('token=secret')); state.operations.mockRejectedValueOnce(new Error('postgres://password'));
    for (const response of [await POST(request()), await operations(new Request('http://localhost:3200/api/root/operations'))]) { expect(response.status).toBe(502); expect(response.headers.get('cache-control')).toBe('no-store'); expect(JSON.stringify(await response.json())).not.toMatch(/token=secret|postgres:/); }
  });
});
