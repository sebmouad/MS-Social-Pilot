import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ link: vi.fn(), bio: vi.fn(), short: vi.fn() }));
vi.mock('../src/modules/sharing/server/public', () => ({ resolvePublicLink: state.link }));
vi.mock('../src/modules/sharing/server/bio', () => ({ openPublicBio: state.bio }));
vi.mock('../src/modules/publishing/server/short-links', () => ({ resolveShortLink: state.short, countShortLinkRequest: () => true }));
vi.mock('../src/server/client-ip', () => ({ clientIp: () => '203.0.113.9' }));
import { GET as shareGet, HEAD as shareHead } from '../src/app/share/[token]/route';
import { GET as bioGet } from '../src/app/bio/[slug]/route';
import { GET as shortGet, HEAD as shortHead } from '../src/app/s/[slug]/route';

const share = (token: string, init?: RequestInit, method: 'GET' | 'HEAD' = 'GET') => (method === 'GET' ? shareGet : shareHead)(new Request(`https://example.test/share/${token}?tab=calendar`, { method, ...init }), { params: Promise.resolve({ token }) });
beforeEach(() => vi.resetAllMocks());

describe('public routes answer with a real status before any page streams', () => {
  it('returns 404 for an unknown share link, as an unindexed page that is never cached', async () => {
    state.link.mockResolvedValue({ ok: false, reason: 'not_found' });
    const response = await share('nope');
    expect(response.status).toBe(404);
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.text()).toContain('This link isn’t available');
  });

  it('answers a HEAD request with the same status and no body', async () => {
    state.link.mockResolvedValue({ ok: false, reason: 'not_found' });
    const response = await share('nope', undefined, 'HEAD');
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('uses French when the browser asks for it', async () => {
    state.link.mockResolvedValue({ ok: false, reason: 'not_found' });
    const response = await share('nope', { headers: { 'accept-language': 'fr-CA,fr;q=0.9' } });
    expect(await response.text()).toContain('Ce lien n’est pas disponible');
  });

  it('returns 429 with Retry-After when the visitor is rate limited', async () => {
    state.link.mockResolvedValue({ ok: false, reason: 'rate_limited' });
    const response = await share('busy');
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('300');
  });

  it('hands a live link on to the rendered page and keeps the portal tab', async () => {
    state.link.mockResolvedValue({ ok: true, value: {} });
    const response = await share('abc_DEF-123');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/share/abc_DEF-123/view?tab=calendar');
    expect(state.link).toHaveBeenCalledWith('abc_DEF-123', '203.0.113.9');
  });

  it('does not report an outage as a missing link', async () => {
    state.link.mockRejectedValue(new Error('database unavailable'));
    const response = await share('abc');
    expect(response.status).toBe(307);
  });

  it('returns 404 for an unknown bio page and hands a live one on', async () => {
    state.bio.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    const missing = await bioGet(new Request('https://example.test/bio/nobody'), { params: Promise.resolve({ slug: 'nobody' }) });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('This page isn’t available');
    state.bio.mockResolvedValueOnce({ ok: true, value: {} });
    const live = await bioGet(new Request('https://example.test/bio/studio'), { params: Promise.resolve({ slug: 'studio' }) });
    expect(live.status).toBe(307);
    expect(live.headers.get('location')).toBe('/bio/studio/view');
  });

  it('returns 404 for an unknown short link on GET and HEAD', async () => {
    state.short.mockResolvedValue(null);
    const context = { params: Promise.resolve({ slug: 'gone' }) };
    expect((await shortGet(new Request('https://example.test/s/gone'), context)).status).toBe(404);
    expect((await shortHead(new Request('https://example.test/s/gone', { method: 'HEAD' }), context)).status).toBe(404);
  });
});
