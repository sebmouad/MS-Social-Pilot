// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelScheduleForm } from '@/modules/publishing/ui/queue/CancelScheduleForm';
import { AuditExport, AuditRetention } from '@/app/root/activity/AuditControls';
import { ROOT_AUDIT_CONTROLS_COPY } from '@/lib/config/root-audit-controls';
import { VerifyForm } from '@/app/two-step/verify-form';
import { JoinForm } from '@/app/join/join-form';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
const render = (element: Parameters<typeof root.render>[0]) => act(async () => { root.render(element); });
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
async function fill(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const submit = (form: HTMLFormElement) => act(async () => { form.requestSubmit(); });

describe('queue cancel failure', () => {
  it('shows a catalog sentence beside the post and re-enables the button when the request fails', async () => {
    const action = vi.fn(async () => { throw new Error('500 Internal Server Error: stack trace'); });
    await render(createElement(CancelScheduleForm, { postId: 'post-1', action, locale: 'en' }));
    await submit(container.querySelector('form')!);
    await flush();
    expect(action).toHaveBeenCalledOnce();
    expect([...action.mock.calls[0] as unknown as [FormData]][0].get('postId')).toBe('post-1');
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('could not be cancelled');
    expect(alert.textContent).not.toContain('stack trace');
    expect(container.querySelector('button')!.disabled).toBe(false);
  });
  it('answers in French', async () => {
    await render(createElement(CancelScheduleForm, { postId: 'post-1', action: async () => { throw new Error('x'); }, locale: 'fr' }));
    await submit(container.querySelector('form')!);
    await flush();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('n’a pas pu être annulée');
  });
});

describe('Root activity controls', () => {
  it('keeps typed retention values and shows the catalog failure when the save request throws', async () => {
    const save = vi.fn(async () => { throw new Error('raw database failure'); });
    await render(createElement(AuditRetention, { days: 30, exportRows: 100, batchSize: 10, save }));
    const days = container.querySelector<HTMLInputElement>('input[name="days"]')!;
    await fill(days, '45');
    await submit(container.querySelector('form')!);
    await flush();
    expect(save).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLInputElement>('input[name="days"]')!.value).toBe('45');
    expect(container.querySelector('[role="status"]')!.textContent).toBe(ROOT_AUDIT_CONTROLS_COPY.saveFailure);
  });
  it('maps a failed export to the catalog sentence, never the response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, headers: new Headers(), json: async () => ({ error: 'ECONNREFUSED 10.0.0.5:5432' }) })));
    await render(createElement(AuditExport, { href: '/api/root/activity/export', limit: 100 }));
    await act(async () => container.querySelector('button')!.click());
    await flush();
    expect(container.querySelector('[role="status"]')!.textContent).toBe(ROOT_AUDIT_CONTROLS_COPY.exportFailure);
  });
});

describe('two-step failure messages', () => {
  async function verifyWith(response: { status: number; body?: unknown } | 'offline') {
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (response === 'offline') throw new TypeError('network');
      return { ok: false, status: response.status, json: async () => response.body ?? {} };
    }));
    await render(createElement(VerifyForm, { hasPasskey: false }));
    await fill(container.querySelector<HTMLInputElement>('input[name="code"]')!, '123456');
    await submit(container.querySelector('form')!);
    await flush();
    return container.textContent ?? '';
  }
  it('says the code was not accepted only for a real rejection', async () => {
    expect(await verifyWith({ status: 401, body: { code: 'VERIFICATION_FAILED' } })).toContain('The code was not accepted');
  });
  it.each([[{ status: 500 }], [{ status: 502 }], [{ status: 401 }], ['offline' as const]])('reports %j as temporarily unavailable', async failure => {
    const text = await verifyWith(failure);
    expect(text).toContain('temporarily unavailable');
    expect(text).not.toContain('was not accepted');
  });
});

describe('tokenless join page', () => {
  it('shows a clear themed message instead of a raw server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) })));
    await render(createElement(JoinForm, { passwordPolicy: { minLength: 8, maxBytes: 800 } }));
    await flush();
    expect(container.textContent).toContain('There is no invitation to open here');
    expect(container.textContent).not.toContain('Not found');
    expect(container.querySelector('[role="alert"], [role="status"]')).not.toBeNull();
  });
  it('does not show a server error body for a failed preview that had a token', async () => {
    window.history.replaceState(null, '', '/#abc');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'TypeError at db.ts:42' }) })));
    await render(createElement(JoinForm, { passwordPolicy: { minLength: 8, maxBytes: 800 } }));
    await flush();
    expect(container.textContent).toContain('could not be opened');
    expect(container.textContent).not.toContain('db.ts');
  });
});

describe('calendar today badge contrast', () => {
  const luminance = (channel: number) => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const contrastWithWhite = (grey: number) => 1.05 / (0.2126 * luminance(grey) + 0.7152 * luminance(grey) + 0.0722 * luminance(grey) + 0.05);
  it('darkens the accent enough that white text passes AA for any accent, including white', () => {
    const css = readFileSync('src/modules/publishing/ui/calendar/calendar.module.css', 'utf8');
    const mixes = [...css.matchAll(/background: color-mix\(in srgb, var\(--mod, var\(--accent\)\) (\d+)%, black\); color: #fff/g)].map(match => Number(match[1]));
    expect(mixes.length).toBe(2);
    for (const percent of mixes) expect(contrastWithWhite(255 * percent / 100)).toBeGreaterThanOrEqual(4.5);
  });
});
