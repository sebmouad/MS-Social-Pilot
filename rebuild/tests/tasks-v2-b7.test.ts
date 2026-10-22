// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { TaskFilters } from '@/modules/tasks/ui/TaskFilters';
import { ShellCopyProvider } from '@/components/ShellCopy';
import { SHELL_COPY, type ShellCopy } from '@/modules/shell/copy';

let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('opens the French filter sheet with applied values and preserves the list layout on submission', async () => {
  await act(async () => root.render(createElement(ShellCopyProvider, { copy: SHELL_COPY.fr as unknown as ShellCopy, children: createElement(TaskFilters, {
    locale: 'fr', values: { q: 'Launch', status: 'doing', assignee: 'me', overdue: true, view: 'board' }, assignees: [], assigneesHasMore: false,
  }) })));
  const trigger = container.querySelector<HTMLButtonElement>('.ui-filter-button')!;
  expect(trigger.textContent).toContain('Filtrer');
  expect(container.querySelector('form')).toBeNull();
  await act(async () => trigger.click());
  const form = container.querySelector<HTMLFormElement>('form')!;
  expect(form.getAttribute('action')).toBe('/tasks');
  expect(form.getAttribute('aria-label')).toBe('Filtres des tâches');
  expect(new FormData(form).get('q')).toBe('Launch');
  expect(new FormData(form).get('status')).toBe('doing');
  expect(new FormData(form).get('assignee')).toBe('me');
  expect(new FormData(form).get('overdue')).toBe('true');
  expect(new FormData(form).get('view')).toBe('board');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(container.querySelector('form')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
