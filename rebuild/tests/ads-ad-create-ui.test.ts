// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const state = vi.hoisted(() => ({ randomUUID: vi.fn(() => 'ad-request-1') }));
import { AdCreateForm } from '../src/modules/ads/ui/AdCreateForm';
import { ObjectManager } from '../src/modules/ads/ui/objects/ObjectManager';
import { AdsCopyProvider } from '../src/modules/ads/ui/AdsCopyProvider';
import { defaultAdsCatalogs } from '../src/modules/ads/copy';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const dialog = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void; close?: () => void };
dialog.showModal ??= function () { this.setAttribute('open', ''); };
dialog.close ??= function () { this.removeAttribute('open'); };

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label));
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
}
async function type(selector: string, value: string) {
  const field = container.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
  const proto = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value); field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
const bodies = () => fetchMock.mock.calls.filter(([, init]) => init?.body).map(([, init]) => JSON.parse(String(init.body)));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.stubGlobal('crypto', { randomUUID: state.randomUUID });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('paused ad creation form', () => {
  async function fillAndReview() {
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      if (String(input).includes('view=creatives')) return ok({ items: [{ id: 'cr1', name: 'Summer image', title: null }] });
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.action === 'preview') return ok({ confirmation: 'CREATE PAUSED FACEBOOK AD "Spring ad" UNDER AD SET s1 IN ACCOUNT acc1 WITH CREATIVE cr1', spendChanging: true, irreversible: false, blockedByOpenChange: false });
      return ok({ outcome: 'succeeded', operationId: 'op1', remoteId: 'ad-new', recorded: true, created: { objectType: 'ad', remoteId: 'ad-new' } });
    });
    await act(async () => root.render(createElement(AdCreateForm, { adAccountId: 'acc1', adSetId: 's1', adSetName: 'Prospecting', nameMaxCharacters: 40 })));
    await click('Load creatives'); await settle();
    await type('input[name="name"]', 'Spring ad');
    await type('select[name="creativeId"]', 'cr1');
    await click('Review ad'); await settle();
  }

  it('previews the module confirmation, warns about spend and applies it with the reviewed request id', async () => {
    await fillAndReview();
    expect(bodies()[0]).toEqual({ action: 'preview', adAccountId: 'acc1', operation: { type: 'ad.create', objectType: 'ad', parentId: 's1', name: 'Spring ad', creativeId: 'cr1' } });
    expect(container.querySelector('.ui-dialog')?.textContent).toMatch(/Spring ad/);
    expect(container.querySelector('[role="note"]')).toBeTruthy();
    await click('Create paused ad'); await settle();
    const apply = bodies()[1];
    expect(apply).toMatchObject({ action: 'apply', requestId: 'ad-request-1', confirmation: 'CREATE PAUSED FACEBOOK AD "Spring ad" UNDER AD SET s1 IN ACCOUNT acc1 WITH CREATIVE cr1', operation: { type: 'ad.create' } });
    expect(JSON.stringify(apply.operation)).not.toMatch(/status/);
    expect(container.textContent).toContain('Paused ad created.');
  });

  it('validates before any request and sends nothing', async () => {
    fetchMock.mockImplementation(async () => ok({ items: [{ id: 'cr1', name: 'Summer image', title: null }] }));
    await act(async () => root.render(createElement(AdCreateForm, { adAccountId: 'acc1', adSetId: 's1', adSetName: 'Prospecting', nameMaxCharacters: 40 })));
    await click('Load creatives'); await settle();
    await click('Review ad'); await settle();
    expect(container.textContent).toContain('Enter an ad name.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('holds an unconfirmed write, keeps the same request id for the retry and never resends on its own', async () => {
    await fillAndReview();
    fetchMock.mockRejectedValueOnce(new TypeError('network interrupted'));
    await click('Create paused ad'); await settle();
    expect(container.querySelector('.ui-dialog')).toBeNull();
    expect(container.querySelector('a[href="/insights/ads/manage#changes"]')).toBeTruthy();
    expect(bodies().filter(body => body.action === 'apply')).toHaveLength(1);
    expect(container.querySelector('[aria-label="Ad creation needs review"]')).toBeTruthy();
    await click('same request'); await settle();
    const applies = bodies().filter(body => body.action === 'apply');
    expect(applies).toHaveLength(2);
    expect(applies.map(body => body.requestId)).toEqual(['ad-request-1', 'ad-request-1']);
    expect(state.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('shows a definite rejection as an error without holding the form', async () => {
    await fillAndReview();
    fetchMock.mockResolvedValueOnce(ok({ outcome: 'rejected', operationId: 'op1', message: 'Facebook did not accept the change.' }));
    await click('Create paused ad'); await settle();
    expect(container.textContent).toContain('Facebook did not accept the change.');
    expect(container.querySelector('[aria-label="Ad creation needs review"]')).toBeNull();
  });

  it('keeps a failed preview in the form and creates nothing', async () => {
    await fillAndReview();
    expect(fetchMock).toHaveBeenCalled();
    fetchMock.mockClear();
    await click('Cancel');
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'This ad set cannot be verified for the selected account.' }) });
    await click('Review ad'); await settle();
    expect(container.textContent).toContain('This ad set cannot be verified');
    expect(bodies().filter(body => body.action === 'apply')).toHaveLength(0);
  });
});

describe('missing advertising-changes grant in the object manager', () => {
  const detail = (needsReconnect: boolean) => ({ name: 'Spring', currency: 'EUR', totals: { spend: 0, impressions: 0, clicks: 0, cpc: null, ctr: null, cpm: null }, daily: [], live: { available: false }, management: { available: true, canManage: false, needsReconnect, operations: [] } });

  async function open(locale: 'en' | 'fr', needsReconnect: boolean) {
    fetchMock.mockImplementation(async (input: string) => String(input).includes('view=capabilities') ? ok({ canManage: false, needsReconnect, operations: [] }) : ok(detail(needsReconnect)));
    await act(async () => root.render(createElement(AdsCopyProvider, { catalogs: defaultAdsCatalogs, locale, children: createElement(ObjectManager, { adAccountId: 'acc1', level: 'campaign', objectId: 'c1', name: 'Spring' }) })));
    await act(async () => (container.querySelector('button') as HTMLButtonElement).click()); await settle();
  }

  it('tells the customer to reconnect, in English and French, with a link to connections', async () => {
    await open('en', true);
    expect(container.textContent).toContain('until the advertising connection is reconnected');
    expect(container.querySelector('a[href="/settings/channels"]')?.textContent).toBe('Reconnect in Settings');
    await act(async () => root.unmount()); root = createRoot(container);
    await open('fr', true);
    expect(container.textContent).toContain('reconnectée');
    expect(container.querySelector('a[href="/settings/channels"]')?.textContent).toBe('Reconnecter dans les paramètres');
  });

  it('keeps the plain view-only message when reconnecting would not help', async () => {
    await open('en', false);
    expect(container.textContent).toContain('Changes are not available for your access');
    expect(container.querySelector('a[href="/settings/channels"]')).toBeNull();
  });
});
