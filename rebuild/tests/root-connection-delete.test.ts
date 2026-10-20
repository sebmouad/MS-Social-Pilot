import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  findUnique: vi.fn(), assertRoot: vi.fn(), disconnect: vi.fn(), preview: vi.fn(), tx: { user: { findUnique: vi.fn() } },
}));
vi.mock('../src/server/data', () => ({ prisma: { socialAccount: { findUnique: h.findUnique } } }));
vi.mock('../src/server/root/legacy/authz', () => ({ assertRootActor: h.assertRoot, invalid: (m: string) => new Error(m), redact: (v: unknown) => v }));
vi.mock('../src/server/root/legacy/policy', () => ({ legacySetting: vi.fn(), rootResultLimit: vi.fn() }));
vi.mock('../src/server/connection-mutations', () => ({ disconnectSocialAccount: h.disconnect, previewSocialAccountDeletionAsRoot: h.preview }));
import { disconnectRootConnection, previewRootConnectionDeletion, rootDisconnectConfirmation, rootDisconnectDeleteConfirmation } from '../src/server/root/legacy/connections';

const counts = { channels: 1, adAccounts: 0, postTargets: 2, orphanPosts: 1, comments: 3, conversations: 1, conversationMessages: 4, pageInsights: 5, adInsights: 0, scheduledRemote: 0 };
beforeEach(() => {
  vi.clearAllMocks();
  h.findUnique.mockResolvedValue({ workspaceId: 'ws1' });
  h.disconnect.mockImplementation(async (_actor, _id, mode) => ({ mode, deleted: counts, stillScheduled: 0 }));
  h.preview.mockResolvedValue({ workspaceId: 'ws1', counts });
});

describe('Root disconnect with data deletion', () => {
  it('keeps retain as the default and requires its own phrase', async () => {
    await disconnectRootConnection('root', 'sa1', rootDisconnectConfirmation('sa1'));
    expect(h.disconnect).toHaveBeenCalledWith({ userId: 'root', workspaceId: 'ws1' }, 'sa1', 'retain', undefined, expect.any(Function));
    await expect(disconnectRootConnection('root', 'sa1', rootDisconnectDeleteConfirmation('sa1'))).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('deletes only with the dedicated phrase and reports that nothing was revoked at the platform', async () => {
    await expect(disconnectRootConnection('root', 'sa1', rootDisconnectConfirmation('sa1'), 'delete')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(disconnectRootConnection('root', 'sa1', 'DELETE CONNECTION DATA other', 'delete')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.disconnect).not.toHaveBeenCalled();
    const result = await disconnectRootConnection('root', 'sa1', rootDisconnectDeleteConfirmation('sa1'), 'delete');
    expect(h.disconnect).toHaveBeenCalledWith({ userId: 'root', workspaceId: 'ws1' }, 'sa1', 'delete', 'DELETE', expect.any(Function));
    expect(result).toMatchObject({ mode: 'delete', providerRevoked: false, workspaceId: 'ws1' });
  });

  it('checks current installation-owner status inside the transaction', async () => {
    await disconnectRootConnection('root', 'sa1', rootDisconnectDeleteConfirmation('sa1'), 'delete');
    const authorize = h.disconnect.mock.calls[0]![4] as (tx: typeof h.tx) => Promise<void>;
    h.tx.user.findUnique.mockResolvedValueOnce({ isInstanceOwner: false, disabledAt: null });
    await expect(authorize(h.tx)).rejects.toMatchObject({ code: 'forbidden' });
    h.tx.user.findUnique.mockResolvedValueOnce({ isInstanceOwner: true, disabledAt: new Date() });
    await expect(authorize(h.tx)).rejects.toMatchObject({ code: 'forbidden' });
    h.tx.user.findUnique.mockResolvedValueOnce({ isInstanceOwner: true, disabledAt: null });
    await expect(authorize(h.tx)).resolves.toBeUndefined();
  });

  it('refuses unknown modes and missing connections', async () => {
    await expect(disconnectRootConnection('root', 'sa1', rootDisconnectConfirmation('sa1'), 'purge' as never)).rejects.toMatchObject({ code: 'invalid_request' });
    h.findUnique.mockResolvedValueOnce(null);
    await expect(disconnectRootConnection('root', 'sa1', rootDisconnectDeleteConfirmation('sa1'), 'delete')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('previews counts for Root only, without changing anything', async () => {
    expect(await previewRootConnectionDeletion('root', 'sa1')).toEqual({ socialAccountId: 'sa1', workspaceId: 'ws1', counts, providerRevoked: false });
    expect(h.assertRoot).toHaveBeenCalledWith(expect.anything(), 'root');
    h.assertRoot.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'forbidden' }));
    await expect(previewRootConnectionDeletion('other', 'sa1')).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(h.disconnect).not.toHaveBeenCalled();
  });
});
