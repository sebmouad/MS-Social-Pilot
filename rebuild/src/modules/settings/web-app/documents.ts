import type { WebAppPolicy } from './config';
/** Browser protocol routes, not configurable destinations. These are served by thin app routes. */
export const WEB_APP_ROUTES = { manifest: '/manifest.webmanifest', worker: '/sw.js', offline: '/offline', icon: '/app-icon' } as const;
export const OFFLINE_CACHE_PREFIX = 'msp-rebuild-offline-';
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export function webAppManifest(policy: WebAppPolicy, locale: 'en' | 'fr') {
  const t = policy.copy[locale];
  return { id: policy.scope, name: t.name, short_name: t.shortName, description: t.description, lang: locale, start_url: policy.startUrl, scope: policy.scope, display: policy.display, background_color: policy.backgroundColor, theme_color: policy.themeColor,
    icons: [192, 512].map(size => ({ src: `${WEB_APP_ROUTES.icon}/${size}`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' })),
  };
}
export function offlineDocument(policy: WebAppPolicy, locale: 'en' | 'fr') {
  const t = policy.copy[locale];
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="${policy.themeColor}"><title>${escape(t.offlineTitle)} · ${escape(t.name)}</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:${policy.backgroundColor};color:${policy.inkColor};font-family:system-ui,sans-serif;line-height:1.6}main{width:min(100% - 2rem,32rem);padding:2rem 0;overflow-wrap:anywhere}header{display:flex;align-items:center;gap:1rem;font-weight:600}img{width:64px;height:64px}h1{font-size:2rem;line-height:1.2;margin:2rem 0 1rem;text-wrap:balance}p{margin-bottom:2rem}a{display:inline-block;padding:.75rem 1rem;border:2px solid currentColor;color:inherit;text-decoration:none;font-weight:600;border-radius:.5rem}a:hover{text-decoration:underline}a:focus-visible{outline:3px solid currentColor;outline-offset:4px}
  @media(prefers-color-scheme:dark){body{background:${policy.darkBackgroundColor};color:${policy.darkInkColor}}
  </style></head><body><main><header><img src="${WEB_APP_ROUTES.icon}/192" width="64" height="64" alt=""><span>${escape(t.name)}</span></header><h1>${escape(t.offlineTitle)}</h1><p>${escape(t.offlineDetail)}</p><a href="${escape(policy.startUrl)}">${escape(t.retry)}</a></main></body></html>`;
}
/** Generate JS with JSON encoding: Root text must never become executable source. */
export function serviceWorkerDocument(policy: WebAppPolicy) {
  const setup = JSON.stringify({ enabled: policy.enabled, cache: `${OFFLINE_CACHE_PREFIX}${policy.cacheRevision}`, prefix: OFFLINE_CACHE_PREFIX,
    offline: { en: `${WEB_APP_ROUTES.offline}?lang=en`, fr: `${WEB_APP_ROUTES.offline}?lang=fr` }, icon: `${WEB_APP_ROUTES.icon}/192` });
  return `'use strict';
const policy = ${setup};
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (policy.enabled) {
      const cache = await caches.open(policy.cache);
      await cache.addAll([...Object.values(policy.offline), policy.icon]);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(policy.prefix) && (!policy.enabled || key !== policy.cache)) await caches.delete(key);
    }
    if (!policy.enabled) { await self.registration.unregister(); return; }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (!policy.enabled || request.method !== 'GET' || request.mode !== 'navigate' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).catch(async () => {
    const locale = (request.headers.get('accept-language') || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
    const cache = await caches.open(policy.cache);
    return await cache.match(policy.offline[locale]) || Response.error();
  }));
});`;
}
