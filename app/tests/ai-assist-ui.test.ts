// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiAssist } from '../src/modules/studio/components/AiAssist';
import { aiCopy } from '../src/modules/studio/copy';

const status = { available: true, kinds: ['caption', 'improve', 'translate', 'hashtags'], tones: ['friendly', 'urgent'], maxInputCharacters: 4000 };
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const render = (props: Partial<Parameters<typeof AiAssist>[0]> & { onUse?: (s: string, k: string) => void }) => act(async () => root.render(createElement(AiAssist, { text: 'rough post', onUse: () => undefined, status, ...props })));
const click = (label: string) => act(async () => { [...container.querySelectorAll('button')].find(b => b.textContent === label)!.click(); });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ kind: 'improve', text: 'Better post', hashtags: [] })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('AI assist component', () => {
  it('renders nothing and makes no request when assist is unavailable or the status is absent', async () => {
    await render({ status: undefined }); expect(container.innerHTML).toBe('');
    await render({ status: { ...status, available: false } }); expect(container.innerHTML).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('only proposes text: the post changes solely when the member presses Use this text', async () => {
    const onUse = vi.fn();
    await render({ onUse });
    await click(aiCopy.en.run);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Better post'); expect(container.textContent).toContain(aiCopy.en.note);
    expect(onUse).not.toHaveBeenCalled();
    await click(aiCopy.en.discard);
    expect(onUse).not.toHaveBeenCalled(); expect(container.textContent).not.toContain('Better post');
    await click(aiCopy.en.run); await click(aiCopy.en.useReplace);
    expect(onUse).toHaveBeenCalledTimes(1); expect(onUse).toHaveBeenCalledWith('Better post', 'improve');
  });
  it('validates locally, keeps the text on failure and shows French copy', async () => {
    await render({ text: '   ' }); await click(aiCopy.en.run);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(aiCopy.en.needText); expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'This workspace has reached its hourly AI assist limit. Try again later.' }, { status: 409 })));
    const onUse = vi.fn(); await render({ onUse }); await click(aiCopy.en.run);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/hourly AI assist limit/); expect(onUse).not.toHaveBeenCalled();
    await render({ locale: 'fr' }); expect(container.textContent).toContain(aiCopy.fr.heading);
  });
});
