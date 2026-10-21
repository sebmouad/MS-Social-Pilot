// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/SidebarDock', () => ({ SidebarDock: ({ children }: { children: React.ReactNode }) => children }));

import { RootConfigForm } from '../src/app/root/config/root-config-form';
import { AVAILABILITY_CATALOG, safeConfigShape } from '../src/lib/config/registry';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const definitions = safeConfigShape().filter((item) => item.key === 'root.defaultWorkspaceTimezone' || item.key === 'root.activityPageSize');
const values = [
  { key: 'root.defaultWorkspaceTimezone', value: 'UTC', isSet: true, source: 'database' },
  { key: 'root.activityPageSize', value: 50, isSet: true, source: 'database' },
];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function render() {
  await act(async () => root.render(createElement(RootConfigForm, { definitions, initialValues: values, availability: AVAILABILITY_CATALOG })));
}
async function fill(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => { setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('Root configuration form writes', () => {
  it('opens the linked registration key through initial configuration search', async () => {
    const definitions = safeConfigShape().filter(setting => setting.owner.kind === 'shared');
    await act(async () => root.render(createElement(RootConfigForm, { definitions, initialValues: [], availability: AVAILABILITY_CATALOG, initialSearch: 'auth.openRegistration' })));
    expect(container.querySelector<HTMLInputElement>('#root-config-search')?.value).toBe('auth.openRegistration');
    expect(container.querySelectorAll('.root-config__card')).toHaveLength(1);
    expect(container.querySelector('.root-config__card')?.textContent).toContain('auth.openRegistration');
  });
  it('uses the module category names without repeating the platform group prefix', async () => {
    const scoped = safeConfigShape().filter(setting => setting.key === 'meta.appId' || setting.key === 'platforms.facebook.enabled');
    await act(async () => root.render(createElement(RootConfigForm, { definitions: scoped, initialValues: [], availability: { modules: [], features: [] }, groupPrefix: 'Facebook' })));
    const categories = container.querySelector('[aria-label="Configuration categories"]')!;
    expect(categories.textContent).toContain('Engine');
    expect(categories.textContent).toContain('API credentials');
    expect(categories.textContent).not.toContain('Facebook');
    const credentials = [...categories.querySelectorAll('button')].find(button => button.textContent === 'API credentials')!;
    await act(async () => credentials.click());
    expect(container.querySelector('input[aria-label="Meta app ID"]')).not.toBeNull();
  });
  it('preserves a draft on network failure and allows retry', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ values: [{ ...values[0], value: 'Africa/Casablanca' }, values[1]] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await render();
    const input = container.querySelector<HTMLInputElement>('input[aria-label="New workspace timezone"]')!;
    await fill(input, 'Africa/Casablanca');
    const save = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save')!;
    await act(async () => save.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/try again/i);
    expect(input.value).toBe('Africa/Casablanca');
    await act(async () => save.click());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(input.value).toBe('Africa/Casablanca');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saved.');
  });

  it('locks the affected setting while saving and ignores duplicate writes', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetch);
    await render();
    const save = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save')!;
    await act(async () => { save.click(); save.click(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(save.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saving…');
    await act(async () => resolveFetch(new Response(JSON.stringify({ values }), { status: 200 })));
    expect(save.disabled).toBe(false);
  });

  it('keeps the saved non-secret value visible after a successful save', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ values: [{ ...values[0], value: 'Africa/Casablanca' }, values[1]] }), { status: 200 })));
    await render();
    const input = container.querySelector<HTMLInputElement>('input[aria-label="New workspace timezone"]')!;
    await fill(input, 'Africa/Casablanca');
    const save = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save')!;
    await act(async () => save.click());
    expect(input.value).toBe('Africa/Casablanca');
  });

  it('shows a retry message when the server response is invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{', { status: 200 })));
    await render();
    const save = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save')!;
    await act(async () => save.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/try again/i);
  });
});


it('makes every registered setting reachable through owner-aware search', async () => {
  const all = safeConfigShape();
  await act(async () => root.render(createElement(RootConfigForm, { definitions: all, initialValues: [], availability: AVAILABILITY_CATALOG, groupByOwner: true })));
  const categories = container.querySelector('[aria-label="Configuration categories"]')!;
  expect(categories.textContent).toContain('Shared controls');
  expect(categories.textContent).toContain('Product · publishing');
  expect(categories.textContent).toContain('Platform · facebook');
  const search = container.querySelector<HTMLInputElement>('#root-config-search')!;
  for (const definition of all) {
    await fill(search, definition.key);
    expect([...container.querySelectorAll('code')].some(code => code.textContent === definition.key)).toBe(true);
  }
  await fill(search, 'Platform · facebook');
  expect(container.querySelectorAll('.root-config__card').length).toBe(all.filter(item => item.owner.kind === 'platform' && item.owner.id === 'facebook').length);
  await fill(search, 'no-such-setting-here');
  expect(container.querySelector('.root-config__empty')?.textContent).toContain('No matching settings.');
  expect(container.querySelector('.root-config__empty button')?.textContent).toBe('Reset filters');
});

it('renders configured operator text as plain text and preserves search placeholders', async () => {
  const { ROOT_CONFIG_COPY } = await import('../src/lib/config/root-config-copy');
  await act(async () => root.render(createElement(RootConfigForm, { definitions, initialValues: values, availability: AVAILABILITY_CATALOG, initialSearch: 'timezone', copy: { ...ROOT_CONFIG_COPY, find: 'Trouver un réglage', searchResults: 'Résultats : {search}', save: '<script>unsafe</script>' } })));
  expect(container.querySelector('label')?.textContent).toBe('Trouver un réglage');
  expect(container.querySelector('.root-config__content-head h2')?.textContent).toBe('Résultats : timezone');
  expect(container.querySelector('script')).toBeNull();
  expect([...container.querySelectorAll('button')].some(button => button.textContent === '<script>unsafe</script>')).toBe(true);
});

it('uses shared switches and selects, retaining the saved boolean after a failed write', async () => {
  const boolean = safeConfigShape().find(item => item.key === 'auth.openRegistration')!;
  const selection = safeConfigShape().find(item => item.kind === 'select' && (item.options?.length ?? 0) > 1)!;
  const fetch = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(createElement(RootConfigForm, { definitions: [boolean, selection], initialValues: [{ key: boolean.key, value: false, isSet: true, source: 'database' }], availability: AVAILABILITY_CATALOG, initialSearch: ' ' })));
  const switchButton = container.querySelector<HTMLButtonElement>('[role=switch]')!;
  expect(switchButton).not.toBeNull(); await act(async () => switchButton.click());
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ key: boolean.key, value: true, confirmation: `SET ROOT CONFIG ${boolean.key}` });
  expect(switchButton.getAttribute('aria-checked')).toBe('false');
  const search = container.querySelector<HTMLInputElement>('#root-config-search')!;
  await fill(search, selection.key);
  expect(container.querySelector('[role=combobox]')).not.toBeNull();
  expect(container.querySelector('select')).toBeNull();
});

it('rejects an empty number with associated field feedback before any request', async () => {
  const definition = safeConfigShape().find(item => item.key === 'root.activityPageSize')!;
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(createElement(RootConfigForm, { definitions: [definition], initialValues: values, availability: AVAILABILITY_CATALOG })));
  const input = container.querySelector<HTMLInputElement>('input[type=number]')!;
  await fill(input, '');
  const save = [...container.querySelectorAll('button')].find(button => button.textContent === 'Save')!;
  await act(async () => save.click());
  expect(fetch).not.toHaveBeenCalled(); expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('enter a finite number');
});

it('names the secret in a shared confirmation and retains the dialog on failure', async () => {
  const definition = safeConfigShape().find(item => item.key === 'meta.appSecret')!;
  const fetch = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(createElement(RootConfigForm, { definitions: [definition], initialValues: [{ key: definition.key, value: '', isSet: true, source: 'database' }], availability: AVAILABILITY_CATALOG })));
  const clear = [...container.querySelectorAll('button')].find(button => button.textContent === 'Clear saved secret')!;
  await act(async () => clear.click()); expect(fetch).not.toHaveBeenCalled();
  const dialog = document.querySelector('dialog')!;
  expect(dialog.textContent).toContain(definition.label);
  expect(dialog.textContent).toContain('Operations using it may stop');
  expect(document.activeElement?.textContent).toBe('Cancel');
  const confirm = [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Clear saved secret')!;
  await act(async () => confirm.click());
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ key: definition.key, value: '', clear: true, confirmation: `CLEAR ROOT SECRET ${definition.key}` });
  expect(document.querySelector('dialog [role=alert]')?.textContent).toContain('Could not clear');
});
