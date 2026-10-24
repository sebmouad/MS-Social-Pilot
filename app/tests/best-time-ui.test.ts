// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BestTimeSuggestions } from '@/modules/publishing/ui/compose/BestTimeSuggestions';
const fetcher = vi.fn();
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const onChoose = vi.fn();
const suggestion = { nextAt: '2026-10-27T08:00:00Z', date: '2026-10-27', time: '08:00', dayOfWeek: 2, hour: 8, minute: 0, posts: 3, lift: 2 };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', fetcher); vi.useFakeTimers(); fetcher.mockReset(); onChoose.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(ids = ['a'], locale: 'en' | 'fr' = 'en') { await act(async () => root.render(createElement(BestTimeSuggestions, { targetIds: ids, locale, disabled: false, onChoose }))); }
async function load() { await act(async () => { await vi.advanceTimersByTimeAsync(250); }); }
it('shows an English suggestion and only fills scheduling fields when selected', async () => {
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ mode: 'apply', timeZone: 'UTC', suggestions: [suggestion] }) });
  await render(); await load();
  expect(container.textContent).toContain('Suggested times');
  expect(onChoose).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  expect(onChoose).toHaveBeenCalledWith({ date: '2026-10-27', time: '08:00' });
  expect(fetcher.mock.calls[0]![0]).toBe('/api/publishing/best-times?targetId=a');
});
it('uses French copy, no fabricated time on unknown data, and offers retry after failure', async () => {
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ mode: 'suggest', timeZone: 'UTC', suggestions: [] }) });
  await render(['a'], 'fr'); await load();
  expect(container.textContent).toContain('Non disponible'); expect(container.querySelector('button')).toBeNull();
  fetcher.mockRejectedValueOnce(new Error('offline'));
  await render(['b'], 'fr'); await load();
  expect(container.textContent).toContain('Réessayer');
});
it('explains each slot and reports per-channel unknowns with their reason', async () => {
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ mode: 'suggest', timeZone: 'UTC', windowDays: 90, suggestions: [], perTarget: [
    { targetId: 'a', name: 'Page A', basis: 12, reason: 'ok', slots: [{ ...suggestion, label: 'Tue 08:00' }] },
    { targetId: 'b', name: 'Page B', basis: 4, reason: 'insufficient_history', slots: [] },
  ] }) });
  await render(['a', 'b']); await load();
  expect(container.textContent).toContain('Not available');
  expect(container.textContent).toContain('Page A');
  expect(container.textContent).toContain('3 posts at this time');
  expect(container.textContent).toContain('Unknown: too few measured posts (4 measured).');
  await act(async () => container.querySelectorAll<HTMLButtonElement>('details button')[0]!.click());
  expect(onChoose).toHaveBeenCalledWith({ date: '2026-10-27', time: '08:00' });
});
it('hides stale suggestions immediately when destinations change and ignores late responses', async () => {
  let resolve!: (value: unknown) => void;
  fetcher.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ mode: 'suggest', timeZone: 'UTC', suggestions: [] }) });
  await render(['a']); await load();
  await render(['b']); await load();
  await act(async () => resolve({ ok: true, json: async () => ({ timeZone: 'UTC', mode: 'apply', suggestions: [suggestion] }) }));
  expect(container.querySelector('button')).toBeNull(); expect(container.textContent).toContain('Not available');
  await render([]); await load(); expect(fetcher).toHaveBeenCalledTimes(2);
});
