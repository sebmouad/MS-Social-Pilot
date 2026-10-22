// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdSetCreateForm } from '../src/modules/ads/ui/AdSetCreateForm';
import { CampaignCreateForm } from '../src/modules/ads/ui/CampaignCreateForm';
import { ChangeHistory } from '../src/modules/ads/ui/objects/ChangeHistory';
import { AdsNoDispatchError, adsNoDispatchMetadata, asNoDispatch } from '../src/modules/ads/management/errors';
import { OperationError } from '../src/lib/operation-error';
import type { AdsUiSchema } from '../src/platforms/ads-ui';

const common = {
  title: 'Create promotion', description: 'Creates a paused promotion.', nameLabel: 'Promotion name', nameMaxLength: 47,
  actionLabel: 'Create paused promotion', confirmTitle: 'Confirm promotion?', confirmDescription: 'It starts paused.',
  options: [{ value: 'visits', label: 'Website visits' }], defaultOption: 'visits', confirmationTemplate: 'CREATE {nameJson} IN {adAccountId}',
};
const campaignConfig: NonNullable<AdsUiSchema['campaign']> = { ...common, optionLabel: 'Goal' };
const adSetConfig: NonNullable<AdsUiSchema['adSet']> = { ...common, budgetLabel: 'Daily budget', countryLabel: 'Country', goalLabel: 'Optimize for' };
const ownerScope = { userId: 'user-1', workspaceId: 'workspace-1' };
const CAMPAIGN_KEY = 'ads-creation-pending:v2:campaign:user-1:workspace-1:account-1';
const ADSET_KEY = 'ads-creation-pending:v2:adset:user-1:workspace-1:account-1:campaign-1';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
async function render(node: ReactNode) { await act(async () => root.render(createElement('div', null, node))); }
async function reload(node: ReactNode) { await act(async () => root.unmount()); root = createRoot(container); await render(node); }
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
const confirmButton = () => container.querySelector('dialog')!.querySelector<HTMLButtonElement>('button:not([data-dialog-cancel])')!;
async function click(button: HTMLButtonElement) { await act(async () => button.click()); }
const sameRequestButton = () => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => /same request again/.test(button.textContent ?? ''));
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const bodies = () => vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
const campaign = (scope = ownerScope) => createElement(CampaignCreateForm, { adAccountId: 'account-1', accountName: 'Example', config: campaignConfig, ownerScope: scope });
const adSet = () => createElement(AdSetCreateForm, { adAccountId: 'account-1', campaignId: 'campaign-1', campaignName: 'Example', currency: 'USD', config: adSetConfig, ownerScope });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn());
  window.sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('creation reload recovery', () => {
  it('does not dispatch when the browser cannot preserve the request for recovery', async () => {
    await render(campaign());
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="name"]')!, 'Spring'));
    await submit();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    await click(confirmButton());
    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelector('dialog [role="alert"]')?.textContent).toContain('Nothing was sent');
    expect(confirmButton().disabled).toBe(false);
  });

  it('restores the original campaign request after a lost response and never resends on its own', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await render(campaign());
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="name"]')!, 'Spring'));
    await submit(); await click(confirmButton());
    const original = bodies()[0];
    const stored = window.sessionStorage.getItem(CAMPAIGN_KEY) ?? '';
    expect(JSON.parse(stored).requestId).toBe(original.requestId);
    expect(stored).not.toMatch(/token|secret|password/i);

    await reload(campaign());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('before this page reloaded');
    const name = container.querySelector<HTMLInputElement>('input[name="name"]')!;
    expect(name.value).toBe('Spring');
    expect(name.disabled).toBe(true);

    vi.mocked(fetch).mockResolvedValueOnce(reply(200, { outcome: 'succeeded', operationId: 'o1', remoteId: 'c1', recorded: true, replay: true, created: { objectType: 'campaign', remoteId: 'c1' } }));
    await click(sameRequestButton()!);
    expect(bodies()[1]).toEqual(original);
    expect(window.sessionStorage.getItem(CAMPAIGN_KEY)).toBeNull();
  });

  it('restores an ad set request scoped to account and campaign, with its original budget', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await render(adSet());
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="name"]')!, 'Set A'));
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="budget"]')!, '12.50'));
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="countryCode"]')!, 'ma'));
    await submit(); await click(confirmButton());
    const original = bodies()[0];
    await reload(adSet());
    expect(container.textContent).toContain('before this page reloaded');
    expect(container.querySelector<HTMLInputElement>('input[name="budget"]')!.value).toBe('12.50');
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, { outcome: 'uncertain', operationId: 'o1', message: 'Unknown.' }));
    await click(sameRequestButton()!);
    expect(bodies()[1]).toEqual(original);
    expect(window.sessionStorage.getItem(ADSET_KEY)).not.toBeNull();
  });

  it('ignores other campaigns and discards malformed stored data', async () => {
    window.sessionStorage.setItem(ADSET_KEY, JSON.stringify({ requestId: 'short', request: { name: 1 } }));
    await render(adSet());
    expect(container.textContent).not.toContain('before this page reloaded');
    expect(window.sessionStorage.getItem(ADSET_KEY)).toBeNull();
    window.sessionStorage.setItem('ads-creation-pending:v2:adset:user-1:workspace-1:account-1:campaign-2', JSON.stringify({ requestId: 'request-12345', request: { name: 'Other', dailyBudgetMinor: 100, countryCode: 'MA', optimizationGoal: 'visits', confirmation: 'x', requestId: 'request-12345' } }));
    await reload(adSet());
    expect(container.textContent).not.toContain('before this page reloaded');
  });
});

describe('stored requests are scoped to their owner', () => {
  it('does not restore a request stored for another user or workspace', async () => {
    window.sessionStorage.setItem('ads-creation-pending:v2:campaign:user-2:workspace-1:account-1', JSON.stringify({ requestId: 'request-12345', transmissions: 1, request: { name: 'Other user', objective: 'visits', confirmation: 'x', requestId: 'request-12345' } }));
    window.sessionStorage.setItem('ads-creation-pending:v2:campaign:user-1:workspace-2:account-1', JSON.stringify({ requestId: 'request-12346', transmissions: 1, request: { name: 'Other workspace', objective: 'visits', confirmation: 'x', requestId: 'request-12346' } }));
    await render(campaign());
    expect(container.textContent).not.toContain('before this page reloaded');
    expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe('');
    await reload(campaign({ userId: 'user-2', workspaceId: 'workspace-1' }));
    expect(container.textContent).toContain('before this page reloaded');
    expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe('Other user');
  });
});

describe('an already-sent request is never released by a later refusal', () => {
  it('keeps the original identity held through a lost reply, a policy refusal and a reload', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await render(campaign());
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="name"]')!, 'Spring'));
    await submit(); await click(confirmButton());
    const original = bodies()[0];
    expect(sameRequestButton()).toBeDefined();

    // The check hits a policy/auth refusal that is truthfully "this send was not dispatched"; the first send is still unknown.
    vi.mocked(fetch).mockResolvedValueOnce(reply(403, { code: 'forbidden', attempt: 'not_dispatched', error: 'Ads management is turned off.' }));
    await click(sameRequestButton()!);
    expect(bodies()[1]).toEqual(original);
    expect(container.textContent).toContain('Ads management is turned off.');
    expect(container.textContent).toContain('stays held');
    expect(sameRequestButton()).toBeDefined();
    expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.disabled).toBe(true);
    expect(JSON.parse(window.sessionStorage.getItem(CAMPAIGN_KEY) ?? 'null')).toMatchObject({ requestId: original.requestId, transmissions: 2 });

    await reload(campaign());
    expect(container.textContent).toContain('before this page reloaded');
    expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe('Spring');
    expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.disabled).toBe(true);
    await submit();
    expect(fetch).toHaveBeenCalledTimes(2);

    // Only an authoritative recorded outcome releases the identity.
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, { outcome: 'succeeded', operationId: 'o1', remoteId: 'c1', recorded: true, replay: true, created: { objectType: 'campaign', remoteId: 'c1' } }));
    await click(sameRequestButton()!);
    expect(bodies()[2]).toEqual(original);
    expect(window.sessionStorage.getItem(CAMPAIGN_KEY)).toBeNull();
  });

  it('holds an ad set the same way when a restored request meets a refusal', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await render(adSet());
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="name"]')!, 'Set A'));
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="budget"]')!, '12.50'));
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="countryCode"]')!, 'ma'));
    await submit(); await click(confirmButton());
    await reload(adSet());
    vi.mocked(fetch).mockResolvedValueOnce(reply(400, { code: 'invalid_request', attempt: 'not_dispatched', error: 'Budget is above the limit.' }));
    await click(sameRequestButton()!);
    expect(container.textContent).toContain('Budget is above the limit.');
    expect(sameRequestButton()).toBeDefined();
    expect(window.sessionStorage.getItem(ADSET_KEY)).not.toBeNull();
    expect(bodies()[1]).toEqual(bodies()[0]);
  });

  it('describes a replayed success without claiming the object is still paused', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, { outcome: 'succeeded', operationId: 'o1', remoteId: 'c1', recorded: true, replay: true, created: { objectType: 'campaign', remoteId: 'c1' } }));
    await render(campaign());
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="name"]')!, 'Spring'));
    await submit(); await click(confirmButton());
    const text = container.querySelector('[role="status"]')?.textContent ?? '';
    expect(text).toContain('was created paused');
    expect(text).toContain('may have changed');
    expect(text).not.toContain('will not run or spend');
  });
});

describe('no-dispatch refusals versus held outcomes', () => {
  it('releases a first send refused as not dispatched and offers the history link, but holds a plain 409', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(409, { code: 'conflict', attempt: 'not_dispatched', reason: 'blocked_by_other_request', error: 'An earlier change to this object has no confirmed outcome.' }));
    await render(campaign());
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="name"]')!, 'Spring'));
    await submit(); await click(confirmButton());
    expect(container.querySelector('dialog [role="alert"]')?.textContent).toContain('earlier change');
    expect(container.querySelector('dialog [role="alert"] a')?.getAttribute('href')).toBe('/insights/ads/manage#changes');
    expect(sameRequestButton()).toBeUndefined();
    expect(window.sessionStorage.getItem(CAMPAIGN_KEY)).toBeNull();

    vi.mocked(fetch).mockResolvedValueOnce(reply(409, { code: 'conflict', error: 'Still in progress.' }));
    await click(confirmButton());
    expect(sameRequestButton()).toBeDefined();
    expect(bodies()[1].requestId).toBe(bodies()[0].requestId);
    expect(window.sessionStorage.getItem(CAMPAIGN_KEY)).not.toBeNull();
  });

  it('marks only pre-journal product errors as not sent', () => {
    expect(adsNoDispatchMetadata(new OperationError('unavailable', 'x'))).toEqual({});
    expect(adsNoDispatchMetadata(new Error('boom'))).toEqual({});
    expect(adsNoDispatchMetadata(new AdsNoDispatchError('conflict', 'x', 'blocked_by_other_request'))).toEqual({ attempt: 'not_dispatched', reason: 'blocked_by_other_request' });
    expect(adsNoDispatchMetadata(asNoDispatch(new OperationError('unavailable', 'Policy off')))).toEqual({ attempt: 'not_dispatched' });
    const unexpected = asNoDispatch(new Error('provider internals'));
    expect(unexpected.message).not.toContain('provider internals');
    expect(unexpected.code).toBe('unavailable');
  });
});

describe('creation history labels', () => {
  it('shows New campaign and New ad set instead of placeholder identifiers', async () => {
    const base = { status: 'succeeded', createdAt: '2026-10-18T12:00:00.000Z', needsResolution: false, resolutionNote: null };
    await render(createElement(ChangeHistory, { noteMaxCharacters: 37, items: [
      { ...base, id: 'a', operationType: 'campaign.create', objectType: 'campaign', objectId: '@create-campaign' },
      { ...base, id: 'b', operationType: 'adset.create', objectType: 'adset', objectId: '@create-adset:c1' },
    ] }));
    expect(container.textContent).toContain('New campaign');
    expect(container.textContent).toContain('New ad set');
    expect(container.textContent).not.toContain('@create');
  });
});
