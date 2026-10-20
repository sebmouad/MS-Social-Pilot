// @vitest-environment jsdom
import { act, createElement as h, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Badge, Breadcrumbs, ConfirmDialog, DataTable, Drawer, EmptyState, Field, FileDropzone, FilterChips, FilterPanel, InlineEdit, Menu, MetricCard, PageHeader,
  SegmentedControl, Select, ShortcutHint, Switch, Tabs, TextInput, ToastProvider, useShortcut, useToast, formatChord,
} from '../src/components';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = (node: ReactNode) => act(async () => root.render(node));
const key = (target: Element, name: string, init: KeyboardEventInit = {}) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })); });
const click = (target: Element) => act(async () => { (target as HTMLElement).click(); });
const q = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
const active = () => document.activeElement as HTMLElement;

describe('Menu', () => {
  it('opens with the keyboard, moves with arrows, skips disabled items, selects and returns focus', async () => {
    const picked = vi.fn();
    await render(h(Menu, { label: 'Row actions', items: [
      { key: 'a', label: 'Edit', onSelect: () => picked('a') }, { key: 'b', label: 'Locked', disabled: true, disabledReason: 'Why', onSelect: () => picked('b') }, { key: 'c', label: 'Delete', danger: true, onSelect: () => picked('c') },
    ] }));
    const trigger = q('button[aria-haspopup=menu]');
    trigger.focus();
    await key(trigger, 'ArrowDown');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(active().textContent).toBe('Edit');
    await key(active(), 'ArrowDown');
    expect(active().textContent).toBe('Delete');
    await key(active(), 'ArrowDown');
    expect(active().textContent).toBe('Edit');
    await key(active(), 'End');
    await key(active(), 'Escape');
    expect(container.querySelector('[role=menu]')).toBeNull();
    expect(active()).toBe(trigger);
    await click(trigger);
    await click(container.querySelectorAll('[role=menuitem]')[1]!);
    expect(picked).not.toHaveBeenCalled();
    await click(container.querySelectorAll('[role=menuitem]')[2]!);
    expect(picked).toHaveBeenCalledWith('c');
    expect(active()).toBe(trigger);
  });
});

describe('Select', () => {
  const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta', disabled: true }, { value: 'c', label: 'Gamma' }];
  function Harness({ searchable = false }: { searchable?: boolean }) {
    const [value, setValue] = useState('a');
    return h(Select, { options, value, onChange: setValue, 'aria-label': 'Letter', searchable, name: 'letter' });
  }
  it('is a labelled combobox that opens, skips disabled options and commits with Enter', async () => {
    await render(h(Harness));
    const trigger = q('[role=combobox]');
    expect(trigger.getAttribute('aria-label')).toBe('Letter');
    expect(q<HTMLInputElement>('input[type=hidden]').value).toBe('a');
    trigger.focus();
    await key(trigger, 'ArrowDown');
    expect(container.querySelectorAll('[role=option]').length).toBe(3);
    await key(trigger, 'ArrowDown');
    await key(trigger, 'Enter');
    expect(trigger.textContent).toContain('Gamma');
    expect(q<HTMLInputElement>('input[type=hidden]').value).toBe('c');
    expect(container.querySelector('[role=listbox]')).toBeNull();
    expect(active()).toBe(trigger);
  });
  it('closes on Escape without changing the value and filters when searchable', async () => {
    await render(h(Harness, { searchable: true }));
    const trigger = q('button[role=combobox]');
    await click(trigger);
    const input = q<HTMLInputElement>('.ui-select__search input');
    expect(active()).toBe(input);
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(input, 'gam'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(container.querySelectorAll('[role=option]').length).toBe(1);
    await key(input, 'Escape');
    expect(container.querySelector('[role=listbox]')).toBeNull();
    expect(trigger.textContent).toContain('Alpha');
    expect(active()).toBe(trigger);
  });
});

describe('Tabs', () => {
  it('moves and activates with arrows, keeps one tab stop and shows the matching panel', async () => {
    await render(h(Tabs, { label: 'Sections', items: [{ id: 'one', label: 'One', count: 3, content: 'First panel' }, { id: 'two', label: 'Two', disabled: true }, { id: 'three', label: 'Three', content: 'Third panel' }] }));
    const tabs = container.querySelectorAll<HTMLElement>('[role=tab]');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect([...tabs].filter(tab => tab.tabIndex === 0).length).toBe(1);
    expect(q('[role=tabpanel]').textContent).toBe('First panel');
    tabs[0]!.focus();
    await key(tabs[0]!, 'ArrowRight');
    expect(tabs[2]!.getAttribute('aria-selected')).toBe('true');
    expect(active()).toBe(tabs[2]);
    expect(q('[role=tabpanel]').textContent).toBe('Third panel');
    expect(q('[role=tabpanel]').getAttribute('aria-labelledby')).toBe(tabs[2]!.id);
    await key(tabs[2]!, 'Home');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('DataTable (round 2)', () => {
  type Row = { id: string; name: string };
  const rows: Row[] = [{ id: '1', name: 'Alpha' }, { id: '2', name: 'Beta' }];
  const columns = [{ key: 'name', label: 'Name', sortable: true, render: (row: Row) => row.name }];
  it('adds labelled selection, indeterminate select-all and a row menu without changing the default markup contract', async () => {
    const change = vi.fn(); const edit = vi.fn();
    await render(h(DataTable<Row>, { columns, rows, rowKey: row => row.id, caption: 'People', selection: { selected: ['1'], onChange: change, rowLabel: row => `Select ${row.name}`, selectAllLabel: 'Select all people' },
      rowActions: row => [{ key: 'edit', label: 'Edit', onSelect: () => edit(row.id) }], rowActionsLabel: row => `Actions for ${row.name}` }));
    const all = q<HTMLInputElement>('thead input[type=checkbox]');
    expect(all.getAttribute('aria-label')).toBe('Select all people');
    expect(all.indeterminate).toBe(true);
    expect(container.querySelectorAll('tbody tr')[0]!.getAttribute('aria-selected')).toBe('true');
    await click(q('input[aria-label="Select Beta"]'));
    expect(change).toHaveBeenCalledWith(['1', '2']);
    await click(all);
    expect(change).toHaveBeenLastCalledWith(['1', '2']);
    await click(q('button[aria-label="Actions for Beta"]'));
    await click(q('[role=menuitem]'));
    expect(edit).toHaveBeenCalledWith('2');
    expect(container.querySelector('td[data-label="Name"]')).not.toBeNull();
  });
  it('shows sort state with an icon button and aria-sort, and an icon empty state', async () => {
    const onChange = vi.fn();
    await render(h(DataTable<Row>, { columns, rows: [], rowKey: row => row.id, caption: 'People', sort: { key: 'name', direction: 'ascending', onChange }, emptyMessage: 'No people yet', emptyAction: h('a', { href: '/new' }, 'Invite') }));
    expect(q('th').getAttribute('aria-sort')).toBe('ascending');
    expect(q('th svg')).not.toBeNull();
    await click(q('.ui-table__sort'));
    expect(onChange).toHaveBeenCalledWith('name');
    expect(q('.ui-table-empty svg')).not.toBeNull();
    expect(container.textContent).toContain('No people yet');
  });
});

describe('Toast', () => {
  function Trigger() { const toast = useToast(); return h('button', { onClick: () => toast.undoable('Post deleted', () => (globalThis as { undone?: boolean }).undone = true, 'Undo') }, 'go'); }
  it('announces, offers undo, runs it once and dismisses', async () => {
    await render(h(ToastProvider, null, h(Trigger)));
    await click(q('button'));
    const toast = q('.ui-toast');
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.textContent).toContain('Post deleted');
    await click(q('.ui-toast__action'));
    expect((globalThis as { undone?: boolean }).undone).toBe(true);
    expect(container.querySelector('.ui-toast')).toBeNull();
  });
  it('errors use role=alert and stay until dismissed when they carry retry', async () => {
    vi.useFakeTimers();
    function Fail() { const toast = useToast(); return h('button', { onClick: () => toast.failed('Could not save', () => undefined, 'Retry') }, 'fail'); }
    await render(h(ToastProvider, null, h(Fail)));
    await click(q('button'));
    expect(q('.ui-toast').getAttribute('role')).toBe('alert');
    await act(async () => { vi.advanceTimersByTime(60000); });
    expect(container.querySelector('.ui-toast')).not.toBeNull();
    vi.useRealTimers();
  });
  it('is a safe no-op outside a provider', async () => {
    await render(h(Trigger));
    await click(q('button'));
    expect(container.querySelector('.ui-toast')).toBeNull();
  });
});

describe('Forms', () => {
  it('Field wires label, help and error to the control and marks it invalid', async () => {
    await render(h(Field, { label: 'Email', help: 'We never share it', error: 'Enter a valid email', required: true, children: h(TextInput, { leading: h('i'), defaultValue: 'x' }) }));
    const input = q<HTMLInputElement>('input');
    expect(container.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-required')).toBe('true');
    const described = input.getAttribute('aria-describedby')!.split(' ');
    expect(described.length).toBe(2);
    expect(document.getElementById(described[1]!)!.getAttribute('role')).toBe('alert');
    expect(input.value).toBe('x');
  });
  it('Switch toggles through role=switch and is described', async () => {
    const onChange = vi.fn();
    await render(h(Switch, { checked: false, onChange, label: 'Auto-publish', description: 'Posts go out on time' }));
    const toggle = q('[role=switch]');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.getAttribute('aria-describedby')).not.toBeNull();
    await click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
  it('SegmentedControl never wraps (one grid row), has one tab stop and moves with arrows', async () => {
    const onChange = vi.fn();
    await render(h(SegmentedControl, { legend: 'Range', value: '7', onChange, options: [{ value: '7', label: '7 days' }, { value: '28', label: '28 days' }, { value: '90', label: '90 days' }] }));
    const group = q('[role=radiogroup]');
    expect(group.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    const radios = container.querySelectorAll<HTMLElement>('[role=radio]');
    expect([...radios].filter(radio => radio.tabIndex === 0).length).toBe(1);
    radios[0]!.focus();
    await key(radios[0]!, 'ArrowRight');
    expect(onChange).toHaveBeenCalledWith('28');
  });
  it('FileDropzone accepts dropped files and lists chosen files with a named remove button', async () => {
    const onFiles = vi.fn(); const onRemove = vi.fn();
    await render(h(FileDropzone, { onFiles, label: 'Drop images or browse', help: 'PNG up to 5 MB', files: [{ id: 'f1', name: 'cover.png' }], onRemove }));
    const zone = q('.ui-dropzone');
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await act(async () => { const event = new Event('drop', { bubbles: true, cancelable: true }); Object.assign(event, { dataTransfer: { files: [file] } }); zone.dispatchEvent(event); });
    expect(onFiles).toHaveBeenCalledWith([file]);
    await click(q('button[aria-label="Remove cover.png"]'));
    expect(onRemove).toHaveBeenCalledWith('f1');
  });
});

describe('Filters', () => {
  it('FilterChips name each filter, remove one and render nothing when empty', async () => {
    const onRemove = vi.fn();
    await render(h(FilterChips, { filters: [{ key: 'ch', label: 'Channel', value: 'Studio' }], onRemove }));
    await click(q('button[aria-label="Remove filter: Channel Studio"]'));
    expect(onRemove).toHaveBeenCalledWith('ch');
    await render(h(FilterChips, { filters: [], onRemove }));
    expect(container.innerHTML).toBe('');
  });
  it('FilterPanel disables reset until a filter is active', async () => {
    const onReset = vi.fn();
    await render(h(FilterPanel, { title: 'Filters', onReset, activeCount: 0, children: 'body' }));
    expect(q<HTMLButtonElement>('.ui-filter-panel__reset').disabled).toBe(true);
    await render(h(FilterPanel, { title: 'Filters', onReset, activeCount: 2, children: 'body' }));
    await click(q('.ui-filter-panel__reset'));
    expect(onReset).toHaveBeenCalled();
  });
});

describe('Display components', () => {
  it('PageHeader renders a module chip, one h1, description and actions', async () => {
    await render(h(PageHeader, { title: 'Posts', description: 'All your posts', module: 'publishing', actions: h('button', null, 'New post') }));
    expect(container.querySelectorAll('h1').length).toBe(1);
    expect(q('header').getAttribute('data-module')).toBe('publishing');
    expect(q('.ui-mod-chip svg')).not.toBeNull();
    expect(container.textContent).toContain('New post');
  });
  it('Breadcrumbs mark the last item as the current page and link the rest', async () => {
    await render(h(Breadcrumbs, { items: [{ label: 'Settings', href: '/settings' }, { label: 'Team' }] }));
    expect(q('nav').getAttribute('aria-label')).toBe('Breadcrumb');
    expect(container.querySelectorAll('a').length).toBe(1);
    expect(q('[aria-current=page]').textContent).toBe('Team');
  });
  it('MetricCard states direction in text, colors by meaning and treats unknown as not zero', async () => {
    await render(h(MetricCard, { label: 'Cost per click', value: '€0.42', module: 'ads', delta: { label: '-8%', direction: 'down', good: 'down', comparedTo: 'vs previous 28 days' } }));
    expect(q('.ui-metric__delta').className).toContain('is-good');
    expect(q('.ui-metric__delta').textContent).toContain('-8%');
    await render(h(MetricCard, { label: 'Reach', value: '0', unavailable: 'Not reported for this period' }));
    expect(q('.ui-metric__value').textContent).toContain('Not reported for this period');
    expect(q('.ui-metric__value').textContent).not.toContain('0');
    await render(h(MetricCard, { label: 'Reach', value: '1', loading: true, loadingLabel: 'Loading reach' }));
    expect(q('article').getAttribute('aria-busy')).toBe('true');
  });
  it('Badge and EmptyState render icons without making them accessible content', async () => {
    await render(h('div', null, h(Badge, { tone: 'module', module: 'inbox', icon: h('i'), children: 'Inbox' }),h(EmptyState, { title: 'No posts', icon: h('i') }, 'Create one')));
    expect(q('.ui-badge').getAttribute('data-module')).toBe('inbox');
    expect(q('.ui-badge__icon').getAttribute('aria-hidden')).toBe('true');
    expect(q('.ui-state__icon').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Dialogs', () => {
  it('ConfirmDialog names the object and consequence, focuses Cancel, and keeps open with the error when the action fails', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn(async () => 'Could not delete. Nothing was changed.');
    await render(h(ConfirmDialog, { open: true, title: 'Delete post', objectName: 'Spring launch', consequence: 'It is removed from all channels.', confirmLabel: 'Delete', cancelLabel: 'Cancel', failureLabel: 'Failed', onConfirm, onClose }));
    expect(container.textContent).toContain('Spring launch');
    expect(container.textContent).toContain('It is removed from all channels.');
    expect(active().hasAttribute('data-dialog-cancel')).toBe(true);
    await click(q('.ui-button--danger'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(q('[role=alert]').textContent).toBe('Could not delete. Nothing was changed.');
    expect(onClose).not.toHaveBeenCalled();
  });
  it('Drawer is a labelled modal with a named close button', async () => {
    const onClose = vi.fn();
    await render(h(Drawer, { open: true, title: 'Post details', onClose, closeLabel: 'Close details', children: 'body' }));
    expect(q('dialog').getAttribute('aria-labelledby')).not.toBeNull();
    await click(q('button[aria-label="Close details"]'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Shortcuts and inline edit', () => {
  it('formatChord uses platform keys and ShortcutHint is a labelled keycap', async () => {
    expect(formatChord('mod+k', true)).toBe('⌘K');
    expect(formatChord('mod+k', false)).toBe('Ctrl+K');
    expect(formatChord('g p', false)).toBe('G then P');
    await render(h(ShortcutHint, { chord: 'shift+?', label: 'Show shortcuts' }));
    expect(q('kbd').getAttribute('aria-label')).toBe('Show shortcuts');
  });
  it('useShortcut fires for sequences, and ignores plain keys typed into fields', async () => {
    const run = vi.fn();
    function Host() { useShortcut('g p', run); return h('input', { 'aria-label': 'x' }); }
    await render(h(Host));
    await key(document.body, 'g'); await key(document.body, 'p');
    expect(run).toHaveBeenCalledTimes(1);
    const input = q('input');
    await key(input, 'g'); await key(input, 'p');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('InlineEdit saves with Enter, keeps the draft and message on failure, cancels with Escape and returns focus', async () => {
    const onSave = vi.fn(async (value: string) => value === 'bad' ? 'Name is taken' : null);
    await render(h(InlineEdit, { value: 'Studio', label: 'channel name', onSave }));
    const edit = q('button[aria-label="Edit channel name"]');
    await click(edit);
    const input = q<HTMLInputElement>('input');
    expect(active()).toBe(input);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'bad'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await key(input, 'Enter');
    expect(onSave).toHaveBeenCalledWith('bad');
    expect(q('[role=alert]').textContent).toBe('Name is taken');
    expect(q<HTMLInputElement>('input').value).toBe('bad');
    await key(q('input'), 'Escape');
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).toContain('Studio');
    expect(active().getAttribute('aria-label')).toBe('Edit channel name');
  });
});
