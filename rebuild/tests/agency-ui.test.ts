// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceAction } from '../src/modules/agency/ui/WorkspaceAction';
import { AgencyFilters, ClientFilters } from '../src/modules/agency/ui/AgencyFilters';
import { SidebarDockContext } from '../src/components/SidebarDock';

let root: ReturnType<typeof createRoot>, container: HTMLDivElement, dock: HTMLDivElement;
const assign = vi.fn();
const click = (element: HTMLElement) => act(async () => { element.click(); });
const render = (node: Parameters<typeof root.render>[0]) => act(async () => root.render(node));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); dock = document.createElement('div');
  document.body.append(container, dock); root = createRoot(container);
  assign.mockReset(); vi.stubGlobal('fetch', vi.fn());
  Object.defineProperty(window, 'location', { configurable: true, value: { assign } });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); dock.remove(); vi.unstubAllGlobals(); });

const action = () => createElement(WorkspaceAction, { workspaceId: 'w2', workspaceName: 'Acme', href: '/settings/connections', label: 'Fix connections' });

describe('Agency workspace action', () => {
  it('selects exactly the chosen workspace in the session, then opens the destination', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    await render(action());
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Fix connections: Acme');
    await click(button);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/workspaces/select');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ workspaceId: 'w2', confirmation: 'SELECT WORKSPACE w2' });
    expect(assign).toHaveBeenCalledWith('/settings/connections');
  });

  it('keeps the person on the page with a recoverable error when the switch is refused, and retries', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403 } as Response);
    await render(action());
    const button = container.querySelector('button')!;
    await click(button);
    expect(assign).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not switch to Acme');
    expect(button.disabled).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    await click(button);
    expect(assign).toHaveBeenCalledWith('/settings/connections');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('treats a network failure like a refusal', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
    await render(action());
    await click(container.querySelector('button')!);
    expect(assign).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Check your connection');
  });
});

describe('Agency v2 header filters', () => {
  const inDock = (node: Parameters<typeof root.render>[0]) => createElement(SidebarDockContext.Provider, { value: dock }, node);

  it('opens overview filters in the header popover and retains applied values', async () => {
    await render(inDock(createElement(AgencyFilters, { values: { q: 'acm', sort: 'failed', order: 'asc', attention: true }, searchLimit: 40 })));
    expect(container.querySelector('form')).toBeNull();
    await click(container.querySelector<HTMLElement>('.ui-filter-button')!);
    const form = container.querySelector('form[aria-label="Workspace filters"]')!;
    expect(dock.innerHTML).toBe('');
    expect(form.getAttribute('method')).toBe('get');
    const search = form.querySelector<HTMLInputElement>('input[name="q"]')!;
    expect(search.value).toBe('acm'); expect(search.maxLength).toBe(40); expect(search.placeholder).toBe('Workspace name');
    expect(form.querySelector<HTMLInputElement>('input[name="sort"]')!.value).toBe('failed');
    expect(form.querySelector<HTMLInputElement>('input[name="order"]')!.value).toBe('asc');
    expect(form.querySelector<HTMLInputElement>('input[name="attention"]')!.checked).toBe(true);
    expect(form.querySelector('a[href="/agency"]')).not.toBeNull();
  });

  it('works without the transitional Page tools dock and returns focus on Escape', async () => {
    await render(createElement(AgencyFilters, { values: { q: '', sort: 'attention', order: 'desc', attention: false }, searchLimit: 40 }));
    const trigger = container.querySelector<HTMLButtonElement>('.ui-filter-button')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await click(trigger);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(dock.innerHTML).toBe('');
  });

  it('client search only promises workspace names', async () => {
    await render(inDock(createElement(ClientFilters, { q: 'acm', searchLimit: 25 })));
    await click(container.querySelector<HTMLElement>('.ui-filter-button')!);
    const form = container.querySelector('form[aria-label="Client filters"]')!;
    expect(form.getAttribute('action')).toBe('/agency/clients');
    const search = form.querySelector<HTMLInputElement>('input[name="q"]')!;
    expect(search.placeholder).toBe('Workspace name'); expect(search.maxLength).toBe(25);
    expect(form.textContent).not.toMatch(/email/i);
  });
});

// The quick switch reuses the existing session-selection service rather than constructing another authority path.
it('quick-switches only to an explicitly selected workspace from the scoped list', async () => {
  const { WorkspaceQuickSwitch } = await import('../src/modules/agency/ui/WorkspaceQuickSwitch');
  vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
  await render(createElement(SidebarDockContext.Provider, { value: dock }, createElement(WorkspaceQuickSwitch, { locale: 'fr', workspaces: [{ id: 'w2', name: 'Acme' }] })));
  expect(container.textContent).toContain('Changer d’espace');
  expect(container.querySelector('.ui-button')).toBeNull();
  await click(container.querySelector<HTMLElement>('[role="combobox"]')!);
  const choice = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === 'Acme')!;
  await click(choice);
  await click(container.querySelector<HTMLElement>('button[aria-label="Ouvrir l’espace: Acme"]')!);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ workspaceId: 'w2', confirmation: 'SELECT WORKSPACE w2' });
  expect(assign).toHaveBeenCalledWith('/home');
});
