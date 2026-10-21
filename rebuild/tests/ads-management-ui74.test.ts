// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const state = vi.hoisted(() => ({ randomUUID: vi.fn(() => 'ads-request-1') }));
import { ObjectManager } from '../src/modules/ads/ui/objects/ObjectManager';
import { ChangeHistory } from '../src/modules/ads/ui/objects/ChangeHistory';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const dialog = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void; close?: () => void };
dialog.showModal ??= function () { this.setAttribute('open', ''); };
dialog.close ??= function () { this.removeAttribute('open'); };

const capabilities = {
  canManage: true,
  canListCreatives: false,
  limits: { nameMaxCharacters: 40, maxBudgetMinor: 12500 },
  operations: [
    { id: 'status.set', objectTypes: ['campaign'], spendChanging: true, label: 'Pause or resume', inputs: [{ name: 'status', kind: 'choice', options: [{ value: 'paused', label: 'Pause' }, { value: 'active', label: 'Resume' }] }] },
    { id: 'budget.set', objectTypes: ['campaign'], spendChanging: true, label: 'Change budget', inputs: [{ name: 'budget', kind: 'money-minor', budgetKinds: ['daily'] }] },
    { id: 'rename', objectTypes: ['campaign'], spendChanging: false, label: 'Rename', inputs: [{ name: 'name', kind: 'text' }] },
    { id: 'delete', objectTypes: ['campaign'], spendChanging: false, irreversible: true, label: 'Delete' },
  ],
};

function response(body: unknown, ok = true) { return { ok, json: async () => body }; }
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label));
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
}
async function openManager() {
  await click('Details');
  await settle();
}
function requestBodies() {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body ?? '{}')));
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.stubGlobal('crypto', { randomUUID: state.randomUUID });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (input: string) => {
    if (String(input).startsWith('/api/ads/directory')) return response({ name: 'Spring', currency: 'EUR', totals: { spend: 0, impressions: 0, clicks: 0, cpc: null, ctr: null, cpm: null }, daily: [], live: { available: true }, management: { available: true, canManage: true, operations: capabilities.operations } });
    if (String(input).includes('view=capabilities')) return response(capabilities);
    const body = JSON.parse(String((fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined)?.body ?? '{}'));
    return response({ confirmation: 'opaque service confirmation', spendChanging: body.operation?.type === 'budget.set' || body.operation?.status === 'active', irreversible: body.operation?.type === 'delete', blockedByOpenChange: false });
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(ObjectManager, { adAccountId: 'account-1', level: 'campaign', objectId: 'campaign-1', name: 'Spring' })));
});

afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

describe('Ads management UI', () => {
  it('retains one requestId when retrying an unconfirmed write', async () => {
    await openManager();
    await click('Pause');
    await settle();
    fetchMock.mockRejectedValueOnce(new TypeError('network interrupted'));
    await click('Confirm change');
    await settle();
    expect(container.textContent).toContain('same request ID');
    expect(container.querySelector('.ui-dialog')).toBeNull();
    expect(container.querySelector('a[href="/ads/objects#changes"]')).toBeTruthy();
    await click('Close');
    expect(container.querySelector('[aria-labelledby$="-pending-title"]')).toBeTruthy();
    await click('Try the same change again');
    await settle();
    const applies = requestBodies().filter(body => body.action === 'apply');
    expect(applies).toHaveLength(2);
    expect(applies[0].requestId).toBe('ads-request-1');
    expect(applies[1].requestId).toBe('ads-request-1');
    expect(state.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('releases the held UI only after a terminal not-applied replay, then requires a new preview', async () => {
    state.randomUUID.mockReturnValueOnce('ads-request-1').mockReturnValueOnce('ads-request-2');
    await openManager();
    await click('Pause');
    await settle();
    fetchMock.mockRejectedValueOnce(new TypeError('network interrupted'));
    await click('Confirm change');
    await settle();
    fetchMock.mockResolvedValueOnce(response({ outcome: 'rejected', operationId: 'change-1', status: 'resolved_not_applied', terminal: true, replay: true, message: 'This request was resolved as not applied.' }));
    await click('Try the same change again');
    await settle();
    expect(container.textContent).toContain('confirmed that the previous change was not applied');
    expect(container.querySelector('[aria-labelledby$="-pending-title"]')).toBeNull();
    expect(container.textContent).toContain('Pause');

    await click('Pause');
    await settle();
    await click('Confirm change');
    await settle();
    const applies = requestBodies().filter(body => body.action === 'apply');
    expect(applies.map(body => body.requestId)).toEqual(['ads-request-1', 'ads-request-1', 'ads-request-2']);
    expect(state.randomUUID).toHaveBeenCalledTimes(2);
  });

  it('shows real spend and currency, blocks an open change, and explains irreversible actions', async () => {
    await openManager();
    const budget = container.querySelector<HTMLInputElement>('input[inputmode="decimal"]');
    expect(budget).toBeTruthy();
    expect(budget?.getAttribute('aria-label')).toContain('EUR');
    expect(container.textContent).toContain('EUR');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(budget, '2.5'); budget?.dispatchEvent(new Event('input', { bubbles: true })); budget?.dispatchEvent(new Event('change', { bubbles: true })); });

    fetchMock.mockImplementation(async (input: string) => {
      if (String(input).includes('view=capabilities')) return response(capabilities);
      if (String(input).startsWith('/api/ads/directory')) return response({ name: 'Spring', currency: 'EUR', totals: { spend: 0, impressions: 0, clicks: 0, cpc: null, ctr: null, cpm: null }, daily: [], live: { available: true }, management: { available: true, canManage: true, operations: capabilities.operations } });
      return response({ confirmation: 'opaque service confirmation', spendChanging: true, irreversible: false, blockedByOpenChange: true });
    });
    await click('Change budget');
    await settle();
    expect(container.textContent).toContain('2.50');
    expect(container.textContent).toContain('already has a change in progress');
    expect(container.textContent).toContain('cannot be confirmed until that change is reviewed');
    expect(container.querySelector<HTMLButtonElement>('.ui-dialog__actions button:last-child')?.disabled).toBe(true);
    expect(requestBodies().filter(body => body.action === 'apply')).toHaveLength(0);
  });

  it('uses advertised Root limits and neutral input descriptors', async () => {
    await openManager();
    expect(container.querySelector('input[maxlength="40"]')).toBeTruthy();
    expect(container.querySelector('option[value="lifetime"]')).toBeNull();
    expect(container.textContent).not.toContain('Assign creative');
    const amount = container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
    await click('Change budget');
    await settle();
    expect(amount.getAttribute('aria-label')).toBe('New budget in EUR');
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(amount.getAttribute('aria-describedby')!)?.textContent).toMatch(/valid amount/i);
    expect(document.activeElement).toBe(amount);
    expect(requestBodies().filter(body => body.action === 'preview')).toHaveLength(0);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(amount, '126.00'); amount.dispatchEvent(new Event('input', { bubbles: true })); amount.dispatchEvent(new Event('change', { bubbles: true })); });
    await click('Change budget');
    await settle();
    expect(container.textContent).toContain('no higher than');
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(amount);
    expect(requestBodies().filter(body => body.action === 'preview')).toHaveLength(0);
    await click('Delete');
    await settle();
    expect(container.textContent).toContain('cannot be undone');
  });

  it('offers only service-approved pending recovery and keeps the review note after a save failure', async () => {
    const item = { id: 'change-9', operationType: 'status.set', objectType: 'campaign', objectId: 'campaign-1', status: 'pending', createdAt: '2026-10-18T12:00:00.000Z', needsResolution: true, resolutionKind: 'pending_recovery' as const, onHold: true, resolutionNote: null };
    await act(async () => root.render(createElement(ChangeHistory, { noteMaxCharacters: 37, items: [item] })));
    expect(container.textContent).toContain('service checks for an active dispatch before it records your finding');
    await click('I checked: it was applied');
    await settle();
    const note = container.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(note.maxLength).toBe(37);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(note, 'checked in the platform'); note.dispatchEvent(new Event('input', { bubbles: true })); note.dispatchEvent(new Event('change', { bubbles: true })); });
    fetchMock.mockResolvedValueOnce(response({ error: 'The record could not be saved.' }, false));
    await click('Record review');
    await settle();
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('checked in the platform');
    expect(requestBodies().at(-1)).toMatchObject({ action: 'resolve', operationId: 'change-9', resolution: 'applied', note: 'checked in the platform', confirmation: 'RECOVER ADS CHANGE change-9 AS APPLIED' });
    fetchMock.mockResolvedValueOnce(response({ status: 'resolved_applied' }));
    await click('Record review');
    await settle();
    expect(container.textContent).toContain('did not contact the advertising platform');
  });
});
