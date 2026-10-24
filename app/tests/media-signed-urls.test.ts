import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ config: vi.fn(), secret: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config, runtimeSecret: m.secret }));

import { mediaShareDelivery, mediaSharePath, mintMediaSharePath, mintMediaShareUrl, signMediaShare, verifyMediaShare } from '@/modules/publishing/server/media/signed-urls';

const SECRET = 'test-share-secret';
const WORKSPACE = 'workspace-a';
const ID = '123e4567-e89b-42d3-a456-426614174000';
const NOW = Math.floor(new Date('2026-10-23T12:00:00.000Z').getTime() / 1000);

beforeEach(() => {
  vi.resetAllMocks();
  m.secret.mockResolvedValue(SECRET);
  m.config.mockImplementation(async (key: string) => key === 'publishing.mediaShareExpirySeconds' ? 3600 : key === 'app.publicOrigin' ? 'https://app.test' : undefined);
});

describe('media share grants', () => {
  it('round-trips a grant for one workspace image', () => {
    const exp = NOW + 3600;
    const sig = signMediaShare({ workspaceId: WORKSPACE, id: ID, exp }, SECRET);
    expect(verifyMediaShare({ workspaceId: WORKSPACE, id: ID, exp, sig }, SECRET, NOW)).toBe(true);
  });

  it.each([
    ['tampered signature', { workspaceId: WORKSPACE, id: ID, exp: NOW + 3600, sig: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }],
    ['swapped workspace', { workspaceId: 'workspace-b', id: ID, exp: NOW + 3600, sig: '' }],
    ['swapped image', { workspaceId: WORKSPACE, id: '123e4567-e89b-42d3-a456-426614174001', exp: NOW + 3600, sig: '' }],
    ['expired grant', { workspaceId: WORKSPACE, id: ID, exp: NOW, sig: '' }],
    ['malformed image id', { workspaceId: WORKSPACE, id: 'not-an-id', exp: NOW + 3600, sig: '' }],
    ['unsafe workspace', { workspaceId: '..', id: ID, exp: NOW + 3600, sig: '' }],
  ])('rejects a %s', (_name, grant) => {
    const exp = NOW + 3600;
    const sig = grant.sig || signMediaShare({ workspaceId: WORKSPACE, id: ID, exp }, SECRET);
    expect(verifyMediaShare({ ...grant, sig: grant.sig ? grant.sig : sig, exp: grant.exp }, SECRET, NOW)).toBe(false);
  });

  it('rejects a grant signed with a rotated secret', () => {
    const exp = NOW + 3600;
    const sig = signMediaShare({ workspaceId: WORKSPACE, id: ID, exp }, 'old-secret');
    expect(verifyMediaShare({ workspaceId: WORKSPACE, id: ID, exp, sig }, SECRET, NOW)).toBe(false);
  });

  it('refuses to verify without a configured secret', () => {
    const exp = NOW + 3600;
    const sig = signMediaShare({ workspaceId: WORKSPACE, id: ID, exp }, SECRET);
    expect(verifyMediaShare({ workspaceId: WORKSPACE, id: ID, exp, sig }, '', NOW)).toBe(false);
  });

  it('builds a relative serve path carrying the grant', () => {
    const exp = NOW + 60;
    const path = mediaSharePath({ workspaceId: WORKSPACE, id: ID, exp, sig: signMediaShare({ workspaceId: WORKSPACE, id: ID, exp }, SECRET) });
    expect(path.startsWith(`/api/media/${ID}?`)).toBe(true);
    const query = new URL(path, 'https://app.test').searchParams;
    expect(verifyMediaShare({ workspaceId: query.get('ws')!, id: ID, exp: Number(query.get('exp')), sig: query.get('sig')! }, SECRET, NOW)).toBe(true);
  });
});

describe('media share minting', () => {
  it('mints an absolute verifiable URL while the pipeline is configured', async () => {
    const url = await mintMediaShareUrl(WORKSPACE, ID, new Date(NOW * 1000));
    expect(url?.startsWith(`https://app.test/api/media/${ID}?`)).toBe(true);
    const query = new URL(url!).searchParams;
    expect(verifyMediaShare({ workspaceId: WORKSPACE, id: ID, exp: Number(query.get('exp')), sig: query.get('sig')! }, SECRET, NOW)).toBe(true);
  });

  it.each([
    ['missing secret', '', 'https://app.test'],
    ['missing origin', SECRET, ''],
    ['unparseable origin', SECRET, 'not a url'],
    ['origin with credentials', SECRET, 'https://user:pass@app.test'],
  ])('mints nothing with %s', async (_name, secret, origin) => {
    m.secret.mockResolvedValue(secret || null);
    m.config.mockImplementation(async (key: string) => key === 'publishing.mediaShareExpirySeconds' ? 3600 : key === 'app.publicOrigin' ? origin : undefined);
    await expect(mintMediaShareUrl(WORKSPACE, ID, new Date(NOW * 1000))).resolves.toBeNull();
  });

  it('mints a relative preview path from the secret alone', async () => {
    m.config.mockImplementation(async (key: string) => key === 'publishing.mediaShareExpirySeconds' ? 3600 : '');
    const path = await mintMediaSharePath(WORKSPACE, ID, new Date(NOW * 1000));
    expect(path?.startsWith(`/api/media/${ID}?`)).toBe(true);
  });

  it('mints no preview path without a secret or for malformed input', async () => {
    m.secret.mockResolvedValue(null);
    await expect(mintMediaSharePath(WORKSPACE, ID)).resolves.toBeNull();
    m.secret.mockResolvedValue(SECRET);
    await expect(mintMediaSharePath(WORKSPACE, 'nope')).resolves.toBeNull();
    await expect(mintMediaShareUrl('../x', ID)).resolves.toBeNull();
  });
});

describe('media share delivery gate', () => {
  it('advertises delivery for an exact HTTPS origin with a secret', async () => {
    await expect(mediaShareDelivery()).resolves.toEqual({ origin: 'https://app.test' });
  });

  it.each([
    ['missing secret', null, 'https://app.test'],
    ['missing origin', SECRET, ''],
    ['plain HTTP origin', SECRET, 'http://app.test'],
    ['origin with a path', SECRET, 'https://app.test/extra'],
    ['origin with credentials', SECRET, 'https://user@app.test'],
  ])('withholds delivery with %s', async (_name, secret, origin) => {
    m.secret.mockResolvedValue(secret);
    m.config.mockImplementation(async (key: string) => key === 'app.publicOrigin' ? origin : undefined);
    await expect(mediaShareDelivery()).resolves.toBeNull();
  });
});
