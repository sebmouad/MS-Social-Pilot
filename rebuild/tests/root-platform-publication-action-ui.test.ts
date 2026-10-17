// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
import { RootPlatformPublicationAction } from '../src/server/root/RootPlatformPublicationAction';

const action = { rowId: 'row_1', actionId: 'module_action', subjectId: 'row_1', label: 'Resolve receipt', description: 'Review this stored receipt.', acknowledgmentLabel: 'I checked this receipt', confirmation: 'RESOLVE row_1' };
let root: Root;
let container: HTMLDivElement;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const setTextValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
};
const check = (input: HTMLInputElement) => {
  input.click();
};

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('Root platform publication action dialog', () => {
  it('opens with cancel focused, requires exact text and acknowledgement, and preserves fields after an uncertain receipt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: false, actionId: 'module_action', subjectId: 'row_1', operationId: 'receipt_1', state: 'needs_review', message: 'Review the current receipt.' }) });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { root.render(createElement(RootPlatformPublicationAction, { providerId: 'installed_module', action })); });
    const opener = container.querySelector('button')!;
    await act(async () => opener.click()); await flush();
    const cancel = container.querySelector('[data-dialog-cancel]') as HTMLButtonElement;
    expect(document.activeElement).toBe(cancel);
    const inputs = [...container.querySelectorAll('input')];
    const confirmation = inputs.find(input => input.type === 'text')!;
    const acknowledgment = inputs.find(input => input.type === 'checkbox')!;
    const submit = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Resolve receipt') && button !== opener)!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await act(async () => setTextValue(confirmation, 'RESOLVE row_1 '));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await act(async () => setTextValue(confirmation, action.confirmation));
    await act(async () => check(acknowledgment));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await act(async () => submit.click()); await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/root/platform-publication-evidence', expect.objectContaining({ method: 'POST', body: JSON.stringify({ providerId: 'installed_module', actionId: 'module_action', subjectId: 'row_1', confirmation: action.confirmation, acknowledged: true }) }));
    expect(container.querySelector('dialog')).toBeTruthy();
    expect((container.querySelector('.ui-input') as HTMLInputElement).value).toBe(action.confirmation);
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Review the current receipt.');
    expect(document.activeElement).toBe(container.querySelector('[role="alert"]'));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[data-dialog-cancel]')?.textContent).toContain('Close and review');
  });

  it('blocks repeat after a malformed 404 and refreshes current evidence when the operator closes to review', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => { throw new Error('not JSON'); } });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { root.render(createElement(RootPlatformPublicationAction, { providerId: 'installed_module', action })); });
    const clickOpen = async () => { await act(async () => container.querySelector('button')!.click()); await flush(); };
    const fillAndSubmit = async () => {
      const confirmation = container.querySelector('.ui-input') as HTMLInputElement;
      const acknowledgment = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const buttons = [...container.querySelectorAll('button')];
      const submit = buttons.find(button => button !== buttons[0] && button.textContent?.includes('Resolve receipt'))!;
      await act(async () => setTextValue(confirmation, action.confirmation));
      if (!acknowledgment.checked) await act(async () => check(acknowledgment)); await flush();
      await act(async () => submit.click()); await flush();
    };
    await clickOpen(); await fillAndSubmit();
    expect(container.querySelector('dialog')).toBeTruthy();
    expect((container.querySelector('.ui-input') as HTMLInputElement).value).toBe(action.confirmation);
    expect((container.querySelectorAll('button')[2] as HTMLButtonElement).disabled).toBe(true);
    await act(async () => (container.querySelector('[data-dialog-cancel]') as HTMLButtonElement).click()); await flush();
    expect(state.refresh).toHaveBeenCalledOnce();
    expect((container.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Check the current module action details');
  });

  it('keeps a typed validation error correctable and succeeds only for a matching confirmed receipt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ code: 'invalid_request', error: 'Check the exact confirmation and try again.' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, actionId: 'module_action', subjectId: 'row_1', operationId: 'receipt_3', state: 'confirmed', message: 'Receipt recorded.' }) });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { root.render(createElement(RootPlatformPublicationAction, { providerId: 'installed_module', action })); });
    const clickOpen = async () => { await act(async () => container.querySelector('button')!.click()); await flush(); };
    const fillAndSubmit = async () => {
      const confirmation = container.querySelector('.ui-input') as HTMLInputElement;
      const acknowledgment = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const buttons = [...container.querySelectorAll('button')];
      const submit = buttons.find(button => button !== buttons[0] && button.textContent?.includes('Resolve receipt'))!;
      await act(async () => setTextValue(confirmation, action.confirmation));
      if (!acknowledgment.checked) await act(async () => check(acknowledgment)); await flush();
      await act(async () => submit.click()); await flush();
    };
    await clickOpen(); await fillAndSubmit();
    await fillAndSubmit();
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Receipt recorded.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state.refresh).toHaveBeenCalledOnce();
  });
});
