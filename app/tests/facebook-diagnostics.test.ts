import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ native: vi.fn(), connection: vi.fn(), oauth: vi.fn(), engine: vi.fn(), identity: vi.fn(), permissions: vi.fn(), decrypt: vi.fn(), channels: vi.fn(), accounts: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { socialAccount: { findFirst: state.connection } } }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: state.decrypt }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookNativeSettings:state.native, configuredFacebookEngine: state.engine, configuredFacebookOAuth: state.oauth }));
import { facebookDiagnostics } from '../src/platforms/facebook/diagnostics';
import { FacebookApiError } from '../src/platforms/facebook/publishing';
const checks = async (id?: string) => { const list = await facebookDiagnostics.checks(id); return Object.fromEntries(list.map(check => [check.id, check.run])); };
beforeEach(() => {
  vi.clearAllMocks();
  state.native.mockResolvedValue({});
  state.connection.mockResolvedValue({ providerUserId: 'user-id', accessToken: 'encrypted-token', tokenExpiresAt: null, invalidatedAt: null });
  state.decrypt.mockReturnValue('plaintext-token');
  state.oauth.mockResolvedValue({ scopes: ['scope-a', 'scope-b'] });
  state.engine.mockResolvedValue({ getCurrentUser: state.identity, getGrantedPermissions: state.permissions, discoverPages: state.channels, discoverAdAccounts: state.accounts });
  state.identity.mockResolvedValue({ id: 'user-id', name: 'Private name' });
  state.permissions.mockResolvedValue(['scope-a', 'scope-b']);
  state.channels.mockResolvedValue([{ id: 'page', accessToken: 'private-page-token' }]); state.accounts.mockResolvedValue([{ id: 'ad-account' }]);
});
describe('Facebook-owned read-only connectivity diagnostics', () => {
  it('checks native policy locally without claiming native availability or exposing invalid values', async()=>{
    const run=await checks();
    expect(await run.native_configuration()).toMatchObject({status:'pass',code:'native_policy_valid'});
    expect((await run.native_configuration()).message).toContain('remain unavailable');
    state.native.mockRejectedValueOnce(new Error('secret endpoint token'));
    const result=await run.native_configuration();
    expect(result).toMatchObject({status:'fail',code:'native_policy_invalid'});
    expect(JSON.stringify(result)).not.toContain('secret endpoint token');
    expect(state.engine).not.toHaveBeenCalled();expect(state.decrypt).not.toHaveBeenCalled();
  });
  it('skips authenticated checks without selection; configuration presence is not remote proof', async () => {
    const run = await checks();
    expect(await run.connection_setup()).toMatchObject({ status: 'pass', code: 'connection_configured' });
    expect(await run.identity()).toMatchObject({ status: 'skipped', code: 'choose_connection' });
    expect(await run.grants()).toMatchObject({ status: 'skipped' });
    expect(await run.channels()).toMatchObject({ status: 'skipped' }); expect(await run.ad_accounts()).toMatchObject({ status: 'skipped' });
    expect(state.connection).not.toHaveBeenCalled(); expect(state.engine).not.toHaveBeenCalled();
  });
  it.each([null, { invalidatedAt: new Date(), tokenExpiresAt: null }, { invalidatedAt: null, tokenExpiresAt: new Date(0) }])('refuses missing, revoked or expired credentials without API calls', async connection => {
    state.connection.mockResolvedValue(connection); const run = await checks('source');
    expect((await run.identity()).status).toBe('fail'); expect((await run.grants()).status).toBe('fail');
    expect(state.engine).not.toHaveBeenCalled();
  });
  it('requires matching remote identity and verifies currently granted requested scopes', async () => {
    const run = await checks('source');
    expect(await run.identity()).toMatchObject({ status: 'pass', code: 'identity_verified' });
    expect(await run.grants()).toMatchObject({ status: 'pass', code: 'requested_grants_verified' });
    expect(state.identity).toHaveBeenCalledWith('plaintext-token');
    state.identity.mockResolvedValueOnce({ id: 'another-user' });
    expect(await run.identity()).toMatchObject({ status: 'fail', code: 'identity_mismatch' });
    state.permissions.mockResolvedValueOnce(['scope-a']);
    expect(await run.grants()).toMatchObject({ status: 'fail', code: 'grants_missing' });
  });
  it.each([new FacebookApiError('token=secret', 400, 190), new FacebookApiError('token=secret', 0), new FacebookApiError('token=secret', 403), new Error('token=secret')])('sanitizes invalid tokens, transport timeouts and provider rejections', async error => {
    state.identity.mockRejectedValue(error); state.permissions.mockRejectedValue(error);
    const run = await checks('source');
    for (const check of [run.identity, run.grants]) { const result = await check(); expect(result.status).toBe('fail'); expect(JSON.stringify(result)).not.toContain('token=secret'); }
  });
  it('checks bounded discovery without exposing resource details or saving selections', async () => {
    const run = await checks('source');
    expect(await run.channels()).toMatchObject({ status: 'pass', code: 'channel_discovery_read' });
    expect(await run.ad_accounts()).toMatchObject({ status: 'pass', code: 'ad_discovery_read' });
    state.channels.mockRejectedValueOnce(new Error('private-page-token'));
    const failure = await run.channels(); expect(failure.status).toBe('fail'); expect(JSON.stringify(failure)).not.toContain('private-page-token');
    state.accounts.mockResolvedValueOnce([]); expect((await run.ad_accounts()).message).toContain('0 ad account');
  });
  it('fails missing application configuration with safe guidance', async () => {
    state.oauth.mockRejectedValue(new Error('raw-app-secret'));
    const result = await (await checks()).connection_setup();
    expect(result).toMatchObject({ status: 'fail', code: 'connection_unconfigured' }); expect(JSON.stringify(result)).not.toContain('raw-app-secret');
  });
});
