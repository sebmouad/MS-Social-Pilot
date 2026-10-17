// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThreadProductivity } from '../src/modules/inbox/components/ThreadProductivity';

let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const productivity = { ok: true, assignment: { assigneeId: null, members: [] }, notes: [], limits: { noteMaxCharacters: 37, savedReplyNameMaxCharacters: 21, savedReplyBodyMaxCharacters: 83 } };
const reply = { id: 'reply-a', name: 'Greeting', body: 'Hello from the team' };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('view=saved-replies') ? { ok: true, replies: [reply] } : productivity })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render(onUseSavedReply = vi.fn()) {
  await act(async () => root.render(createElement(ThreadProductivity, { kind: 'message', id: 'conversation-a', onUseSavedReply })));
  return onUseSavedReply;
}
async function click(button: HTMLButtonElement) { await act(async () => button.click()); }

describe('Inbox productivity controls', () => {
  it('uses server-provided Root limits for private note and saved reply fields', async () => {
    await render();
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Private note"]')?.maxLength).toBe(37);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Saved reply name"]')?.maxLength).toBe(21);
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Saved reply text"]')?.maxLength).toBe(83);
  });

  it('only copies a saved reply into the explicit parent callback and never auto-posts', async () => {
    const useReply = await render();
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === 'Use reply');
    expect(button).toBeTruthy();
    await click(button as HTMLButtonElement);
    expect(useReply).toHaveBeenCalledWith(reply.body);
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});
