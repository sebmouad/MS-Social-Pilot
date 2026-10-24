import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encryptSecret } from '../src/server/secret-crypto';
import { readPublishingCredential } from '../src/modules/publishing/server/credentials';

const originalKey = process.env.ENCRYPTION_KEY;
const now = new Date('2026-10-17T08:00:00Z');
const source = { invalidatedAt: null, tokenExpiresAt: null, scopes: ' read, publish-write ,publish-write' };
const adapter = { canUseCredential: (credential: { grantedScopes?: readonly string[] }) => credential.grantedScopes?.includes('publish-write') === true };
beforeEach(() => { process.env.ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64'); });
afterEach(() => { if (originalKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = originalKey; });
describe('shared publishing credential readiness', () => {
  it('decrypts only a healthy credential and applies the selected adapter grant policy', () => {
    const target = { accessToken: encryptSecret('synthetic-page-token'), socialAccount: source };
    expect(readPublishingCredential(target, adapter, 'publishing', now)).toEqual({ accessToken: 'synthetic-page-token', grantedScopes: ['read', 'publish-write', 'publish-write'] });
    expect(readPublishingCredential({ ...target, socialAccount: { ...source, scopes: 'read' } }, adapter, 'publishing', now)).toBeNull();
  });
  it('refuses credentials at expiry, after revocation and when the connection is missing', () => {
    const token = encryptSecret('synthetic-page-token');
    expect(readPublishingCredential({ accessToken: token, socialAccount: { ...source, tokenExpiresAt: now } }, adapter, 'publishing', now)).toBeNull();
    expect(readPublishingCredential({ accessToken: token, socialAccount: { ...source, invalidatedAt: now } }, adapter, 'remoteDelete', now)).toBeNull();
    expect(readPublishingCredential({ accessToken: token, socialAccount: null }, adapter, 'remoteStatus', now)).toBeNull();
  });
  it('turns unavailable encryption, empty tokens and policy failures into unavailable readiness', () => {
    expect(readPublishingCredential({ accessToken: 'invalid-envelope', socialAccount: source }, adapter, 'publishing', now)).toBeNull();
    expect(readPublishingCredential({ accessToken: encryptSecret('  '), socialAccount: source }, adapter, 'publishing', now)).toBeNull();
    const target = { accessToken: encryptSecret('synthetic-page-token'), socialAccount: source };
    expect(readPublishingCredential(target, { canUseCredential: () => { throw new Error('private policy failure'); } }, 'publishing', now)).toBeNull();
    delete process.env.ENCRYPTION_KEY;
    expect(readPublishingCredential(target, adapter, 'publishing', now)).toBeNull();
  });
});
