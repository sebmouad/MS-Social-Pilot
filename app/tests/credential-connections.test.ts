import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  config: vi.fn(), session: vi.fn(), membership: vi.fn(), perms: vi.fn(), entitlements: vi.fn(), flow: vi.fn(), persist: vi.fn(), tx: vi.fn(), audit: vi.fn(), connect: vi.fn(), form: vi.fn(),
}));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config, runtimeSecret: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { membership: { findUnique: m.membership }, $transaction: m.tx }, getSessionByTokenHash: m.session }));
vi.mock('@/server/auth', () => ({ isUsableSession: () => true }));
vi.mock('@/server/account-settings', () => ({ auditAccountMutation: m.audit }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: m.entitlements, canUseFeature: () => true, hasPlatformCapability: (e: { platforms?: string[] }, id: string) => e.platforms?.includes(id) === true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: m.perms }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/platforms/registry', () => ({ connectionFlow: m.flow }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, run: () => unknown) => run(), assertWorkspaceNotPurging: async () => undefined }));
vi.mock('@/server/platforms/token-connection', () => ({ persistTokenConnection: m.persist }));
vi.mock('@/server/connection-mutations', () => ({ auditConnectionEvent: vi.fn() }));

import { createBlueskyAdapter, decodeBlueskyCredential, encodeBlueskyCredential } from '@/platforms/bluesky/adapter';
import { createTelegramAdapter, encodeTelegramCredential } from '@/platforms/telegram/adapter';
import { POLICY_DEFAULTS as BLUESKY } from '@/platforms/bluesky/config';
import { POLICY_DEFAULTS as TELEGRAM } from '@/platforms/telegram/config';
import { blueskyModule } from '@/platforms/bluesky/module';
import { telegramModule } from '@/platforms/telegram/module';
import { PLATFORM_CONFIG, PLATFORM_MODULES } from '@/platforms';
import { connectWithCredentials, readConnectionCredentialForm, connectionCredentialsConfirmation } from '@/modules/settings/server/connection-credentials';

const did = 'did:plc:abc123';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const actor = { userId: 'u1', workspaceId: 'w1', sessionTokenHash: 'hash' };

describe('Bluesky and Telegram installed (G3)', () => {
  it('are installed modules with only connection, discovery and publishing, off by default, with their Root keys', () => {
    for (const module of [blueskyModule, telegramModule]) {
      expect(PLATFORM_MODULES.some(installed => installed.id === module.id)).toBe(true);
      expect(Object.entries(module.capabilities).filter(([, value]) => value === 'supported').map(([key]) => key)).toEqual(['connection', 'discovery', 'publishing']);
      const entries = PLATFORM_CONFIG.filter(entry => entry.owner.id === module.id);
      expect(entries.find(entry => entry.key === module.enabledKey)?.defaultValue).toBe(false);
      for (const entry of entries) expect(entry.schema.safeParse(entry.defaultValue).success).toBe(true);
    }
  });

  it('Bluesky publishes text through a fresh session and holds an unconfirmed write as uncertain', async () => {
    const calls: string[] = [];
    const ok = vi.fn(async (input: RequestInfo | URL) => { const url = String(input); calls.push(url); return url.endsWith('createSession') ? json({ accessJwt: 'jwt', did, handle: 'me.bsky.social' }) : json({ uri: `at://${did}/app.bsky.feed.post/1`, cid: 'cid' }); });
    const adapter = createBlueskyAdapter(BLUESKY, { fetch: ok as unknown as typeof fetch });
    const request = { credential: { accessToken: encodeBlueskyCredential('me.bsky.social', 'abcd-efgh-ijkl-mnop') }, target: { id: 't', name: 'n', kind: 'bluesky' }, text: 'Hello', link: 'https://example.test' };
    expect(await adapter.publish!(request)).toMatchObject({ state: 'published', remoteId: `at://${did}/app.bsky.feed.post/1` });
    expect(calls).toHaveLength(2);
    const failing = createBlueskyAdapter(BLUESKY, { fetch: (async (input: RequestInfo | URL) => String(input).endsWith('createSession') ? json({ accessJwt: 'jwt', did, handle: 'h' }) : json({}, 500)) as unknown as typeof fetch });
    const failure = await failing.publish!(request).catch(error => error);
    expect(failing.classifyPublishingFailure!(failure)).toBe('uncertain');
  });

  it('Bluesky refuses media, schedules and wrong credentials before any request', async () => {
    const never = vi.fn();
    const adapter = createBlueskyAdapter(BLUESKY, { fetch: never as unknown as typeof fetch });
    const base = { credential: { accessToken: encodeBlueskyCredential('h', 'abcd-efgh-ijkl-mnop') }, target: { id: 't', name: 'n', kind: 'bluesky' }, text: 'x' };
    await expect(adapter.publish!({ ...base, media: [{ kind: 'image', url: 'https://x' }] })).rejects.toMatchObject({ outcome: 'rejected' });
    await expect(adapter.publish!({ ...base, scheduledAt: new Date() })).rejects.toMatchObject({ outcome: 'rejected' });
    await expect(adapter.publish!({ ...base, credential: { accessToken: 'garbage' } })).rejects.toMatchObject({ outcome: 'rejected' });
    expect(never).not.toHaveBeenCalled();
    expect(decodeBlueskyCredential('garbage')).toBeNull();
    expect(adapter.canUseCredential!({ accessToken: 'garbage' }, 'publishing')).toBe(false);
  });

  it('Telegram posts text to the stored channel and never resends an unconfirmed message', async () => {
    const token = '123456789:' + 'A'.repeat(35);
    const send = vi.fn(async () => json({ ok: true, result: { message_id: 7, chat: { id: -1001234567, type: 'channel' } } }));
    const adapter = createTelegramAdapter(TELEGRAM, { fetch: send as unknown as typeof fetch });
    const request = { credential: { accessToken: encodeTelegramCredential(token, '@mychannel') }, target: { id: 't', name: 'n', kind: 'telegram' }, text: 'Hello' };
    expect(await adapter.publish!(request)).toMatchObject({ state: 'published', remoteId: '-1001234567:7' });
    const failing = createTelegramAdapter(TELEGRAM, { fetch: (async () => json({ ok: false }, 500)) as unknown as typeof fetch });
    const failure = await failing.publish!(request).catch(error => error);
    expect(failing.classifyPublishingFailure!(failure)).toBe('uncertain');
    await expect(adapter.publish!({ ...request, text: 'x'.repeat(5000) })).rejects.toMatchObject({ outcome: 'rejected' });
  });
});

describe('shared credential connection service (G3)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.session.mockResolvedValue({});
    m.membership.mockResolvedValue({ role: 'owner' });
    m.perms.mockResolvedValue({});
    m.entitlements.mockResolvedValue({ workspaceId: 'w1', platforms: ['bluesky'] });
    m.tx.mockImplementation(async (run: (tx: unknown) => unknown) => run({}));
    m.form.mockResolvedValue({ title: 'T', intro: 'I', submit: 'S', fields: [{ key: 'identifier', label: 'L', secret: false, maxLength: 50 }, { key: 'appPassword', label: 'P', secret: true, maxLength: 50 }] });
    m.connect.mockResolvedValue({ providerUserId: did, name: 'me', pictureUrl: null, accessToken: 'enc', refreshToken: null, accessExpiresAt: null, grantExpiresAt: null, scopes: ['x'], destinations: [] });
    m.flow.mockResolvedValue({ isReady: async () => true, credentials: { form: m.form, connect: m.connect } });
    m.persist.mockResolvedValue({ saved: 1, skipped: 0 });
  });
  const input = { platform: 'bluesky', fields: { identifier: 'me', appPassword: 'abcd' }, confirmation: connectionCredentialsConfirmation('bluesky') };

  it('verifies, persists encrypted and audits without returning the secret', async () => {
    const result = await connectWithCredentials(actor, input);
    expect(result).toEqual({ connected: true, platform: 'bluesky', channels: 1, skipped: 0 });
    expect(JSON.stringify(result)).not.toContain('abcd');
    expect(m.persist).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, 'bluesky', expect.objectContaining({ providerUserId: did }));
    expect(m.audit).toHaveBeenCalled();
  });

  it('requires the exact confirmation, a browser session and complete known fields', async () => {
    await expect(connectWithCredentials(actor, { ...input, confirmation: 'yes' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(connectWithCredentials({ ...actor, apiKeyId: 'k' }, input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(connectWithCredentials(actor, { ...input, fields: { identifier: 'me' } })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(connectWithCredentials(actor, { ...input, fields: { ...input.fields, extra: 'x' } })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(m.connect).not.toHaveBeenCalled();
  });

  it('denies members without owner/admin role and platforms the workspace is not entitled to', async () => {
    m.membership.mockResolvedValue({ role: 'contributor' });
    await expect(connectWithCredentials(actor, input)).rejects.toMatchObject({ code: 'forbidden' });
    m.membership.mockResolvedValue({ role: 'admin' });
    m.entitlements.mockResolvedValue({ workspaceId: 'w1', platforms: [] });
    await expect(connectWithCredentials(actor, input)).rejects.toMatchObject({ code: 'unavailable' });
    m.entitlements.mockResolvedValue({ workspaceId: 'other-workspace', platforms: ['bluesky'] });
    await expect(connectWithCredentials(actor, input)).rejects.toMatchObject({ code: 'forbidden' });
    expect(m.persist).not.toHaveBeenCalled();
  });

  it('reports a provider-verification failure without storing anything', async () => {
    m.connect.mockRejectedValue(new Error('provider said no'));
    await expect(connectWithCredentials(actor, input)).rejects.toMatchObject({ code: 'upstream_failure' });
    expect(m.persist).not.toHaveBeenCalled();
  });

  it('serves the module-worded form only to authorized managers', async () => {
    expect(await readConnectionCredentialForm(actor, 'bluesky', 'fr')).toMatchObject({ platform: 'bluesky', confirmation: 'CONNECT WITH CREDENTIALS bluesky', fields: expect.any(Array) });
    expect(m.form).toHaveBeenCalledWith('fr');
    m.flow.mockResolvedValue({ isReady: async () => true });
    await expect(readConnectionCredentialForm(actor, 'bluesky')).rejects.toMatchObject({ code: 'unavailable' });
  });
});
