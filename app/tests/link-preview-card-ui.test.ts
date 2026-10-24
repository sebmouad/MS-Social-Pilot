// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LinkPreviewCard } from '@/modules/publishing/ui/compose/LinkPreviewCard';
const fetcher = vi.fn();
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const preview = { url: 'https://example.com/article', title: 'Example article', description: 'A fine read.', imageUrl: 'https://example.com/a.png', siteName: 'Example', fetchedAt: '2026-10-22T09:00:00Z' };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', fetcher); vi.useFakeTimers(); fetcher.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(link: string, locale: 'en' | 'fr' = 'en') { await act(async () => root.render(createElement(LinkPreviewCard, { link, locale, disabled: false }))); }
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(500); }); }
it('renders nothing without a fetchable link', async () => {
  await render('not a link'); await settle();
  expect(container.textContent).toBe('');
  expect(fetcher).not.toHaveBeenCalled();
});
it('reads the cache first and renders the card without fetching', async () => {
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ preview, cached: true }) });
  await render('https://example.com/article'); await settle();
  expect(container.textContent).toContain('Example article');
  expect(container.textContent).toContain('A fine read.');
  expect(container.textContent).toContain('Saved preview');
  expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0]![0])).toContain('/api/publishing/link-preview?url=');
});
it('fetches once on a cache miss and states honestly when there is no preview', async () => {
  fetcher.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => ({ preview: null, cached: false }) });
  await render('https://example.com/article'); await settle();
  expect(container.textContent).toContain('No preview for this link');
  expect(fetcher.mock.calls.filter(call => (call[1] as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
});
it('offers retry in French after a failure and does not refetch on re-render', async () => {
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ preview, cached: true }) });
  await render('https://example.com/article', 'fr'); await settle();
  expect(container.textContent).toContain('Aperçu enregistré');
  await render('https://example.com/article', 'fr'); await settle();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockRejectedValueOnce(new Error('offline'));
  await render('https://example.com/other', 'fr'); await settle();
  expect(container.textContent).toContain('Réessayer l’aperçu');
});
