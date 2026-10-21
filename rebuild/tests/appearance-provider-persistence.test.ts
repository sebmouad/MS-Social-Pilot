// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '@/components/ThemeProvider';
import { ModeToggle } from '@/components/ModeToggle';
import { appearanceCopy } from '@/modules/settings/ui/appearance/copy';
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
let theme: ReturnType<typeof useTheme>;
function Probe() { theme = useTheme(); return createElement(ModeToggle); }
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.documentElement.dataset.theme = 'warm'; document.documentElement.dataset.mode = 'light';
  document.cookie = 'social-pilot-mode=light';
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn());
  await act(async () => root.render(createElement(ThemeProvider, { initialTheme: 'warm', initialMode: 'light', copy: appearanceCopy.fr, children: createElement(Probe) })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('saves a top-bar mode change through REST, blocks duplicate writes, then applies it', async () => {
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise(done => { resolve = done; }));
  const button = container.querySelector('button')!;
  expect(button.getAttribute('aria-label')).toContain('Apparence: Clair');
  await act(async () => button.click());
  expect(button.disabled).toBe(true); expect(button.getAttribute('aria-busy')).toBe('true');
  expect(document.documentElement.dataset.mode).toBe('light');
  await act(async () => button.click());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('/api/settings/appearance', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ theme: 'warm', mode: 'dark', confirmation: 'UPDATE APPEARANCE' }) }));
  await act(async () => resolve({ ok: true } as Response));
  expect(document.documentElement.dataset.mode).toBe('dark'); expect(button.disabled).toBe(false);
  // Cookie writes belong to the service response, not a fixed browser-side lifetime.
  expect(document.cookie).toContain('social-pilot-mode=light');
});
it('preserves the saved mode on rejection, gives localized feedback and permits retry', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response).mockResolvedValueOnce({ ok: true } as Response);
  const button = container.querySelector('button')!;
  await act(async () => button.click());
  expect(document.documentElement.dataset.mode).toBe('light');
  expect(container.querySelector('[role=alert]')?.textContent).toBe(appearanceCopy.fr.failed);
  await act(async () => button.click());
  expect(document.documentElement.dataset.mode).toBe('dark'); expect(container.querySelector('[role=alert]')).toBeNull();
});
it('persists theme changes and preserves the last committed mode', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
  await act(async () => { await theme.setTheme('clean'); });
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ theme: 'clean', mode: 'light', confirmation: 'UPDATE APPEARANCE' });
  await act(async () => { await theme.setMode('system'); });
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({ theme: 'clean', mode: 'system', confirmation: 'UPDATE APPEARANCE' });
});
it('keeps draft previews out of cookies and requests until explicitly saved', async () => {
  await act(async () => theme.previewAppearance({ theme: 'meta', mode: 'dark' }));
  expect(fetch).not.toHaveBeenCalled(); expect(document.cookie).toContain('social-pilot-mode=light');
  expect(document.documentElement.dataset.theme).toBe('meta');
  expect(document.documentElement.dataset.mode).toBe('dark');
});
