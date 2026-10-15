import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret } from '../src/server/secret-crypto';
import { createFacebookOAuthState, openFacebookOAuthState } from '../src/server/connection-oauth-state';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { $transaction: mocks.transaction } }));

const originalKey = process.env.ENCRYPTION_KEY;
const validKey = Buffer.alloc(32, 9).toString('base64');

afterEach(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
  vi.clearAllMocks();
});

beforeEach(() => { process.env.ENCRYPTION_KEY = validKey; });

describe('Meta OAuth state', () => {
  it('seals state to the initiating user, workspace, scopes, and configured expiry', () => {
    const now = 1_800_000_000_000;
    const started = createFacebookOAuthState('user-1', 'workspace-1', ['pages_show_list', 'ads_read'], 300, now);
    expect(started.cookieValue).not.toContain(started.state);
    expect(openFacebookOAuthState(started.cookieValue, started.state, 'user-1', 'workspace-1', now + 299_999)).toEqual({
      state: started.state, userId: 'user-1', workspaceId: 'workspace-1', expiresAt: now + 300_000,
      scopes: ['pages_show_list', 'ads_read'],
    });
    expect(openFacebookOAuthState(started.cookieValue, started.state, 'user-2', 'workspace-1', now)).toBeNull();
    expect(openFacebookOAuthState(started.cookieValue, started.state, 'user-1', 'workspace-2', now)).toBeNull();
    expect(openFacebookOAuthState(started.cookieValue, `${started.state}x`, 'user-1', 'workspace-1', now)).toBeNull();
    expect(openFacebookOAuthState(started.cookieValue, started.state, 'user-1', 'workspace-1', now + 300_000)).toBeNull();
  });
});

describe('Meta discovery persistence', () => {
  it('encrypts user and Page tokens and creates all newly discovered records disabled', async () => {
    const tx = {
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'owner' }) },
      socialAccount: { upsert: vi.fn().mockResolvedValue({ id: 'source-1' }) },
      target: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
      adAccount: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
      $executeRaw: vi.fn(),
    };
    mocks.transaction.mockImplementation(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
    const { persistFacebookDiscovery } = await import('../src/server/platforms/facebook-discovery');

    const result = await persistFacebookDiscovery({ userId: 'user-1', workspaceId: 'workspace-1' }, {
      user: { id: 'meta-user', name: 'Meta User', pictureUrl: 'https://example.test/profile.png' },
      accessToken: 'long-lived-user-token', expiresAt: new Date('2027-01-01T00:00:00Z'), scopes: ['pages_show_list', 'ads_read'],
      pages: [{ id: 'page-1', name: 'Page One', category: 'News', accessToken: 'page-token' }],
      adAccounts: [{ id: 'act_123', name: 'Ads One', currency: 'USD', status: 1 }],
    });

    const accountCreate = tx.socialAccount.upsert.mock.calls[0]![0].create;
    const pageCreate = tx.target.create.mock.calls[0]![0].data;
    const adsCreate = tx.adAccount.create.mock.calls[0]![0].data;
    expect(decryptSecret(accountCreate.accessToken)).toBe('long-lived-user-token');
    expect(decryptSecret(pageCreate.accessToken)).toBe('page-token');
    expect(accountCreate.accessToken).not.toContain('long-lived-user-token');
    expect(pageCreate.accessToken).not.toContain('page-token');
    expect(pageCreate.enabled).toBe(false);
    expect(adsCreate.enabled).toBe(false);
    expect(result).toEqual({ pages: 1, adAccounts: 1, skippedPages: 0, skippedAdAccounts: 0 });
    expect(JSON.stringify(result)).not.toMatch(/token/i);
  });

  it('rechecks owner/admin membership in the persistence transaction', async () => {
    const tx = { membership: { findUnique: vi.fn().mockResolvedValue({ role: 'editor' }) } };
    mocks.transaction.mockImplementation(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
    const { persistFacebookDiscovery } = await import('../src/server/platforms/facebook-discovery');
    await expect(persistFacebookDiscovery({ userId: 'user-1', workspaceId: 'workspace-1' }, {
      user: { id: 'meta-user', name: 'Meta User', pictureUrl: null }, accessToken: 'secret', expiresAt: null,
      scopes: [], pages: [], adAccounts: [],
    })).rejects.toThrow(/owners and admins/);
  });
});
