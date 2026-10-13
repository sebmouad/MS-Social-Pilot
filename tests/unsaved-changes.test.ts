// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
const { ask, push } = vi.hoisted(() => ({ ask: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('../src/components/ConfirmProvider', () => ({ useConfirm: () => ask }));
import { useUnsavedChanges } from '../src/components/useUnsavedChanges';
let dispose: (() => Promise<void>) | undefined;
function Editor({ dirty }: { dirty: boolean }) { useUnsavedChanges(dirty, { title: 'Leave settings?' }); return createElement('a', { href: '/root/status' }, 'Status'); }
afterEach(async () => { await dispose?.(); document.body.innerHTML = ''; ask.mockReset(); push.mockReset(); });
it('keeps unsaved root settings on declined navigation and leaves only once approved', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  dispose = async () => { await act(async () => root.unmount()); };
  await act(async () => root.render(createElement(Editor, { dirty: true })));
  ask.mockResolvedValueOnce(false);
  await act(async () => host.querySelector('a')!.click());
  expect(ask).toHaveBeenCalledTimes(1); expect(push).not.toHaveBeenCalled();
  ask.mockResolvedValueOnce(true);
  await act(async () => host.querySelector('a')!.click());
  expect(push).toHaveBeenCalledWith('/root/status');
});
it('protects reload while dirty and removes protection after save', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  dispose = async () => { await act(async () => root.unmount()); };
  await act(async () => root.render(createElement(Editor, { dirty: true })));
  const dirty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirty); expect(dirty.defaultPrevented).toBe(true);
  await act(async () => root.render(createElement(Editor, { dirty: false })));
  const saved = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(saved); expect(saved.defaultPrevented).toBe(false);
});
