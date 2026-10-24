// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import { ObjectManager } from '../src/modules/ads/ui/objects/ObjectManager';
import { ObjectRowLabel } from '../src/modules/ads/ui/objects/ObjectRowLabel';

const dialog = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void; close?: () => void };
dialog.showModal ??= function () { this.setAttribute('open', ''); };
dialog.close ??= function () { this.removeAttribute('open'); };

const capabilities = {
  canManage: true,
  limits: { nameMaxCharacters: 40, maxBudgetMinor: 12500 },
  operations: [
    { id: 'status.set', objectTypes: ['campaign'], spendChanging: true, label: 'Pause or resume', inputs: [{ name: 'status', kind: 'choice', options: [{ value: 'paused', label: 'Pause' }, { value: 'active', label: 'Resume' }] }] },
    { id: 'rename', objectTypes: ['campaign'], spendChanging: false, label: 'Rename', inputs: [{ name: 'name', kind: 'text' }] },
  ],
};
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
const fetchMock = vi.fn();
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let seq = 0;
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label));
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
  await settle();
}

function setup(applyOutcome: Record<string, unknown>) {
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    if (String(input).startsWith('/api/ads/directory')) return response({ name: 'Spring', currency: 'EUR', totals: { spend: 0, impressions: 0, clicks: 0, cpc: null, ctr: null, cpm: null }, daily: [], live: { available: true }, management: { available: true, canManage: true, operations: capabilities.operations } });
    if (String(input).includes('view=capabilities')) return response(capabilities);
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.action === 'preview') return response({ confirmation: 'opaque', spendChanging: false, irreversible: false, blockedByOpenChange: false });
    return response(applyOutcome);
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { randomUUID: () => 'row-request-1' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const objectId = `c${++seq}`; // the row overlay store is module-level, so each test gets its own row
  await act(async () => root.render(createElement('div', null,
    createElement('div', { id: 'label' }, createElement(ObjectRowLabel, { adAccountId: 'acc', level: 'campaign', objectId, name: 'Spring', status: 'active' })),
    createElement(ObjectManager, { adAccountId: 'acc', level: 'campaign', objectId, name: 'Spring' }))));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const label = () => container.querySelector('#label')!;

describe('Ads object row refresh', () => {
  it('shows a confirmed status change on the row immediately and refreshes the server data', async () => {
    setup({ outcome: 'succeeded' });
    expect(label().textContent).toContain('active');
    await click('Details'); await click('Pause'); await click('Confirm change');
    expect(label().textContent).toContain('paused');
    expect(label().textContent).not.toContain('active');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows a confirmed rename on the row immediately', async () => {
    setup({ outcome: 'succeeded' });
    await click('Details');
    const input = container.querySelector<HTMLInputElement>('input[name="name"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(input, 'Autumn'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await click('Rename'); await click('Confirm change');
    expect(label().textContent).toContain('Autumn');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('leaves the row unchanged when the change is rejected', async () => {
    setup({ outcome: 'rejected', message: 'Not applied.' });
    await click('Details'); await click('Pause'); await click('Confirm change');
    expect(label().textContent).toContain('active');
    expect(refresh).not.toHaveBeenCalled();
  });
});
