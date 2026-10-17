import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), action: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: state.actor }));
vi.mock('../src/server/root/platform-publication-evidence', () => ({ readRootPlatformPublicationEvidence: state.read, runRootPlatformPublicationAction: state.action }));
import * as route from '../src/app/api/root/platform-publication-evidence/route';
import { OperationError } from '../src/lib/operation-error';
const request = (query = '') => new Request(`http://localhost:3200/api/root/platform-publication-evidence${query}`);
const postRequest = (body: unknown, origin = 'http://localhost:3200') => new Request('http://localhost:3200/api/root/platform-publication-evidence', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); state.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true }); state.read.mockResolvedValue({ providerId: 'platform', title: 'Evidence', columns: [], items: [], truncated: false }); state.action.mockResolvedValue({ ok: true, actionId: 'module_action', subjectId: 'row_1', operationId: 'receipt_1', state: 'confirmed', message: 'Receipt recorded.' }); });

describe('Root platform publication evidence HTTP boundary', () => {
  it('serves private no-store evidence and delegates validated filters to the shared service', async () => {
    expect(route.GET).toBeDefined(); expect(route.POST).toBeDefined();
    const response = await route.GET(request('?providerId=platform&operationId=op_1&resultCap=12'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.read).toHaveBeenCalledWith('root', { providerId: 'platform', operationId: 'op_1', resultCap: 12 });
  });
  it.each([null, { id: 'member', isInstanceOwner: false }])('denies anonymous and workspace members before reading evidence', async actor => {
    state.actor.mockResolvedValue(actor);
    const response = await route.GET(request('?providerId=platform'));
    expect(response.status).toBe(actor ? 403 : 401); expect(state.read).not.toHaveBeenCalled();
  });
  it.each(['?providerId=platform&providerId=platform', '?providerId=platform&operationId=op%20x', '?providerId=platform&unknown=1', '?providerId=platform&resultCap=1001', '?operationId=op_1'])('rejects ambiguous or malformed queries: %s', async query => {
    expect((await route.GET(request(query))).status).toBe(400); expect(state.read).not.toHaveBeenCalled();
  });
  it('preserves safe service errors and masks raw storage/provider messages', async () => {
    state.read.mockRejectedValueOnce(new OperationError('not_found', 'This operation is unavailable.'));
    expect(await (await route.GET(request('?providerId=platform&operationId=op_1'))).json()).toEqual({ code: 'not_found', error: 'This operation is unavailable.' });
    state.read.mockRejectedValueOnce(new Error('postgres://private-password'));
    const response = await route.GET(request('?providerId=platform'));
    expect(response.status).toBe(502); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await response.json())).not.toContain('private-password');
  });
  it('requires same-origin Root access and dispatches the generic action payload', async () => {
    const body = { providerId: 'platform', actionId: 'module_action', subjectId: 'row_1', confirmation: 'MODULE CONFIRM', acknowledged: true };
    const csrf = await route.POST(postRequest(body, 'https://attacker.example'));
    expect(csrf.status).toBe(403); expect(state.actor).not.toHaveBeenCalled(); expect(state.action).not.toHaveBeenCalled();
    const response = await route.POST(postRequest(body));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.action).toHaveBeenCalledWith('root', body);
  });
  it('denies non-root callers and masks failed or invalid receipts', async () => {
    state.actor.mockResolvedValue({ id: 'member', isInstanceOwner: false });
    expect((await route.POST(postRequest({}))).status).toBe(403); expect(state.action).not.toHaveBeenCalled();
    state.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true });
    state.action.mockRejectedValueOnce(new Error('secret=raw'));
    const response = await route.POST(postRequest({ providerId: 'platform', actionId: 'module_action', subjectId: 'row_1', confirmation: 'x', acknowledged: true }));
    expect(response.status).toBe(502); expect(JSON.stringify(await response.json())).not.toContain('secret=raw');
  });
});
