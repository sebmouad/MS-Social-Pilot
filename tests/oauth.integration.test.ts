import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let oauth: typeof import('../src/lib/oauth');
let tokens: typeof import('../src/lib/api-tokens');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('oauth');
  ({ prisma } = await import('../src/lib/prisma'));
  oauth = await import('../src/lib/oauth');
  tokens = await import('../src/lib/api-tokens');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

async function seed() {
  const user = await prisma.user.create({ data: { email: `o-${randomBytes(4).toString('hex')}@example.test`, name: 'Person', passwordHash: 'x' } });
  const workspace = await prisma.workspace.create({ data: { name: 'W', slug: `w-${randomBytes(4).toString('hex')}`, timezone: 'UTC', developerFeatures: true } });
  await prisma.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: 'editor' } });
  const client = await oauth.registerClient({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
  return { user, workspace, client };
}

describe('OAuth for remote MCP clients', () => {
  it('accepts https and localhost redirects only', () => {
    expect(oauth.isAllowedRedirect('https://claude.ai/cb')).toBe(true);
    expect(oauth.isAllowedRedirect('http://localhost:3334/cb')).toBe(true);
    expect(oauth.isAllowedRedirect('http://evil.example/cb')).toBe(false);
    expect(oauth.isAllowedRedirect('javascript:alert(1)')).toBe(false);
  });

  it('swaps a code once, with the right verifier, for a working API key', async () => {
    const { user, workspace, client } = await seed();
    const verifier = randomBytes(40).toString('base64url');
    const redirectUri = client.redirectUris[0]!;
    const code = await oauth.issueCode({ clientId: client.id, userId: user.id, workspaceId: workspace.id, redirectUri, codeChallenge: oauth.s256(verifier), scope: 'write' });

    const made = await oauth.exchangeCode({ code, clientId: client.id, redirectUri, verifier });
    expect(made.token_type).toBe('Bearer');
    const ctx = await tokens.requireApiToken(new Request('http://x/api/mcp', { headers: { authorization: `Bearer ${made.access_token}` } }), 'write');
    expect(ctx.scope).toBe('write');

    await expect(oauth.exchangeCode({ code, clientId: client.id, redirectUri, verifier })).rejects.toThrow(/unknown, used or expired/);
  });

  it('refuses a wrong verifier and a different redirect', async () => {
    const { user, workspace, client } = await seed();
    const verifier = randomBytes(40).toString('base64url');
    const redirectUri = client.redirectUris[0]!;
    const issue = () => oauth.issueCode({ clientId: client.id, userId: user.id, workspaceId: workspace.id, redirectUri, codeChallenge: oauth.s256(verifier), scope: 'read' });

    await expect(oauth.exchangeCode({ code: await issue(), clientId: client.id, redirectUri, verifier: randomBytes(40).toString('base64url') })).rejects.toThrow(/verifier/);
    await expect(oauth.exchangeCode({ code: await issue(), clientId: client.id, redirectUri: 'https://other.example/cb', verifier })).rejects.toThrow(/another client/);
  });
});
