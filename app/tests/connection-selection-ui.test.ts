// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from '../src/modules/settings/ui/connections/manager';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
vi.mock('../src/modules/settings/ui/settings.module.css', () => ({ default: {} }));
const labels = { connected: 'Connected', expired: 'Reconnect needed', revoked: 'Reconnect needed' };
const source = { id: 'source', provider: 'facebook', name: 'Example source', invalidatedAt: null, tokenExpiresAt: new Date('2020-01-01'), targets: [{ id: 'channel', name: 'Selected channel', type: 'page', enabled: true }, { id: 'other-channel', name: 'Unselected channel', type: 'page', enabled: false }], adAccounts: [{ id: 'ad', name: 'Selected ads', actId: 'example-ad', enabled: true }] };

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // JSDOM has no native modal API. Browser checks cover its focus behavior.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(ConnectionManager, { sources: [source], platforms: [], canManage: true, statusLabels: labels, initiallyOpen: true })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('connection selection recovery', () => {
  it('allows removing a selected expired channel and undoing that unsaved choice', async () => {
    const checkbox = container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(checkbox.checked).toBe(true);
    await act(async () => checkbox.click());
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);
    await act(async () => checkbox.click());
    expect(checkbox.checked).toBe(true);
  });

  it('does not write when all choices were restored', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Example recovery response' }) });
    vi.stubGlobal('fetch', fetch);
    const checkbox = container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    await act(async () => checkbox.click());
    await act(async () => checkbox.click());
    const save = [...container.querySelectorAll('button')].find(button => button.textContent === 'Save selections')!;
    await act(async () => save.click());
    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelector('dialog')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('keeps newly discovered unselected resources disabled until reconnection', () => {
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect(checkboxes[1]!.disabled).toBe(true);
    expect(checkboxes[2]!.disabled).toBe(false);
    expect(container.textContent).toContain('Reconnect needed');
  });
});

it.each(['retain', 'delete'] as const)('browser sends exact %s consent after final review', async mode => {
  await act(async () => root.unmount()); root = createRoot(container);
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ counts: { channels: 1 }, ok: true }) });
  vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(createElement(ConnectionManager, { sources: [source], platforms: [], canManage: true, statusLabels: labels, initialSourceId: 'source', initialAction: 'disconnect' })));
  const clickText = async (text: string) => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent === text)!;
    expect(button).toBeTruthy(); await act(async () => button.click());
  };
  if (mode === 'delete') {
    await act(async () => container.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]!.click());
    await clickText('Preview related rows');
  }
  const label = mode === 'retain' ? 'Disconnect and retain data' : 'Disconnect and delete data';
  await clickText(label);
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'DELETE')).toHaveLength(0);
  await clickText(label);
  const writes = fetch.mock.calls.filter(([, options]) => options.method === 'DELETE');
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0]![1].body)).toEqual({ socialAccountId: 'source', mode, confirmation: `DISCONNECT source ${mode === 'retain' ? 'RETAIN' : 'DELETE RELATED DATA'}` });
});

it('browser sends changed selections with the shared exact count confirmation', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, changed: 1 }) });
  vi.stubGlobal('fetch', fetch);
  await act(async () => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  const save = [...container.querySelectorAll('button')].find(button => button.textContent === 'Save selections')!;
  await act(async () => save.click());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe('/api/connections');
  expect(fetch.mock.calls[0]![1].method).toBe('PATCH');
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ items: [{ kind: 'target', id: 'channel', enabled: false }], confirmation: 'SET CONNECTION SELECTIONS 1' });
});

it.each(['en', 'fr'] as const)('renders discovered Instagram accounts with module branding in %s', async locale => {
  await act(async () => root.render(createElement(ConnectionManager, {
    sources: [{ ...source, provider: 'instagram', platformName: 'Instagram', tokenExpiresAt: null,
      targets: [{ id: 'ig-studio', name: 'Atelier Atlas', type: 'channel', enabled: false }], adAccounts: [] }],
    platforms: [], canManage: true, statusLabels: labels, initiallyOpen: true, locale,
  })));
  expect(container.querySelector('legend')?.textContent).toContain('Instagram');
  const choice = container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  expect(choice.closest('label')?.textContent).toContain('Atelier Atlas');
  expect(choice.checked).toBe(false); expect(choice.disabled).toBe(false);
  await act(async () => choice.click());
  expect(choice.checked).toBe(true);
});
