import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  accounts: [] as Array<{ id: string; workspaceId: string }>,
  secret: 'app-secret' as string | null,
  calls: [] as string[],
}));

vi.mock('@/server/config/store', () => ({
  runtimeSecret: vi.fn(async () => state.secret),
  runtimeConfig: vi.fn(async () => 120),
}));
vi.mock('@/server/data', () => {
  const tx = {
    $executeRaw: vi.fn(async () => { state.calls.push('audit'); return 1; }),
    target: { findMany: vi.fn(async () => [{ id: 't1' }]), updateMany: vi.fn(async () => { state.calls.push('targets'); return { count: 1 }; }) },
    postTarget: { updateMany: vi.fn(async () => { state.calls.push('postTargets'); return { count: 2 }; }) },
    socialAccount: { update: vi.fn(async () => { state.calls.push('account'); }), updateMany: vi.fn(async () => { state.calls.push('invalidate'); return { count: 1 }; }) },
  };
  return { prisma: { ...tx, socialAccount: { ...tx.socialAccount, findMany: vi.fn(async () => state.accounts) }, $transaction: async (run: (t: typeof tx) => Promise<unknown>) => run(tx) } };
});

import { handleFacebookDataDeletion, handleFacebookDeauthorize, parseFacebookSignedRequest } from '@/platforms/facebook/data-callbacks';
import { handleDataCallback } from '@/server/platforms/data-callbacks-http';

const sign = (body: object, secret = 'app-secret') => {
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${createHmac('sha256', secret).update(payload).digest('base64url')}.${payload}`;
};
const valid = () => sign({ algorithm: 'HMAC-SHA256', user_id: '1234567890' });
const post = (body: string) => new Request('https://social.example/api/platforms/facebook/data-deletion', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });

beforeEach(() => { state.accounts = [{ id: 'a1', workspaceId: 'w1' }]; state.secret = 'app-secret'; state.calls = []; });

describe('Facebook signed request', () => {
  it('accepts only a correctly signed HMAC-SHA256 payload with a numeric user id', () => {
    expect(parseFacebookSignedRequest(valid(), 'app-secret')).toBe('1234567890');
    expect(parseFacebookSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: '1' }, 'other'), 'app-secret')).toBeNull();
    expect(parseFacebookSignedRequest(sign({ algorithm: 'HMAC-SHA1', user_id: '1' }), 'app-secret')).toBeNull();
    expect(parseFacebookSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: "1'; --" }), 'app-secret')).toBeNull();
    expect(parseFacebookSignedRequest('nodot', 'app-secret')).toBeNull();
    expect(parseFacebookSignedRequest(valid(), '')).toBeNull();
  });
});

describe('Facebook callbacks', () => {
  it('rejects a request when the app secret is not configured', async () => {
    state.secret = null;
    expect(await handleFacebookDeauthorize(valid())).toEqual({ ok: false, reason: 'invalid_signature' });
    expect(state.calls).toEqual([]);
  });

  it('deauthorize flags the connection and audits without erasing', async () => {
    expect(await handleFacebookDeauthorize(valid())).toEqual({ ok: true, affected: 1 });
    expect(state.calls).toEqual(['invalidate', 'audit']);
  });

  it('data deletion erases credentials, cancels pending work, audits and returns a code', async () => {
    const result = await handleFacebookDataDeletion(valid());
    expect(result).toMatchObject({ ok: true, affected: 1 });
    expect(result.ok && result.confirmationCode).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.calls).toEqual(['postTargets', 'targets', 'account', 'audit']);
  });

  it('data deletion for a person with no connections still answers with a code and changes nothing', async () => {
    state.accounts = [];
    const result = await handleFacebookDataDeletion(valid());
    expect(result).toMatchObject({ ok: true, affected: 0 });
    expect(state.calls).toEqual([]);
  });
});

describe('platform callback transport', () => {
  it('answers Meta with the status URL and confirmation code', async () => {
    const response = await handleDataCallback(post(`signed_request=${encodeURIComponent(valid())}`), 'facebook', 'dataDeletion');
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.url).toContain(`/data-deletion?code=${body.confirmation_code}`);
  });

  it('refuses unsigned, forged, JSON and unknown-platform calls without touching data', async () => {
    expect((await handleDataCallback(post('x=1'), 'facebook', 'deauthorize')).status).toBe(400);
    expect((await handleDataCallback(post('{"signed_request":"x"}'), 'facebook', 'deauthorize')).status).toBe(400);
    expect((await handleDataCallback(post(`signed_request=${encodeURIComponent(sign({ user_id: '1' }, 'wrong'))}`), 'facebook', 'dataDeletion')).status).toBe(401);
    expect((await handleDataCallback(post('signed_request=a.b'), 'nope', 'deauthorize')).status).toBe(404);
    expect(state.calls).toEqual([]);
  });
});
