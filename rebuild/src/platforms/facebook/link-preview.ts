import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import type { PlatformLinkCard } from '@/server/platforms/host';
import { graphObjectUrl } from './protocol';

type Scrape = { title?: string; description?: string; site_name?: string; image?: Array<{ url?: string }>; og_object?: { title?: string; description?: string; image?: string } };
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;

/**
 * Ask Facebook to read a public page again (`POST /?id=<url>&scrape=true`) and return the card it will
 * show. As a side effect Facebook refreshes its cache for the address, which is the documented fix for an
 * old title or picture. Uses the app access token (id|secret); the secret never leaves this function.
 * Failures return null: the caller keeps the locally read card.
 */
export async function refreshFacebookLinkCard(url: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<PlatformLinkCard | null> {
  const [graphBaseUrl, graphVersion, appId, timeoutMs] = await Promise.all([runtimeConfig('meta.graphBaseUrl'), runtimeConfig('meta.graphVersion'), runtimeConfig('meta.appId'), runtimeConfig('meta.requestTimeoutMs')]);
  const secret = await runtimeSecret('meta.appSecret');
  if (!appId || !secret) return null;
  const target = graphObjectUrl({ graphBaseUrl: String(graphBaseUrl), graphVersion: String(graphVersion) }, '');
  const body = new URLSearchParams({ id: url, scrape: 'true', access_token: `${appId}|${secret}` });
  try {
    const response = await fetchImpl(target, { method: 'POST', body, signal: AbortSignal.any([signal, AbortSignal.timeout(Number(timeoutMs))]), redirect: 'error', cache: 'no-store', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); return null; }
    const data = await response.json() as Scrape;
    const card = { title: text(data.title) ?? text(data.og_object?.title), description: text(data.description) ?? text(data.og_object?.description), imageUrl: text(data.image?.find(entry => entry.url)?.url) ?? text(data.og_object?.image), siteName: text(data.site_name) };
    return card.title || card.description || card.imageUrl ? card : null;
  } catch { return null; }
}
