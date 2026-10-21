// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountExport } from '@/modules/settings/ui/account/export';
import { SettingsCopyProvider } from '@/modules/settings/ui/copy-context';
import { settingsUiCopy, settingsUiCopySchema } from '@/modules/settings/ui/copy-catalog';

let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const snapshot = { format: 'ms-social-pilot-account-export', version: 1, profile: { name: 'Émilie' }, coverage: { complete: false, included: ['profile'], excluded: ['workspaceContent', 'media'] } };
const content = JSON.stringify(snapshot);
const bytes = new TextEncoder().encode(content).length;
const clickDownload = () => act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
function response(value = content, headers: Record<string, string> = {}) {
  return { ok: true, status: 200, redirected: false, headers: new Headers({ 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(value).length), 'content-disposition': 'attachment', ...headers }), text: async () => value } as Response;
}
async function render(locale: 'en' | 'fr' = 'en', maxBytes = bytes) {
  await act(async () => root.render(createElement(AccountExport, { locale, maxBytes })));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
  vi.stubGlobal('Blob', class { size: number; constructor(parts: string[]) { this.size = new TextEncoder().encode(parts.join('')).length; } });
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['en', 'fr'] as const)('discloses partial coverage and prepares a verified UTF-8 download in %s', async locale => {
  await render(locale);
  const t = settingsUiCopy.account[locale];
  expect(container.textContent).toContain(t.exportCoverage);
  expect(container.textContent).toContain(t.exportExclusions);
  expect(container.querySelector('button')!.getAttribute('aria-describedby')).toContain('account-export-exclusions');
  let fileName = '';
  vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (this: HTMLAnchorElement) { fileName = this.download; });
  await clickDownload();
  expect(fetch).toHaveBeenCalledWith('/api/settings/account/export', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
  expect(fileName).toBe(t.exportFileName);
  expect(URL.createObjectURL).toHaveBeenCalledOnce(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  expect(container.querySelector('[role=status]')?.textContent).toBe(t.exportReady);
});
it('consumes configured bilingual labels from the existing Root catalog', async () => {
  const copy = settingsUiCopySchema.parse(settingsUiCopy);
  copy.account.fr.exportDownload = 'Copie personnelle partielle';
  await act(async () => root.render(createElement(SettingsCopyProvider, { copy, children: createElement(AccountExport, { locale: 'fr', maxBytes: bytes }) })));
  expect(container.querySelector('button')!.textContent).toBe('Copie personnelle partielle');
});
it('deduplicates pending downloads and aborts late results on unmount', async () => {
  let resolve!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(r => { resolve = r; }));
  await render(); await clickDownload(); await clickDownload();
  expect(fetch).toHaveBeenCalledOnce();
  expect(container.querySelector('button')!.disabled).toBe(true);
  expect(container.textContent).toContain(settingsUiCopy.account.en.exportPending);
  const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(response()));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it.each([
  ['HTML sign-in redirect', () => ({ ...response('<html>sign in</html>'), redirected: true })],
  ['invalid JSON', () => response('{')],
  ['full-coverage claim', () => response(JSON.stringify({ ...snapshot, coverage: { ...snapshot.coverage, complete: true } }))],
  ['wrong byte count', () => response(content, { 'content-length': String(bytes + 1) })],
  ['wrong MIME', () => response(content, { 'content-type': 'text/html' })],
  ['missing attachment', () => response(content, { 'content-disposition': 'inline' })],
] as const)('refuses an unconfirmed receipt: %s', async (_name, receipt) => {
  vi.mocked(fetch).mockResolvedValue(receipt() as Response);
  await render('en', bytes * 2); await clickDownload();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(container.querySelector('[role=alert]')?.textContent).toBe(settingsUiCopy.account.en.exportFailed);
  expect(document.activeElement).toBe(container.querySelector('[role=alert]'));
  expect(container.querySelector('button')!.disabled).toBe(false);
});
it('uses the server-provided archive byte ceiling', async () => {
  await render('en', bytes - 1); await clickDownload();
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(container.querySelector('[role=alert]')).not.toBeNull();
});
it.each([
  [401, 'unauthorized', 'exportSignIn'], [403, 'forbidden', 'exportForbidden'], [409, 'unavailable', 'exportUnavailable'], [502, 'upstream_failure', 'exportFailed'],
] as const)('shows safe French recovery for %s and allows retry', async (status, code, key) => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status, json: async () => ({ code, error: 'PRIVATE DATABASE FAILURE' }) } as Response);
  await render('fr'); await clickDownload();
  expect(container.querySelector('[role=alert]')?.textContent).toBe(settingsUiCopy.account.fr[key]);
  expect(container.textContent).not.toContain('PRIVATE');
  await clickDownload(); expect(container.querySelector('[role=status]')).not.toBeNull();
});
it('handles network failures without downloading and permits retry', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('private network details'));
  await render(); await clickDownload();
  expect(container.querySelector('[role=alert]')?.textContent).toBe(settingsUiCopy.account.en.exportFailed);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  await clickDownload(); expect(container.querySelector('[role=status]')).not.toBeNull();
});
