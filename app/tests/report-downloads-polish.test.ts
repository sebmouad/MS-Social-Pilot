// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReportDownloads } from '../src/modules/analytics/ui/reports/ReportDownloads';
import { ToastProvider } from '../src/components/Toast';

let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const prepared = { filename: 'report-test', csv: 'Channel,Count\nStudio,12', json: '{"count":12}', html: '<!doctype html><html><body><h1>Report</h1></body></html>' };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:report-test'), revokeObjectURL: vi.fn() });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = async (props: Parameters<typeof ReportDownloads>[0]) => act(async () => root.render(createElement(ToastProvider, { children: createElement(ReportDownloads, props) })));
const click = async (label: string) => act(async () => {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
  if (!button) throw Error(`Missing ${label}`); button.click();
});
it('prepares CSV and JSON downloads with correct types and extensions, localized feedback and URL cleanup', async () => {
  const clicked: Array<{ name: string; href: string }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push({ name: this.download, href: this.href }); });
  await render({ prepared, locale: 'fr' });
  await click('Télécharger le CSV'); await click('Télécharger le JSON');
  expect(clicked).toEqual([{ name: 'report-test.csv', href: 'blob:report-test' }, { name: 'report-test.json', href: 'blob:report-test' }]);
  const make = vi.mocked(URL.createObjectURL);
  expect(make.mock.calls.map(call => (call[0] as Blob).type)).toEqual(['text/csv;charset=utf-8', 'application/json;charset=utf-8']);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Téléchargement préparé');
  await render({ prepared: { ...prepared, filename: 'another-report' } });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:report-test');
});
it('omits unavailable JSON, preserves a printable HTML download and opens the browser PDF print workflow', async () => {
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await render({ prepared: { ...prepared, json: null } });
  expect(container.textContent).not.toContain('Download JSON');
  await click('Download printable page');
  expect((vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).type).toBe('text/html;charset=utf-8');
  const print = vi.fn(), focus = vi.fn(), events = new EventTarget();
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({ print, focus, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) } as unknown as Window);
  await click('Print / save PDF');
  const frame = container.querySelector('iframe')!;
  expect(frame.getAttribute('srcdoc')).toBe(prepared.html);
  expect(frame.getAttribute('sandbox')).toBe('allow-same-origin allow-modals');
  await act(async () => frame.dispatchEvent(new Event('load')));
  expect(print).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('Choose Save as PDF');
  await act(async () => events.dispatchEvent(new Event('afterprint')));
  expect(container.querySelector('iframe')).toBeNull();
  expect(document.activeElement?.textContent).toBe('Print / save PDF');
  // The app never labels HTML bytes as a PDF artifact.
  expect(vi.mocked(URL.createObjectURL).mock.calls).toHaveLength(1);
});
it('shows a persistent retry action when Blob preparation fails', async () => {
  vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw Error('download failed'); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await render({ prepared }); await click('Download CSV');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be opened');
  const retry = container.querySelector<HTMLButtonElement>('.ui-toast__action')!;
  await act(async () => retry.click());
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Download prepared');
});
