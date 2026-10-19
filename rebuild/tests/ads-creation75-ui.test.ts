// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdSetCreateForm } from '../src/modules/ads/ui/AdSetCreateForm';
import { CampaignCreateForm } from '../src/modules/ads/ui/CampaignCreateForm';
import type { AdsUiSchema } from '../src/platforms/ads-ui';

const common = {
  title: 'Create promotion', description: 'Creates a paused promotion.', nameLabel: 'Promotion name', nameMaxLength: 47,
  actionLabel: 'Create paused promotion', confirmTitle: 'Confirm promotion?', confirmDescription: 'It starts paused.',
  options: [{ value: 'visits', label: 'Website visits' }], defaultOption: 'visits', confirmationTemplate: 'CREATE {nameJson} IN {adAccountId}',
};
const campaignConfig: NonNullable<AdsUiSchema['campaign']> = { ...common, optionLabel: 'Goal' };
const adSetConfig: NonNullable<AdsUiSchema['adSet']> = { ...common, budgetLabel: 'Daily budget', countryLabel: 'Country', goalLabel: 'Optimize for' };

const ownerScope = { userId: 'user-1', workspaceId: 'workspace-1' };
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
async function render(node: ReactNode) { await act(async () => root.render(createElement('div', null, node))); }
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
const confirmButton = () => container.querySelector('dialog')!.querySelector<HTMLButtonElement>('button:not([data-dialog-cancel])')!;
const cancelButton = () => container.querySelector<HTMLButtonElement>('dialog [data-dialog-cancel]')!;
async function click(button: HTMLButtonElement) { await act(async () => button.click()); }
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const bodies = () => vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn());
  window.sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('campaign creation request identity and outcomes', () => {
  const mount = () => render(createElement(CampaignCreateForm, { adAccountId: 'account-1', accountName: 'Example', config: campaignConfig, ownerScope }));
  const name = () => container.querySelector<HTMLInputElement>('input[name="name"]')!;

  it('sends a requestId and retains it across a recoverable refusal and re-review of the same payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(400, { error: 'Check the name.', attempt: 'not_dispatched' })).mockResolvedValueOnce(reply(400, { error: 'Check the name.', attempt: 'not_dispatched' }));
    await mount();
    await act(async () => setValue(name(), 'Spring'));
    await submit();
    await click(confirmButton());
    expect(container.querySelector('dialog [role="alert"]')?.textContent).toContain('Check the name.');
    await click(cancelButton());
    await submit();
    await click(confirmButton());
    const [first, second] = bodies();
    expect(first.requestId).toEqual(expect.stringMatching(/^[A-Za-z0-9._:-]{8,128}$/));
    expect(second.requestId).toBe(first.requestId);
  });

  it('mints a new requestId when the reviewed payload changes', async () => {
    vi.mocked(fetch).mockResolvedValue(reply(400, { error: 'no', attempt: 'not_dispatched' }));
    await mount();
    await act(async () => setValue(name(), 'Spring'));
    await submit(); await click(confirmButton()); await click(cancelButton());
    await act(async () => setValue(name(), 'Summer'));
    await submit(); await click(confirmButton());
    const [first, second] = bodies();
    expect(second.requestId).not.toBe(first.requestId);
  });

  it('shows a paused-consequence success only for a confirmed outcome and clears the form', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, { outcome: 'succeeded', operationId: 'o1', remoteId: 'c1', recorded: true, created: { objectType: 'campaign', remoteId: 'c1' }, campaignId: 'c1' }));
    await mount();
    await act(async () => setValue(name(), 'Spring'));
    await submit(); await click(confirmButton());
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/Paused campaign created \(c1\).*not run or spend/);
    expect(name().value).toBe('');
    expect(container.querySelector('dialog[open]')).toBeNull();
  });

  it('holds an uncertain outcome without success, locks the form and retries the same request id', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(reply(200, { outcome: 'uncertain', operationId: 'o1', message: 'Outcome unknown. Do not repeat.' }))
      .mockResolvedValueOnce(reply(200, { outcome: 'succeeded', operationId: 'o1', remoteId: 'c9', recorded: true, replay: true, status: 'resolved_applied' }));
    await mount();
    await act(async () => setValue(name(), 'Spring'));
    await submit(); await click(confirmButton());
    expect(container.textContent).toContain('Outcome unknown. Do not repeat.');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(name().disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    const retry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => /same request again/.test(button.textContent ?? ''))!;
    await click(retry);
    const [first, second] = bodies();
    expect(second.requestId).toBe(first.requestId);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('recorded as applied');
    expect(container.textContent).not.toContain('Paused campaign created');
    expect(name().disabled).toBe(false);
  });

  it('treats a network failure and a server error as unknown, never success', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(reply(502, { error: 'Temporary problem.' }));
    await mount();
    await act(async () => setValue(name(), 'Spring'));
    await submit(); await click(confirmButton());
    expect(container.textContent).toMatch(/could not be confirmed/);
    expect(container.querySelector('[role="status"]')).toBeNull();
    const retry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => /same request again/.test(button.textContent ?? ''))!;
    await click(retry);
    expect(container.textContent).toContain('Temporary problem.');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(name().disabled).toBe(true);
    expect(bodies()[1].requestId).toBe(bodies()[0].requestId);
  });

  it('reports a rejected outcome as not applied and releases the form', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, { outcome: 'rejected', operationId: 'o1', message: 'The platform rejected this change. Nothing was changed.' }));
    await mount();
    await act(async () => setValue(name(), 'Spring'));
    await submit(); await click(confirmButton());
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Nothing was changed');
    expect(container.textContent).not.toMatch(/Paused campaign created/);
    expect(name().value).toBe('Spring');
    expect(name().disabled).toBe(false);
  });
});

describe('ad set creation request identity and outcomes', () => {
  const mount = () => render(createElement(AdSetCreateForm, { adAccountId: 'account-1', campaignId: 'campaign-1', campaignName: 'Example', currency: 'USD', config: adSetConfig, ownerScope }));
  async function fill() {
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="name"]')!, 'Set A'));
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="budget"]')!, '12.50'));
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="countryCode"]')!, 'ma'));
  }

  it('sends requestId with minor-unit budget and keeps it for the same payload, new one when budget changes', async () => {
    vi.mocked(fetch).mockResolvedValue(reply(400, { error: 'Invalid.', attempt: 'not_dispatched' }));
    await mount(); await fill();
    await submit(); await click(confirmButton()); await click(cancelButton());
    await submit(); await click(confirmButton()); await click(cancelButton());
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name="budget"]')!, '13'));
    await submit(); await click(confirmButton());
    const [a, b, c] = bodies();
    expect(a).toMatchObject({ adAccountId: 'account-1', campaignId: 'campaign-1', dailyBudgetMinor: 1250, countryCode: 'MA' });
    expect(b.requestId).toBe(a.requestId);
    expect(c.requestId).not.toBe(a.requestId);
    expect(c.dailyBudgetMinor).toBe(1300);
  });

  it('shows paused success with the budget and currency only on confirmed success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, { outcome: 'succeeded', operationId: 'o1', remoteId: 's1', recorded: true, created: { objectType: 'adset', remoteId: 's1' }, adSetId: 's1' }));
    await mount(); await fill();
    await submit(); await click(confirmButton());
    const text = container.querySelector('[role="status"]')?.textContent ?? '';
    expect(text).toMatch(/Paused ad set created \(s1\)/);
    expect(text).toMatch(/USD\s12\.50/);
    expect(text).toMatch(/not run or spend/);
  });

  it('holds pending/uncertain results, keeps inputs locked, and never auto-mints a request', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(200, { outcome: 'uncertain', operationId: 'o1', message: 'Unknown result.' }));
    await mount(); await fill();
    await submit(); await click(confirmButton());
    expect(container.textContent).toContain('Unknown result.');
    expect(container.querySelector('[role="status"]')).toBeNull();
    for (const field of ['name', 'budget', 'countryCode']) expect(container.querySelector<HTMLInputElement>(`input[name="${field}"]`)!.disabled).toBe(true);
    await submit();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('treats a conflict (request still in progress) as held rather than a plain error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(409, { code: 'conflict', error: 'Still in progress. Do not submit again.' }));
    await mount(); await fill();
    await submit(); await click(confirmButton());
    expect(container.textContent).toContain('Still in progress.');
    expect([...container.querySelectorAll('button')].some(button => /same request again/.test(button.textContent ?? ''))).toBe(true);
  });
});
