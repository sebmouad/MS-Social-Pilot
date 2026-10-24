import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationError } from '../src/lib/operation-error';
const state = vi.hoisted(() => ({ viewer: vi.fn(), select: vi.fn() }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async () => 250 }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/server/connection-mutations', () => ({ setConnectionSelections: state.select, disconnectSocialAccount: vi.fn(), previewSocialAccountDeletion: vi.fn() }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, run: () => Promise<unknown>) => run() }));
import { PATCH } from '../src/app/api/connections/route';
const request = () => new Request('https://example.test/api/connections', { method: 'PATCH', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'SET CONNECTION SELECTIONS 1', items: [{ kind: 'target', id: 'target-1', enabled: true }] }) });
beforeEach(() => { vi.resetAllMocks(); state.viewer.mockResolvedValue({ user: { id: 'owner' }, workspaceId: 'workspace' }); });
describe('connection HTTP failures', () => {
  it('returns the shared safe entitlement failure and avoids caching', async () => {
    state.select.mockRejectedValue(new OperationError('unavailable', 'This connection is unavailable in the current workspace.'));
    const response = await PATCH(request());
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ code: 'unavailable', error: 'This connection is unavailable in the current workspace.' });
  });
  it('never treats raw exception text as a safe product failure', async () => {
    state.select.mockRejectedValue(new Error('postgres://private-password@example.test unavailable in the current workspace'));
    const response = await PATCH(request());
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await response.json())).not.toContain('private-password');
  });
});
