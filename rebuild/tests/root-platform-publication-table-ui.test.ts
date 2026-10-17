// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
import { RootPlatformPublicationTable } from '../src/server/root/RootPlatformPublicationTable';
import type { PlatformPublicationEvidence } from '../src/server/platforms/host';

const action = { rowId: 'row_1', actionId: 'module_action', subjectId: 'row_1', label: 'Resolve receipt', description: 'Review this stored receipt.', acknowledgmentLabel: 'I checked this receipt', confirmation: 'RESOLVE row_1' };
const evidence = (actions = [action], state = 'pending'): PlatformPublicationEvidence => ({
  title: 'Module upload receipts', description: 'Known receipt identifiers.',
  columns: [{ key: 'receipt', label: 'Receipt' }, { key: 'state', label: 'State' }],
  items: [{ receipt: 'row_1', state }], rowIdKey: 'receipt', actions, truncated: false,
});

let root: Root;
let container: HTMLDivElement;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const setTextValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('Root publication evidence table action feedback', () => {
  it('keeps the confirmed receipt notice focused when refreshed evidence removes the completed action', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, actionId: 'module_action', subjectId: 'row_1', operationId: 'receipt_2', state: 'attested', message: 'External observation saved.' }) }));
    await act(async () => { root.render(createElement(RootPlatformPublicationTable, { evidence: evidence(), providerId: 'installed_module', filtered: false })); });
    const opener = container.querySelector('button')!;
    await act(async () => opener.click()); await flush();
    await act(async () => setTextValue(container.querySelector('.ui-input') as HTMLInputElement, action.confirmation));
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    const submit = [...container.querySelectorAll('button')].find(button => button !== opener && button.textContent?.includes(action.label))!;
    await act(async () => submit.click()); await flush();

    const notice = container.querySelector('[role="status"]') as HTMLParagraphElement;
    expect(notice.textContent).toBe('Human report recorded. The platform did not independently confirm it. External observation saved.');
    expect(document.activeElement).toBe(notice);
    expect(state.refresh).toHaveBeenCalledOnce();

    // Model the RSC refresh: the same table receives updated evidence with no action metadata.
    const originalRow = container.querySelector('tbody tr');
    await act(async () => { root.render(createElement(RootPlatformPublicationTable, { evidence: evidence([], 'confirmed'), providerId: 'installed_module', filtered: false })); });
    const refreshedNotice = container.querySelector('[role="status"]') as HTMLParagraphElement;
    expect(container.querySelector('button')).toBeNull();
    expect(refreshedNotice.textContent).toBe('Human report recorded. The platform did not independently confirm it. External observation saved.');
    expect(document.activeElement).toBe(refreshedNotice);
    expect(container.querySelector('tbody tr')).toBe(originalRow);
  });
});
