// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/modules/publishing/ui/posts/actions', () => ({ publishPostAction: vi.fn() }));
import { PublishNowButton, publishNowCopy } from '../src/modules/publishing/ui/posts/PublishNowButton';

let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  document.documentElement.lang = 'en';
  HTMLFormElement.prototype.requestSubmit = vi.fn();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

const render = async (seconds: number) => act(async () => root.render(createElement(PublishNowButton, { postId: 'p1', undoSendSeconds: seconds })));
const button = (text: string) => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const tick = async (ms: number) => { for (let elapsed = 0; elapsed < ms; elapsed += 1000) await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); };

it('submits straight away when the undo window is 0', async () => {
  await render(0);
  await act(async () => button(publishNowCopy.en.publish)!.click());
  expect(HTMLFormElement.prototype.requestSubmit).toHaveBeenCalledTimes(1);
});

it('counts down and submits once when the window elapses', async () => {
  await render(3);
  await act(async () => button(publishNowCopy.en.publish)!.click());
  expect(container.querySelector('[role="status"]')?.textContent).toBe(publishNowCopy.en.countdown(3));
  expect(HTMLFormElement.prototype.requestSubmit).not.toHaveBeenCalled();
  await tick(2000);
  expect(container.querySelector('[role="status"]')?.textContent).toBe(publishNowCopy.en.countdown(1));
  expect(HTMLFormElement.prototype.requestSubmit).not.toHaveBeenCalled();
  await tick(1000);
  await tick(1000);
  expect(HTMLFormElement.prototype.requestSubmit).toHaveBeenCalledTimes(1);
});

it('Undo cancels the pending publish', async () => {
  await render(5);
  await act(async () => button(publishNowCopy.en.publish)!.click());
  await tick(2000);
  await act(async () => button(publishNowCopy.en.undo)!.click());
  await tick(10000);
  expect(HTMLFormElement.prototype.requestSubmit).not.toHaveBeenCalled();
  expect(button(publishNowCopy.en.publish)).toBeTruthy();
});

it('uses French copy for a French page', async () => {
  document.documentElement.lang = 'fr';
  await render(2);
  expect(button(publishNowCopy.fr.publish)).toBeTruthy();
});
