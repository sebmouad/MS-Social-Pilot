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
