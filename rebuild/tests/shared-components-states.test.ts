// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Button, DataTable, EmptyState, Skeleton } from '../src/components';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = (node: Parameters<typeof root.render>[0]) => act(async () => root.render(node));

describe('shared component states', () => {
  it('Button stays enabled and unannounced by default, and blocks activation while busy', async () => {
    await render(createElement(Button, null, 'Save'));
    const idle = container.querySelector('button')!;
    expect(idle.disabled).toBe(false);
    expect(idle.hasAttribute('aria-busy')).toBe(false);
    await render(createElement(Button, { busy: true }, 'Save'));
    const busy = container.querySelector('button')!;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
  });

  it('DataTable keeps its existing empty message and adds an optional action', async () => {
    const columns = [{ key: 'name', label: 'Name', render: (row: { name: string }) => row.name }];
    await render(createElement(DataTable<{ name: string }>, { columns, rows: [], rowKey: row => row.name, caption: 'People' }));
    expect(container.textContent).toContain('Nothing to show yet.');
    await render(createElement(DataTable<{ name: string }>, { columns, rows: [], rowKey: row => row.name, caption: 'People', emptyAction: createElement('a', { href: '/new' }, 'Add one') }));
    expect(container.querySelector('a[href="/new"]')).not.toBeNull();
  });

  it('DataTable shows busy placeholder rows instead of the empty message while loading', async () => {
    const columns = [{ key: 'name', label: 'Name', render: (row: { name: string }) => row.name }];
    await render(createElement(DataTable<{ name: string }>, { columns, rows: [], rowKey: row => row.name, caption: 'People', loading: true, loadingLabel: 'Loading people' }));
    expect(container.querySelector('[role=region]')!.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('tbody tr').length).toBe(5);
    expect(container.textContent).toContain('Loading people');
    expect(container.textContent).not.toContain('Nothing to show yet.');
  });

  it('DataTable applies compact density only when asked', async () => {
    const columns = [{ key: 'name', label: 'Name', render: (row: { name: string }) => row.name }];
    await render(createElement(DataTable<{ name: string }>, { columns, rows: [{ name: 'A' }], rowKey: row => row.name, caption: 'People', density: 'compact' }));
    expect(container.querySelector('table')!.className).toContain('ui-table--compact');
  });

  it('EmptyState announces errors only', async () => {
    await render(createElement(EmptyState, { title: 'No posts' }, 'Create your first post.'));
    expect(container.querySelector('[role=alert]')).toBeNull();
    await render(createElement(EmptyState, { title: 'Could not load', tone: 'error' }, 'Try again.'));
    expect(container.querySelector('[role=alert]')).not.toBeNull();
  });

  it('Skeleton exposes one accessible loading label and hides its placeholder lines', async () => {
    await render(createElement(Skeleton, { lines: 4, label: 'Chargement…' }));
    expect(container.querySelector('[role=status]')!.textContent).toBe('Chargement…');
    expect(container.querySelectorAll('.ui-skeleton[aria-hidden="true"]').length).toBe(4);
  });
});
