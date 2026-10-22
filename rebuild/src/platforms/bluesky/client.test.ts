import { describe, it, expect, vi } from 'vitest';
import { createClient } from './client';
import { POLICY_DEFAULTS, policySchema } from './config';
import { manifest } from './manifest';
describe('staged provider boundary', () => {
  it('advertises no customer operations', () => { expect(Object.values(manifest.capabilities).every(value => value === 'unsupported')).toBe(true); });
  it('rejects insecure or credential-bearing endpoints', () => {
    for (const baseUrl of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/?token=x']) expect(policySchema.safeParse({ ...POLICY_DEFAULTS, baseUrl }).success).toBe(false);
  });
  it('refuses malformed credentials before network access', async () => {
    const send = vi.fn(); const client = createClient(POLICY_DEFAULTS, send);
    await expect(client.connect('bad', 'bad')).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
  });
  it('sanitizes transport errors without retries', async () => {
    const send = vi.fn().mockRejectedValue(new Error('secret token'));
    const client = createClient(POLICY_DEFAULTS, send, 'fr');
    await expect(client.connect('alice.bsky.social', 'aaaa-bbbb-cccc-dddd')).rejects.toThrow(POLICY_DEFAULTS.unavailable.fr);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

it('verifies a session then publishes a repository record', async () => {
  const send = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ accessJwt: 'jwt', did: 'did:plc:alice', handle: 'alice.bsky.social' }))).mockResolvedValueOnce(new Response(JSON.stringify({ uri: 'at://did:plc:alice/app.bsky.feed.post/one', cid: 'cid' })));
  const client = createClient(POLICY_DEFAULTS, send);
  const session = await client.connect('@alice.bsky.social', 'aaaa-bbbb-cccc-dddd');
  expect(await client.publish(session, 'Hello')).toMatchObject({ state: 'published', remoteId: 'at://did:plc:alice/app.bsky.feed.post/one' });
  expect(send.mock.calls[1][1].redirect).toBe('error');
  expect(send.mock.calls[1][1].headers.authorization).toBe('Bearer jwt');
});
it('honors the configured text bound before sending', async () => {
  const send = vi.fn(); const client = createClient({ ...POLICY_DEFAULTS, maxTextCharacters: 1 }, send);
  await expect(client.publish({ accessJwt: 'jwt', did: 'did:plc:alice', handle: 'alice' }, 'ab')).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
