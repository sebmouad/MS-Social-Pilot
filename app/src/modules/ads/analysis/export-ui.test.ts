// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ComparisonExport } from '../ui/compare/ComparisonExport';
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const href = '/api/ads/compare?format=csv&accountId=a1&level=ad&start=2026-10-01&end=2026-10-02';
const body = 'name,spend\r\nExample,10\r\n';
const response = () => ({ ok: true, headers: new Headers({
  'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="ads.csv"',
  'x-msp-export-format': 'ads-comparison-v1', 'x-msp-export-bytes': String(body.length),
}), blob: async () => new Blob([body]) });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:export');
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(url = href) { await act(async () => root.render(createElement(ComparisonExport, { href: url, locale: 'fr', maxBytes: 10000 }))); }
async function click(index = 0) { await act(async () => container.querySelectorAll('button')[index]!.click()); }
it('downloads findings with retained account/date/level filters and French feedback', async () => {
  vi.mocked(fetch).mockResolvedValue(response() as Response);
  await render(); await click(1);
  const url = vi.mocked(fetch).mock.calls[0]![0] as URL;
  expect(url.searchParams.get('exportKind')).toBe('findings');
  expect(url.searchParams.get('accountId')).toBe('a1');
  expect(url.searchParams.get('level')).toBe('ad');
  expect(url.searchParams.get('end')).toBe('2026-10-02');
  expect(container.querySelector('[role=status]')?.textContent).toContain('préparé');
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
});
it('retains controls and gives safe French feedback after a refusal', async () => {
  vi.mocked(fetch).mockResolvedValue({ ...response(), ok: false } as Response);
  await render(); await click();
  expect(container.querySelector('[role=alert]')?.textContent).toContain('réduisez les filtres');
  expect(container.querySelector('button')?.disabled).toBe(false);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('rejects mismatched byte receipts', async () => {
  const invalid = response(); invalid.headers.set('x-msp-export-bytes', '1');
  vi.mocked(fetch).mockResolvedValue(invalid as Response);
  await render(); await click();
  expect(container.querySelector('[role=alert]')).not.toBeNull();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('aborts obsolete filter downloads and prevents duplicate pending requests', async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await render(); await click(); await click();
  expect(fetch).toHaveBeenCalledOnce();
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal;
  await render(`${href}&sort=name`);
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(response() as Response));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(container.querySelector('button')?.disabled).toBe(false);
});
