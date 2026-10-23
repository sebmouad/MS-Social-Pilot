// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdSetCreatePicker, AdCreatePicker } from '../src/modules/ads/ui/objects/ManageCreatePickers';
import { CreativesBrowser } from '../src/modules/ads/ui/objects/CreativesBrowser';
import type { AdsUiSchema } from '../src/platforms/ads-ui';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const dialog = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void; close?: () => void };
dialog.showModal ??= function () { this.setAttribute('open', ''); };
dialog.close ??= function () { this.removeAttribute('open'); };

const adSetConfig: NonNullable<AdsUiSchema['adSet']> = {
  title: 'Create {campaignName} set', description: 'Provider-owned setup', nameLabel: 'Set name', nameMaxLength: 40,
  budgetLabel: 'Spend per day', countryLabel: 'Country', goalLabel: 'Delivery goal', actionLabel: 'Prepare set',
  confirmTitle: 'Prepare this set?', confirmDescription: 'Starts paused.',
  options: [{ value: 'clicks', label: 'Clicks' }], defaultOption: 'clicks',
  confirmationTemplate: 'PREPARE {nameJson} UNDER {campaignId}',
};

function response(body: unknown, ok = true) { return { ok, json: async () => body }; }
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function render(node: React.ReactElement) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(node));
  await settle();
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label));
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

describe('manage creation pickers', () => {
  const ownerScope = { userId: 'user-1', workspaceId: 'workspace-1' };

  it('renders one ad-set form under the chosen stored campaign', async () => {
    await render(createElement(AdSetCreatePicker, { adAccountId: 'account-1', currency: 'USD', config: adSetConfig, ownerScope,
      campaigns: [{ id: 'c1', name: 'Spring' }, { id: 'c2', name: 'Summer' }] }));
    const select = container.querySelector('select');
    expect([...select!.querySelectorAll('option')].map(option => option.textContent)).toEqual(['Spring', 'Summer']);
    expect(container.querySelector('form')?.getAttribute('aria-label')).toContain('Spring');
    await act(async () => { select!.value = 'c2'; select!.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    expect(container.querySelector('form')?.getAttribute('aria-label')).toContain('Summer');
  });

  it('explains a missing parent instead of rendering a parentless form', async () => {
    await render(createElement(AdSetCreatePicker, { adAccountId: 'account-1', currency: 'USD', config: adSetConfig, ownerScope, campaigns: [] }));
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('No campaigns are stored for this account yet.');
    await render(createElement(AdCreatePicker, { adAccountId: 'account-1', adSets: [], nameMaxCharacters: 40 }));
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('No ad sets are stored for this account yet.');
  });

  it('renders one paused-ad form under the chosen stored ad set', async () => {
    await render(createElement(AdCreatePicker, { adAccountId: 'account-1', nameMaxCharacters: 40,
      adSets: [{ id: 's1', name: 'Set one' }, { id: 's2', name: 'Set two' }] }));
    expect([...container.querySelectorAll('option')].map(option => option.textContent)).toEqual(['Set one', 'Set two']);
    expect(container.querySelector('form')?.getAttribute('aria-label')).toContain('Set one');
  });
});

describe('creatives browser', () => {
  const accounts = [{ id: 'account-1', name: 'Example account' }];

  it('loads nothing until asked, then lists previews with status', async () => {
    fetchMock.mockImplementation(async () => response({ items: [
      { id: 'cr1', name: 'Hero', status: 'ACTIVE', title: 'Hello', body: 'World', thumbnailUrl: 'https://example.test/thumb.png' },
      { id: 'cr2', name: null, status: null, title: null, body: null, thumbnailUrl: null },
    ], next: null }));
    await render(createElement(CreativesBrowser, { accounts }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Renaming, pausing or deleting a creative is not available.');
    await click('Load creatives');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('view=creatives');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.test/thumb.png');
    expect(container.textContent).toContain('Hero');
    expect(container.textContent).toContain('cr2');
    expect(container.textContent).toContain('ACTIVE');
  });

  it('reports load failures and empty accounts without losing the account choice', async () => {
    fetchMock.mockImplementation(async () => response({ error: 'Creatives are offline.' }, false));
    await render(createElement(CreativesBrowser, { accounts }));
    await click('Load creatives');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Creatives are offline.');
    fetchMock.mockImplementation(async () => response({ items: [], next: null }));
    await click('Load creatives');
    expect(container.textContent).toContain('No creatives were returned for this account.');
  });

  it('follows the service cursor for further pages', async () => {
    fetchMock.mockImplementation(async (input: string) => String(input).includes('after=cursor-1')
      ? response({ items: [{ id: 'cr2', name: 'Second', status: null, title: null, body: null, thumbnailUrl: null }], next: null })
      : response({ items: [{ id: 'cr1', name: 'First', status: null, title: null, body: null, thumbnailUrl: null }], next: 'cursor-1' }));
    await render(createElement(CreativesBrowser, { accounts }));
    await click('Load creatives');
    expect(container.textContent).toContain('First');
    await click('Next');
    expect(container.textContent).toContain('Second');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
