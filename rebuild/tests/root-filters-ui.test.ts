// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: deps.push }) }));
import { RootFilters, RootFilterSelect } from '../src/server/root/RootFilters';
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); window.history.replaceState({}, '', '/'); });
it('removes one filter, preserves the other scope and page size, and resets pagination', async () => {
  window.history.replaceState({}, '', '/root/activity?q=design&from=2026-10-01&limit=10&page=3&cursor=older');
  await act(async () => root.render(createElement(RootFilters, { title: 'Activity filters', route: '/root/activity', children: null, filters: [{ key: 'q', label: 'Search', value: 'design' }, { key: 'from', label: 'From', value: '2026-10-01' }] })));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove filter: Search design"]')!.click());
  expect(deps.push).toHaveBeenCalledWith('/root/activity?from=2026-10-01&limit=10');
  const reset = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Reset filters')!;
  await act(async () => reset.click()); expect(deps.push).toHaveBeenLastCalledWith('/root/activity');
});
it('retains an unavailable saved choice and submits its explicit correction through a hidden form field', async () => {
  await act(async () => root.render(createElement(RootFilterSelect, { name: 'state', label: 'State', initialValue: 'removed', options: [{ value: '', label: 'All' }, { value: 'connected', label: 'Connected' }] })));
  expect(container.querySelector('[role=combobox]')?.textContent).toContain('removed · Not available');
  expect(container.querySelector<HTMLInputElement>('input[name=state]')?.value).toBe('removed');
  await act(async () => container.querySelector<HTMLButtonElement>('[role=combobox]')!.click());
  const choice = [...container.querySelectorAll<HTMLButtonElement>('[role=option]')].find(option => option.textContent?.includes('Connected'))!;
  await act(async () => choice.click());
  expect(container.querySelector<HTMLInputElement>('input[name=state]')?.value).toBe('connected');
});
