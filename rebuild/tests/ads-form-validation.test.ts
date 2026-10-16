// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdsObjectActions } from '../src/app/ads/AdsObjectActions';
import { AdSetCreateForm } from '../src/app/ads/AdSetCreateForm';
import { CampaignCreateForm } from '../src/app/ads/CampaignCreateForm';
import type { AdsUiSchema } from '../src/platforms/ads-ui';

const common = {
  title: 'Create promotion', description: 'Creates a paused promotion.', nameLabel: 'Promotion name', nameMaxLength: 47,
  actionLabel: 'Create paused promotion', confirmTitle: 'Confirm promotion?', confirmDescription: 'It starts paused.',
  options: [{ value: 'visits', label: 'Website visits' }], defaultOption: 'visits', confirmationTemplate: 'CREATE {nameJson} IN {adAccountId}',
};
const campaignConfig: NonNullable<AdsUiSchema['campaign']> = { ...common, optionLabel: 'Goal' };
const adSetConfig: NonNullable<AdsUiSchema['adSet']> = { ...common, budgetLabel: 'Daily budget', countryLabel: 'Country', goalLabel: 'Optimize for' };

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
async function render(node: ReactNode) { await act(async () => root.render(createElement('div', null, node))); }
async function submit(form: HTMLFormElement) { await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Ads form validation', () => {
  it('associates a missing campaign name error and focuses the field without opening confirmation', async () => {
    await render(createElement(CampaignCreateForm, { adAccountId: 'account-1', accountName: 'Example account', config: campaignConfig }));
    await submit(container.querySelector('form')!);
    const input = container.querySelector<HTMLInputElement>('input[name="name"]')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    expect(container.querySelector(`[id="${input.getAttribute('aria-describedby')}"]`)?.textContent).toMatch(/campaign name/i);
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows associated budget and country errors on ad set creation and focuses the first invalid field', async () => {
    await render(createElement(AdSetCreateForm, { adAccountId: 'account-1', campaignId: 'campaign-1', campaignName: 'Example', currency: 'USD', config: adSetConfig }));
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="name"]')!, 'Summer campaign'));
    await submit(container.querySelector('form')!);
    const name = container.querySelector<HTMLInputElement>('input[name="name"]')!;
    const budget = container.querySelector<HTMLInputElement>('input[name="budget"]')!;
    const country = container.querySelector<HTMLInputElement>('input[name="countryCode"]')!;
    expect(name.getAttribute('aria-invalid')).toBeNull();
    expect(budget.getAttribute('aria-invalid')).toBe('true');
    expect(country.getAttribute('aria-invalid')).toBe('true');
    for (const input of [name, budget, country]) expect(container.querySelector(`[id="${input.getAttribute('aria-describedby')}"]`)?.textContent).toBeTruthy();
    expect(document.activeElement).toBe(budget);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks an invalid budget action before any request and focuses its associated error', async () => {
    await render(createElement(AdsObjectActions, { adAccountId: 'account-1', objectId: 'object-1', objectType: 'campaign', currency: 'USD', canRead: false, canManage: true }));
    await submit(container.querySelector('form')!);
    const budget = container.querySelector<HTMLInputElement>('input[name="budgetAmount"]')!;
    expect(budget.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector(`[id="${budget.getAttribute('aria-describedby')}"]`)?.textContent).toMatch(/valid amount/i);
    expect(document.activeElement).toBe(budget);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains campaign input and confirmation context after a recoverable request failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('temporary network failure'));
    await render(createElement(CampaignCreateForm, { adAccountId: 'account-1', accountName: 'Example account', config: campaignConfig }));
    const input = container.querySelector<HTMLInputElement>('input[name="name"]')!;
    await act(async () => setValue(input, 'Keep this promotion'));
    await submit(container.querySelector('form')!);
    const confirm = container.querySelector<HTMLDialogElement>('dialog')!.querySelector<HTMLButtonElement>(`button:not([data-dialog-cancel])`)!;
    await act(async () => confirm.click());
    expect(container.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Keep this promotion');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('temporary network failure');
    expect(container.querySelector('dialog[open]')).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
