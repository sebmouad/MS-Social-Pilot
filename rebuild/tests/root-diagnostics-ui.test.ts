// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: deps.refresh }) }));
vi.mock('../src/components/SidebarDock', () => ({ SidebarDock: ({ children }: { children: import('react').ReactNode }) => children }));
import { RootDiagnosticsClient } from '../src/server/root/RootDiagnosticsClient';
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const initial = { scope: 'platform:facebook', label: 'Facebook', timeZone: 'UTC', enabled: true, minimumIntervalSeconds: 30, incompleteRunStaleSeconds: 600, connectionLimit: 10, connections: [{ id: 'source', name: 'Example source', workspaceId: 'preview_workspace' }], history: [] };
const receipt = { id: 'diag_test', scope: initial.scope, connectionId: null, startedAt: '2026-10-16T00:00:00.000Z', finishedAt: '2026-10-16T00:00:01.000Z', checks: [{ id: 'identity', label: 'Identity', status: 'skipped', code: 'choose_connection', message: 'Choose a source.', durationMs: 1 }], auditRecorded: true };
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(RootDiagnosticsClient, { initial })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const button = () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Run diagnostics')!;
describe('Root diagnostic run recovery', () => {
  it('sends exact scope confirmation, blocks repeat submissions and accepts matching receipt only', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetch);
    await act(async () => { const submit = button(); submit.click(); submit.click(); });
    expect(fetch).toHaveBeenCalledOnce(); expect(container.querySelector('button')?.disabled).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({ scope: initial.scope, confirmation: `RUN DIAGNOSTICS ${initial.scope}` });
    await act(async () => resolve(Response.json(receipt)));
    expect(container.querySelector('[role=status]')?.textContent).toContain('1 skipped'); expect(deps.refresh).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(container.querySelector('.root-diagnostics__feedback'));
  });
  it('retains selected connection after recoverable service failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Wait before retrying.' }, { status: 409 })));
    const select = container.querySelector('select')!;
    await act(async () => { select.value = 'source'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => button().click());
    expect(select.value).toBe('source'); expect(container.querySelector('[role=alert]')?.textContent).toContain('Wait before retrying'); expect(deps.refresh).not.toHaveBeenCalled();
  });
  it.each([{ ...receipt, scope: 'shared' }, { ...receipt, connectionId: 'wrong' }, { ...receipt, auditRecorded: undefined }])('refuses mismatching or incomplete receipts', async invalid => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(invalid))); await act(async () => button().click());
    expect(container.querySelector('[role=alert]')?.textContent).toContain('unconfirmed'); expect(deps.refresh).not.toHaveBeenCalled();
  });
  it('preserves completed results and warns about failed audit persistence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...receipt, auditRecorded: false })));
    await act(async () => button().click());
    expect(container.querySelector('[role=alert]')?.textContent).toContain('Completion audit could not be recorded'); expect(container.textContent).toContain('Choose a source.');
  });
});
