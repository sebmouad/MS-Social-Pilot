// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgencyExport } from './ui/AgencyExport';

let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const createObjectURL = vi.fn(() => 'blob:agency');
const clickDownload = vi.fn();
const render = (key = 'initial', locale: 'en' | 'fr' = 'en') => act(async () => root.render(createElement(AgencyExport, { key, locale, query: 'q=Studio&attention=true&sort=failed&order=asc' })));
const click = () => act(async () => { container.querySelector('button')!.click(); });
const receipt = () => ({ ok: true, version: 1, format: 'csv', filename: 'agency-overview.csv', contentType: 'text/csv;charset=utf-8', contents: 'hello', bytes: 5 });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  createObjectURL.mockClear(); clickDownload.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(receipt())));
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clickDownload);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('downloads a confirmed receipt with applied filters and announces preparation', async () => {
  await render(); await click();
  expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/agency?q=Studio&attention=true&sort=failed&order=asc&format=csv&locale=en');
  expect(createObjectURL).toHaveBeenCalledTimes(1); expect(clickDownload).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Export prepared');
});
it('refuses malformed receipts, keeps controls for retry and provides French feedback', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...receipt(), bytes: 99 }));
  await render('initial', 'fr'); await click();
  expect(clickDownload).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Impossible');
  expect(container.querySelector('button')?.disabled).toBe(false);
  await click(); expect(clickDownload).toHaveBeenCalledTimes(1);
});
it('deduplicates pending clicks and aborts the old request on filter remount', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(); await click(); await click();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(container.querySelector('button')?.disabled).toBe(true);
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
  await render('new-filter'); expect(signal.aborted).toBe(true);
  await act(async () => finish(Response.json(receipt())));
  expect(clickDownload).not.toHaveBeenCalled();
  expect(container.querySelector('[role="status"]')).toBeNull();
});
