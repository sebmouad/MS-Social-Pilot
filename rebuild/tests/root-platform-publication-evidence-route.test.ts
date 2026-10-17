import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: state.actor }));
vi.mock('../src/server/root/platform-publication-evidence', () => ({ readRootPlatformPublicationEvidence: state.read }));
import * as route from '../src/app/api/root/platform-publication-evidence/route';
import { OperationError } from '../src/lib/operation-error';
const request = (query = '') => new Request(`http://localhost:3200/api/root/platform-publication-evidence${query}`);
beforeEach(() => { vi.clearAllMocks(); state.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true }); state.read.mockResolvedValue({ providerId: 'platform', title: 'Evidence', columns: [], items: [], truncated: false }); });

describe('Root platform publication evidence HTTP boundary', () => {
  it('is GET-only, private, no-store and delegates validated filters to the shared service', async () => {
    expect(route.GET).toBeDefined(); expect('POST' in route).toBe(false);
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
});
