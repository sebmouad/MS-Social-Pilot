import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { WEB_APP_DEFAULTS, webAppSchema } from '@/modules/settings/web-app/config';
import { offlineDocument, serviceWorkerDocument, webAppManifest, OFFLINE_CACHE_PREFIX } from '@/modules/settings/web-app/documents';

it('uses current Root branding, language, launch path and valid install icon sizes', () => {
  const policy = { ...WEB_APP_DEFAULTS, startUrl: '/home', themeColor: '#123456', copy: { ...WEB_APP_DEFAULTS.copy, fr: { ...WEB_APP_DEFAULTS.copy.fr, name: 'Atelier' } } };
  expect(webAppManifest(policy, 'fr')).toMatchObject({ name: 'Atelier', lang: 'fr', start_url: '/home', theme_color: '#123456', icons: [expect.objectContaining({ sizes: '192x192', purpose: 'any maskable' }), expect.objectContaining({ sizes: '512x512' })] });
});
it.each(['en', 'fr'] as const)('escapes Root copy and produces a private-data-free %s fallback', locale => {
  const policy = structuredClone(WEB_APP_DEFAULTS);
  policy.copy[locale].offlineTitle = '<script>alert(1)</script>';
  const html = offlineDocument(policy, locale);
  expect(html).toContain(`lang="${locale}"`);
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
  expect(html).toContain(policy.copy[locale].offlineDetail);
  expect(html).toContain(`href="${policy.startUrl}"`);
});
it.each(['//evil.test', '/\\evil.test', '/%2f%2fevil', '/home?secret=x', '/home\n'])('rejects unsafe Root launch path %j', startUrl => {
  expect(webAppSchema.safeParse({ ...WEB_APP_DEFAULTS, startUrl }).success).toBe(false);
});
it('requires complete bilingual copy and safe colors/cache namespace', () => {
  expect(webAppSchema.safeParse(WEB_APP_DEFAULTS).success).toBe(true);
  for (const patch of [{ themeColor: 'red;display:none' }, { cacheRevision: '../other' }, { iconText: '<long>' }, { scope: '/api' }, { copy: { en: WEB_APP_DEFAULTS.copy.en } }]) expect(webAppSchema.safeParse({ ...WEB_APP_DEFAULTS, ...patch }).success).toBe(false);
});
function worker(enabled = true) {
  const listeners = new Map<string, (event: any) => void>();
  const match = vi.fn(async (_url: string) => new Response('public offline'));
  const cache = { addAll: vi.fn(async (_urls: string[]) => {}), match };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ['unrelated-cache', `${OFFLINE_CACHE_PREFIX}old`, `${OFFLINE_CACHE_PREFIX}v1`]), delete: vi.fn(async () => true) };
  const self = { addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, fn), skipWaiting: vi.fn(), clients: { claim: vi.fn() }, registration: { unregister: vi.fn() }, location: { origin: 'https://app.test' } };
  const fetch = vi.fn(async () => new Response('private fresh page'));
  runInContext(serviceWorkerDocument({ ...WEB_APP_DEFAULTS, enabled }), createContext({ self, caches, fetch, URL, Response }));
  return { listeners, cache, caches, self, fetch };
}
describe('service worker actual generated execution', () => {
  it('pre-caches only public fallbacks/icon, deletes only its own old revisions', async () => {
    const w = worker(); let operation: Promise<unknown>;
    w.listeners.get('install')!({ waitUntil: (value: Promise<unknown>) => { operation = value; } }); await operation!;
    expect(w.cache.addAll.mock.calls[0][0]).toEqual(['/offline?lang=en', '/offline?lang=fr', '/app-icon/192']);
    w.listeners.get('activate')!({ waitUntil: (value: Promise<unknown>) => { operation = value; } }); await operation!;
    expect(w.caches.delete.mock.calls).toEqual([[`${OFFLINE_CACHE_PREFIX}old`]]);
    expect(w.self.clients.claim).toHaveBeenCalledOnce();
  });
  it('passes through online navigation without storing private pages and uses language-specific fallback on network failure', async () => {
    const w = worker(); let response: Promise<Response>;
    const event = { request: { url: 'https://app.test/home', method: 'GET', mode: 'navigate', headers: new Headers({ 'accept-language': 'fr-FR,fr;q=0.9' }) }, respondWith: (value: Promise<Response>) => { response = value; } };
    w.listeners.get('fetch')!(event);
    expect(await (await response!).text()).toBe('private fresh page'); expect(w.caches.open).not.toHaveBeenCalled();
    w.fetch.mockRejectedValueOnce(new Error('offline')); w.listeners.get('fetch')!(event);
    expect(await (await response!).text()).toBe('public offline'); expect(w.cache.match).toHaveBeenCalledWith('/offline?lang=fr');
    expect(w.cache.addAll).not.toHaveBeenCalled();
  });
  it.each([{ method: 'POST', mode: 'navigate', url: 'https://app.test/home' }, { method: 'GET', mode: 'cors', url: 'https://app.test/api/posts' }, { method: 'GET', mode: 'navigate', url: 'https://external.test/' }])('never intercepts writes/API fetches/external origins %j', request => {
    const w = worker(); const respondWith = vi.fn();
    w.listeners.get('fetch')!({ request, respondWith }); expect(respondWith).not.toHaveBeenCalled();
  });
  it('Root disable unregisters and clears only owned caches without intercepting requests', async () => {
    const w = worker(false); let operation: Promise<unknown>;
    w.listeners.get('activate')!({ waitUntil: (value: Promise<unknown>) => { operation = value; } }); await operation!;
    expect(w.self.registration.unregister).toHaveBeenCalledOnce(); expect(w.self.clients.claim).not.toHaveBeenCalled();
    expect(w.caches.delete.mock.calls).toEqual([[`${OFFLINE_CACHE_PREFIX}old`], [`${OFFLINE_CACHE_PREFIX}v1`]]);
    const respondWith = vi.fn(); w.listeners.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: 'https://app.test/' }, respondWith }); expect(respondWith).not.toHaveBeenCalled();
  });
});
