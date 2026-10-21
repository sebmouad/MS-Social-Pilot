// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tabs } from '../src/components/Tabs';
import { FileDropzone, SegmentedControl } from '../src/components/Forms';
import { Select } from '../src/components/Select';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = (node: Parameters<typeof root.render>[0]) => act(async () => root.render(node));

it('keeps an enabled tab reachable when selection is removed or disabled and references only mounted panels', async () => {
  const items = [{ id: 'old', label: 'Old', disabled: true }, { id: 'new', label: 'New', content: 'Details' }, { id: 'link', label: 'External' }];
  await render(h(Tabs, { items, value: 'old', label: 'Views' }));
  const current = container.querySelector<HTMLButtonElement>('[role=tab][tabindex="0"]')!;
  expect(current.textContent).toBe('New');
  expect(document.getElementById(current.getAttribute('aria-controls')!)?.textContent).toBe('Details');
  expect(container.querySelector('[role=tab]:last-child')?.hasAttribute('aria-controls')).toBe(false);
  await render(h(Tabs, { items, value: 'removed', label: 'Views' }));
  expect(container.querySelector('[role=tab][tabindex="0"]')?.textContent).toBe('New');
});

it('does not throw when all tabs are disabled', async () => {
  await render(h(Tabs, { items: [{ id: 'x', label: 'Disabled', disabled: true }], label: 'Views' }));
  await act(async () => { container.querySelector('[role=tablist]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); });
  expect(container.querySelector('[role=tab][tabindex="0"]')).toBeNull();
});

it('keeps segmented choices keyboard reachable when the stored choice is unavailable', async () => {
  const onChange = vi.fn();
  await render(h(SegmentedControl, { options: [{ value: 'old', label: 'Old', disabled: true }, { value: 'new', label: 'New' }, { value: 'last', label: 'Last' }], value: 'old', onChange, legend: 'Period' }));
  const radio = container.querySelector<HTMLButtonElement>('[role=radio][tabindex="0"]')!;
  expect(radio.textContent).toBe('New');
  await act(async () => radio.click());
  expect(onChange).toHaveBeenCalledWith('new');
  await act(async () => radio.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  expect(onChange).toHaveBeenLastCalledWith('last');
  expect(document.activeElement?.textContent).toBe('Last');
});

it('names the native file input, associates help and blocks it while upload is busy', async () => {
  await render(h(FileDropzone, { label: 'Choisir des images', help: 'PNG ou JPEG', onFiles: vi.fn(), busy: true }));
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  expect(input.getAttribute('aria-label')).toBe('Choisir des images');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('PNG ou JPEG');
  expect(input.disabled).toBe(true);
});

it('announces an empty select search without moving focus away from the search field', async () => {
  await render(h(Select, { options: [], value: '', onChange: vi.fn(), searchable: true, 'aria-label': 'Canal', noMatchLabel: 'Aucun résultat' }));
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  const feedback = container.querySelector('[role=status]')!;
  expect(feedback.textContent).toBe('Aucun résultat');
  expect(feedback.getAttribute('aria-live')).toBe('polite');
  expect(document.activeElement).toBe(container.querySelector('input[role=combobox]'));
});
