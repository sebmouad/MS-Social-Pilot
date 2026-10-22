// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
import { RootPlatformPublicationAction } from '../src/modules/root/ui/RootPlatformPublicationAction';
import { ROOT_EVIDENCE_POLICY } from '../src/lib/config/root-evidence-policy';
import { ROOT_EVIDENCE_COPY } from '../src/lib/config/root-evidence-copy';

const action = { rowId: 'row_1', actionId: 'module_action', subjectId: 'row_1', label: 'Resolve receipt', description: 'Review this stored receipt.', acknowledgmentLabel: 'I checked this receipt', confirmation: 'RESOLVE row_1' };
const actionWithFields = { ...action, fields: [
  { key: 'observedId', label: 'Observed remote ID', kind: 'text' as const, required: true, maxLength: 100, description: 'Enter the ID visible on the destination.' },
  { key: 'observation', label: 'Observed result', kind: 'choice' as const, required: true, options: [{ value: 'present', label: 'Present' }, { value: 'absent', label: 'Absent' }] },
  { key: 'verified', label: 'I checked this exact destination', kind: 'checkbox' as const, required: true },
] };
const actionWithContext = { ...action, context: [
  { label: 'Workspace', value: 'Example workspace' },
  { label: 'Channel', value: 'North Page' },
  { label: 'Publication operation', value: 'operation_1' },
  { label: 'Remote Page ID', value: '12345678901234567890' },
] };
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
  it('uses shared neutral buttons for module-declared inspections', async () => {
    await act(async () => root.render(createElement(RootPlatformPublicationAction, {
      providerId: 'example', action: { ...action, intent: 'inspect' }, policy: ROOT_EVIDENCE_POLICY, copy: ROOT_EVIDENCE_COPY,
    })));
    const opener = container.querySelector('button')!;
    expect(opener.className).toContain('ui-button--secondary');
    await act(async () => opener.click());
    const buttons = Array.from(document.querySelectorAll('dialog button'));
    expect(buttons.some(button => button.className.includes('ui-button--danger'))).toBe(false);
    expect(buttons.find(button => button.textContent?.includes(action.label))?.className).toContain('ui-button--secondary');
  });

  it('uses the live Root policy to lower client field-value ceilings', async () => {
    const policy = { ...ROOT_EVIDENCE_POLICY, fieldValueCharacters: 3, identifierCharacters: 5, messageCharacters: 4 };
    await act(async () => { root.render(createElement(RootPlatformPublicationAction, { providerId: 'installed_module', action: actionWithFields, policy, copy: ROOT_EVIDENCE_COPY })); });
    await act(async () => container.querySelector('button')!.click());
    const text = container.querySelector('input[type=text]') as HTMLInputElement;
    expect(text.maxLength).toBe(3);
  });

  it('opens with cancel focused, requires exact text and acknowledgement, and preserves fields after an uncertain receipt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: false, actionId: 'module_action', subjectId: 'row_1', operationId: 'receipt_1', state: 'needs_review', message: 'Review the current receipt.' }) });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { root.render(createElement(RootPlatformPublicationAction, { providerId: 'installed_module', action, policy: ROOT_EVIDENCE_POLICY, copy: ROOT_EVIDENCE_COPY })); });
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

  it('shows resolved module context before confirmation and keeps it out of the action request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, actionId: 'module_action', subjectId: 'row_1', operationId: 'receipt_context', state: 'confirmed', message: 'Receipt recorded.' }) });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { root.render(createElement(RootPlatformPublicationAction, { providerId: 'installed_module', action: actionWithContext, policy: ROOT_EVIDENCE_POLICY, copy: ROOT_EVIDENCE_COPY })); });
    await act(async () => container.querySelector('button')!.click()); await flush();
    const context = container.querySelector('dl[aria-label="Resolved action context"]')!;
    expect(context.textContent).toContain('Example workspace');
    expect(context.textContent).toContain('North Page');
    expect(context.textContent).toContain('operation_1');
    expect(context.textContent).toContain('12345678901234567890');
    await act(async () => setTextValue(container.querySelector('input[aria-label="Exact confirmation"]') as HTMLInputElement, action.confirmation));
    await act(async () => check([...container.querySelectorAll('input[type="checkbox"]')][0] as HTMLInputElement));
    const submit = [...container.querySelectorAll('button')].find(button => button !== container.querySelector('button') && button.textContent?.includes(action.label))!;
    await act(async () => submit.click()); await flush();
    const request = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(request).not.toHaveProperty('context');
    expect(request).toEqual({ providerId: 'installed_module', actionId: 'module_action', subjectId: 'row_1', confirmation: action.confirmation, acknowledged: true });
  });

  it('blocks repeat after a malformed 404 and refreshes current evidence when the operator closes to review', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => { throw new Error('not JSON'); } });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { root.render(createElement(RootPlatformPublicationAction, { providerId: 'installed_module', action, policy: ROOT_EVIDENCE_POLICY, copy: ROOT_EVIDENCE_COPY })); });
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
    await act(async () => { root.render(createElement(RootPlatformPublicationAction, { providerId: 'installed_module', action, policy: ROOT_EVIDENCE_POLICY, copy: ROOT_EVIDENCE_COPY })); });
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

  it('renders module fields, focuses missing required input, and retains matching values after an uncertain result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: false, actionId: 'module_action', subjectId: 'row_1', operationId: 'receipt_4', state: 'needs_review', message: 'Review current evidence.' }) });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { root.render(createElement(RootPlatformPublicationAction, { providerId: 'installed_module', action: actionWithFields, policy: ROOT_EVIDENCE_POLICY, copy: ROOT_EVIDENCE_COPY })); });
    await act(async () => container.querySelector('button')!.click()); await flush();
    const confirmation = container.querySelector('input[aria-label="Exact confirmation"]') as HTMLInputElement;
    const riskAcknowledgment = [...container.querySelectorAll('input[type="checkbox"]')].find(input => !input.id.includes('verified')) as HTMLInputElement;
    const submit = [...container.querySelectorAll('button')].find(button => button !== container.querySelector('button') && button.textContent?.includes(action.label))!;
    await act(async () => setTextValue(confirmation, action.confirmation));
    await act(async () => check(riskAcknowledgment));
    await act(async () => submit.click()); await flush();
    const observedId = container.querySelector('input[id$="-observedId"]') as HTMLInputElement;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(observedId);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Observed remote ID');

    await act(async () => setTextValue(observedId, 'external_photo_7'));
    const present = container.querySelector('input[type="radio"][value="present"]') as HTMLInputElement;
    await act(async () => present.click());
    const verified = container.querySelector('input[id$="-verified"]') as HTMLInputElement;
    await act(async () => check(verified));
    await act(async () => submit.click()); await flush();
    const requestBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(requestBody).toEqual({ providerId: 'installed_module', actionId: 'module_action', subjectId: 'row_1', confirmation: action.confirmation, acknowledged: true, fieldValues: { observedId: 'external_photo_7', observation: 'present', verified: true } });
    expect((container.querySelector('input[id$="-observedId"]') as HTMLInputElement).value).toBe('external_photo_7');
    expect((container.querySelector('input[type="radio"][value="present"]') as HTMLInputElement).checked).toBe(true);
    expect((container.querySelector('input[id$="-verified"]') as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('[role="alert"]'));
  });

  it('forwards close-and-review feedback through the table callback', async () => {
    const onReceipt = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => { throw new Error('not JSON'); } }));
    await act(async () => { root.render(createElement(RootPlatformPublicationAction, { providerId: 'installed_module', action, policy: ROOT_EVIDENCE_POLICY, copy: ROOT_EVIDENCE_COPY, onReceipt })); });
    await act(async () => container.querySelector('button')!.click()); await flush();
    await act(async () => setTextValue(container.querySelector('input[aria-label="Exact confirmation"]') as HTMLInputElement, action.confirmation));
    await act(async () => check(container.querySelector('input[type="checkbox"]') as HTMLInputElement));
    const submit = [...container.querySelectorAll('button')].find(button => button !== container.querySelector('button') && button.textContent?.includes(action.label))!;
    await act(async () => submit.click()); await flush();
    await act(async () => (container.querySelector('[data-dialog-cancel]') as HTMLButtonElement).click()); await flush();
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(onReceipt).toHaveBeenCalledWith(expect.stringContaining('Evidence refreshed. Check the current module action details'));
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
