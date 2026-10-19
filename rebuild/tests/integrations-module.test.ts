import { describe, expect, it } from 'vitest';
import { INTEGRATIONS_CONFIG } from '../src/modules/integrations/config';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';
import { integrationsCopy, integrationsLocale, integrationsText } from '../src/modules/integrations/copy';
import { INTEGRATIONS_JOBS, INTEGRATIONS_PAGES } from '../src/modules/integrations/manifest';
import { settingsManifest } from '../src/modules/settings/manifest';
import { installedMcpGroups } from '../src/modules/installed-mcp';
import { PAGES } from '../src/lib/product';
import { resolvePermissions, canAccessFeature } from '../src/server/permissions';
import { signWebhook, verifyWebhookSignature } from '../src/modules/integrations/contracts';
import { createPinnedFetcher, type PinnedRequestOptions } from '../src/modules/publishing/server/media/network/pinned-fetch';

describe('module declarations', () => {
  it('registers every Root key under the integrations prefix, owned by the Settings module, with unique keys', () => {
    const keys = INTEGRATIONS_CONFIG.map(item => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) { expect(key.startsWith('integrations.')).toBe(true); expect(CONFIG_BY_KEY.has(key as never)).toBe(true); }
    expect(settingsManifest.rootSettingsPrefixes).toContain('integrations.');
    expect(INTEGRATIONS_CONFIG.every(item => item.consumption === 'active')).toBe(true);
  });
  it('declares one Settings page and one worker job whose schedule key exists', () => {
    expect(INTEGRATIONS_PAGES.map(page => page.id)).toEqual(['settings/webhooks']);
    expect(PAGES.some(page => page.id === 'settings/webhooks' && page.href === '/settings/webhooks')).toBe(true);
    expect(settingsManifest.jobs.map(job => job.name)).toContain('webhooks');
    for (const job of INTEGRATIONS_JOBS) expect(CONFIG_BY_KEY.has(job.configKey as never)).toBe(true);
  });
  it('installs the MCP group exactly once with unique tool names', () => {
    const names = installedMcpGroups().flatMap(group => group.tools.map(tool => tool.name));
    expect(new Set(names).size).toBe(names.length);
    expect(installedMcpGroups().filter(group => group.id === 'integrations-webhooks')).toHaveLength(1);
  });
  it('gives the webhook grant only to workspace owners and admins', () => {
    const grant = (role: string) => resolvePermissions({ role, workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] });
    for (const role of ['owner', 'admin']) { expect(canAccessFeature(grant(role), 'settings/webhooks', 'read')).toBe(true); expect(canAccessFeature(grant(role), 'settings/webhooks', 'write')).toBe(true); }
    for (const role of ['editor', 'contributor', 'viewer', 'client', 'unknown']) { expect(canAccessFeature(grant(role), 'settings/webhooks', 'read'), role).toBe(false); expect(canAccessFeature(grant(role), 'settings/webhooks', 'write'), role).toBe(false); }
  });
});

describe('copy', () => {
  it('ships identical keys in English and French and chooses the language from accept-language', () => {
    expect(Object.keys(integrationsCopy.fr).sort()).toEqual(Object.keys(integrationsCopy.en).sort());
    for (const key of Object.keys(integrationsCopy.en) as Array<keyof typeof integrationsCopy.en>) expect(integrationsCopy.fr[key].length, key).toBeGreaterThan(0);
    expect(integrationsLocale('fr-CA,fr;q=0.9,en;q=0.8')).toBe('fr'); expect(integrationsLocale('en-US')).toBe('en'); expect(integrationsLocale(null)).toBe('en'); expect(integrationsLocale('de, fr;q=0.5')).toBe('en');
    expect(integrationsText('fr', 'full', { max: 20 })).toContain('20'); expect(integrationsText('en', 'description', { workspace: 'Acme' })).toContain('Acme');
  });
  it('keeps placeholders consistent between languages', () => {
    const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    for (const key of Object.keys(integrationsCopy.en) as Array<keyof typeof integrationsCopy.en>) expect(holes(integrationsCopy.fr[key]), key).toEqual(holes(integrationsCopy.en[key]));
  });
});

describe('signing', () => {
  it('matches a fixed HMAC vector and verifies in constant time with length-safe comparison', () => {
    const header = signWebhook('whsec_key', 1_700_000_000, '{"id":"d1"}');
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature('whsec_key', 1_700_000_000, '{"id":"d1"}', header)).toBe(true);
    expect(verifyWebhookSignature('whsec_key', 1_700_000_001, '{"id":"d1"}', header)).toBe(false);
    expect(verifyWebhookSignature('whsec_key', 1_700_000_000, '{"id":"d2"}', header)).toBe(false);
    expect(verifyWebhookSignature('whsec_key', 1_700_000_000, '{"id":"d1"}', 'short')).toBe(false);
  });
});

describe('shared pinned transport carries a POST body without opening a socket', () => {
  const ok = (calls: PinnedRequestOptions[]) => async (options: PinnedRequestOptions) => { calls.push(options); return { status: 204, headers: [], body: null, peerAddress: '93.184.216.34' }; };
  it('connects only to the validated address, sends method, body and exact length, and keeps GET behaviour unchanged', async () => {
    const calls: PinnedRequestOptions[] = [];
    const fetcher = createPinnedFetcher({ transport: ok(calls) });
    const signal = new AbortController().signal;
    const post = await fetcher({ url: 'https://hooks.example.com/h?x=1', headers: { 'x-msp-signature': 'sha256=abc' }, signal, resolved: ['93.184.216.34'], method: 'POST', body: '{"é":1}' });
    expect(post.status).toBe(204);
    expect(calls[0]).toMatchObject({ method: 'POST', body: '{"é":1}', host: 'hooks.example.com', port: 443, path: '/h?x=1', servername: 'hooks.example.com' });
    expect(calls[0]!.headers['content-length']).toBe(String(Buffer.byteLength('{"é":1}'))); expect(calls[0]!.headers['x-msp-signature']).toBe('sha256=abc');
    const get = await createPinnedFetcher({ transport: ok(calls) })({ url: 'https://hooks.example.com/f', headers: {}, signal, resolved: ['93.184.216.34'] });
    expect(get.status).toBe(204); expect(calls[1]).toMatchObject({ method: 'GET' }); expect(calls[1]!.body).toBeUndefined(); expect(calls[1]!.headers['content-length']).toBeUndefined();
  });
  it('refuses a private or missing resolved address even if a caller skipped the guard', async () => {
    const calls: PinnedRequestOptions[] = [];
    const fetcher = createPinnedFetcher({ transport: ok(calls) });
    const signal = new AbortController().signal;
    await expect(fetcher({ url: 'https://hooks.example.com/h', headers: {}, signal, resolved: ['10.0.0.8'], method: 'POST', body: '{}' })).rejects.toMatchObject({ reason: 'blocked_address' });
    await expect(fetcher({ url: 'https://hooks.example.com/h', headers: {}, signal, resolved: [], method: 'POST', body: '{}' })).rejects.toMatchObject({ reason: 'blocked_address' });
    expect(calls).toHaveLength(0);
  });
});
