import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { collectFailures, open, OWNER } from './helpers';
import { prisma } from './fixtures';

/** The Claude web connector's sign-in: register, consent, swap the code for a key. */

let workspaceId = '';
let before = false;
test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await prisma.apiToken.deleteMany({ where: { name: 'e2e connector (connector)' } });
  await prisma.oAuthClient.deleteMany({ where: { name: 'e2e connector' } });
  if (workspaceId) await prisma.workspace.update({ where: { id: workspaceId }, data: { developerFeatures: before } });
});

test('allows an assistant and hands it a working key', async ({ page, request }) => {
  const failures = collectFailures(page);
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } });
  workspaceId = workspace.id;
  before = workspace.developerFeatures;
  await prisma.workspace.update({ where: { id: workspaceId }, data: { developerFeatures: true } });

  const metadata = await (await request.get('/.well-known/oauth-authorization-server')).json();
  expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
  const redirect = 'https://assistant.example/callback';
  const registered = await request.post('/api/oauth/register', { data: { client_name: 'e2e connector', redirect_uris: [redirect] } });
  expect(registered.status()).toBe(201);
  const { client_id } = await registered.json();

  const verifier = randomBytes(40).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  // The browser follows the 303 to the assistant; the request is enough, the host need not exist.
  let landed = '';
  page.on('request', (sent) => {
    if (sent.url().startsWith('https://assistant.example/')) landed = sent.url();
  });
  await open(page, `/oauth/authorize?response_type=code&client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz&scope=write`);
  await expect(page.getByText('e2e connector', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect.poll(() => landed).toContain('code=');
  const back = new URL(landed);
  expect(back.searchParams.get('state')).toBe('xyz');

  const swapped = await request.post('/api/oauth/token', {
    form: { grant_type: 'authorization_code', code: back.searchParams.get('code')!, client_id, redirect_uri: redirect, code_verifier: verifier },
  });
  expect(swapped.status()).toBe(200);
  const { access_token } = await swapped.json();
  const tools = await request.post('/api/mcp', {
    headers: { authorization: `Bearer ${access_token}` },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect((await tools.json()).result.tools.length).toBeGreaterThan(0);

  const anonymous = await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'ping' } });
  expect(anonymous.headers()['www-authenticate']).toContain('oauth-protected-resource');
  // The made-up assistant host cannot load; nothing else may fail.
  expect(failures.filter((failure) => !failure.includes('assistant.example'))).toEqual([]);
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('signing in comes back to the consent screen', async ({ page, request }) => {
    await prisma.workspace.update({ where: { id: workspaceId || (await prisma.workspace.findFirstOrThrow({ where: { name: OWNER.workspace } })).id }, data: { developerFeatures: true } });
    const registered = await request.post('/api/oauth/register', { data: { client_name: 'e2e connector', redirect_uris: ['https://assistant.example/callback'] } });
    const { client_id } = await registered.json();
    const challenge = createHash('sha256').update(randomBytes(40).toString('base64url')).digest('base64url');
    await page.goto(`/oauth/authorize?response_type=code&client_id=${client_id}&redirect_uri=${encodeURIComponent('https://assistant.example/callback')}&code_challenge=${challenge}&code_challenge_method=S256`);
    await page.waitForURL(/\/login/);
    await page.getByLabel(/e-?mail/i).fill(OWNER.email);
    await page.getByLabel(/^password$/i).fill(OWNER.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/oauth\/authorize\?/, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Allow' })).toBeVisible();
  });
});
