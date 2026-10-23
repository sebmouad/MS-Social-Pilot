// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AlertsManager } from '../src/modules/analytics/ui/alerts/AlertsManager';

let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const channels = [{ id: 'channel-a', name: 'Page' }];
const rules = [{
  id: 'rule-a', channelId: 'channel-a', channelName: 'Page', channelAvailable: true, name: 'Views floor',
  metric: 'views', operator: 'below', threshold: 100, windowDays: 7, enabled: true, state: 'firing', lastActual: 80, lastEvaluatedAt: '2026-10-22T00:00:00.000Z',
}];
const firings = [{
  id: 'fire-a', ruleName: 'Views floor', channelName: 'Page', metric: 'views', operator: 'below', threshold: 100,
  actual: 80, firedAt: '2026-10-22T00:00:00.000Z', firedLabel: '22 Oct 2026, 00:00', resolvedAt: null,
}];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function render(props = {}) {
  await act(async () => root.render(createElement(AlertsManager, { rules, firings, canManage: true, channels, locale: 'en', ...props })));
}
function button(label: string) {
  const found = Array.from(container.querySelectorAll('button')).find(element => element.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found as HTMLButtonElement;
}

describe('metric alerts panel', () => {
  it('shows rules, state and recent firings', async () => {
    await render();
    expect(container.textContent).toContain('Metric alerts');
    expect(container.textContent).toContain('Views floor');
    expect(container.textContent).toContain('Firing');
    expect(container.textContent).toContain('Recent firings');
  });

  it('renders French copy when asked', async () => {
    await render({ locale: 'fr' });
    expect(container.textContent).toContain('Alertes de mesure');
    expect(container.textContent).toContain('Nouvelle alerte');
  });

  it('validates the rule form before saving', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await render();
    await act(async () => button('New alert').click());
    const save = button('Save alert');
    await act(async () => save.click());
    expect(container.textContent).toContain('Enter an alert name.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates a rule with the exact confirmation', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, action: 'create', id: 'rule-b' }) });
    vi.stubGlobal('fetch', fetch);
    await render({ rules: [], firings: [] });
    await act(async () => button('New alert').click());
    const setValue = (element: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => {
      setValue(container.querySelector<HTMLInputElement>('#alert-name')!, 'Engagement watch');
      setValue(container.querySelector<HTMLInputElement>('#alert-threshold')!, '50');
    });
    await act(async () => button('Save alert').click());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, options] = fetch.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ action: 'create', channelId: 'channel-a', name: 'Engagement watch', threshold: 50, confirmation: 'CREATE METRIC ALERT channel-a views' });
    expect(container.textContent).toContain('Alert created.');
  });

  it('deletes a rule only after acknowledgement', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, action: 'delete', id: 'rule-a' }) });
    vi.stubGlobal('fetch', fetch);
    await render();
    await act(async () => button('Delete').click());
    expect(container.textContent).toContain('Delete this alert?');
    const confirm = button('Delete alert');
    expect(confirm.disabled).toBe(true);
    const box = container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    await act(async () => box.click());
    await act(async () => button('Delete alert').click());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, options] = fetch.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(options.body)).toMatchObject({ action: 'delete', id: 'rule-a', confirmation: 'DELETE METRIC ALERT rule-a' });
    expect(container.textContent).toContain('Alert deleted.');
  });
});
