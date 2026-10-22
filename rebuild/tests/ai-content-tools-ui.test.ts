// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptionTestsScreen, type CaptionAction } from '../src/modules/caption-tests/ui/CaptionTestsScreen';
import { CAPTION_TESTS_COPY } from '../src/modules/caption-tests/copy';
import { AiStudioScreen } from '../src/modules/ai/content-tools/ui/AiStudioScreen';
import { TOOLS_COPY } from '../src/modules/ai/content-tools/copy';
import type { CaptionTestView } from '../src/modules/caption-tests/server/service';
import type { MediaStatus } from '../src/modules/ai/content-tools/server/media';

let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const dialog = HTMLDialogElement.prototype as { showModal?: () => void; close?: () => void };
  dialog.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); }; dialog.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(label));
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const click = async (label: string) => { await act(async () => { button(label)!.click(); }); await flush(); };
const submitForm = async () => { await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await flush(); };

const test: CaptionTestView = {
  id: 't1', name: 'Spring offer', status: 'decided', reason: null, winnerLabel: 'A', lift: 100, hours: 48, minViews: 500, createdAt: '2026-10-10T08:00:00.000Z', dueAt: '2026-10-14T09:00:00.000Z', decidedAt: '2026-10-15T00:00:00.000Z', learnedAt: null,
  results: [{ label: 'A', views: 1000, engagements: 100, rate: 0.1 }, { label: 'B', views: 1000, engagements: 50, rate: 0.05 }],
  posts: [{ id: 'pa', label: 'A', message: 'Caption A text', channels: [{ id: 'c1', name: 'Alpha', publishedAt: null }] }, { id: 'pb', label: 'B', message: 'Caption B text', channels: [{ id: 'c1', name: 'Alpha', publishedAt: null }] }],
};
const limits = { minCaptions: 2, maxCaptions: 4, defaultHours: 48, minHours: 1, maxHours: 720, defaultMinViews: 500, maxMinViews: 1000000 };
let mounts = 0;
// A fresh key per render: the screen keeps its own state, so a new scenario must remount it.
const screen = (over: Partial<Parameters<typeof CaptionTestsScreen>[0]> = {}) => createElement(CaptionTestsScreen, { key: `m${mounts++}`, tests: [test], posts: [], canLearn: true, canStart: true, limits, copy: CAPTION_TESTS_COPY.en, locale: 'en', execute: async () => ({ ok: true as const }), ...over });

describe('caption tests screen', () => {
  it('shows each caption with its figures, marks the winner in words and offers learning', async () => {
    await act(async () => root.render(screen()));
    expect(container.querySelector('h1')!.textContent).toBe('Caption tests');
    expect(container.textContent).toContain('Caption A won (+100% engagement per view)');
    expect(container.textContent).toContain('10%'); expect(container.textContent).toContain('1,000');
    expect(container.querySelector('li[class*="won"]')!.textContent).toContain('Winner');
    expect(button('Add to workspace voice')).toBeTruthy();
  });
  it('asks before learning, sends only the test id and shows the result without losing the list', async () => {
    const execute = vi.fn(async (_: CaptionAction) => ({ ok: true as const, tests: [{ ...test, learnedAt: '2026-10-16T00:00:00.000Z' }] }));
    await act(async () => root.render(screen({ execute })));
    await click('Add to workspace voice');
    expect(execute).not.toHaveBeenCalled();
    await click('Confirm');
    expect(execute).toHaveBeenCalledWith({ type: 'learn', id: 't1' });
    expect(container.textContent).toContain('Added to the workspace voice.'); expect(button('Add to workspace voice')).toBeUndefined();
  });
  it('keeps the page and shows the safe message when learning fails', async () => {
    await act(async () => root.render(screen({ execute: async () => ({ error: 'The result could not be added. Try again.' }) })));
    await click('Add to workspace voice'); await click('Confirm');
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('could not be added'); expect(container.textContent).toContain('Spring offer');
  });
  it('hides learning and starting from people who cannot do them, and explains an empty list', async () => {
    await act(async () => root.render(screen({ canLearn: false, canStart: false })));
    expect(button('Add to workspace voice')).toBeUndefined(); expect(button('Start a test')).toBeUndefined();
    await act(async () => root.render(screen({ tests: [], canLearn: false, canStart: false })));
    expect(container.textContent).toContain('No caption tests yet');
  });
  it('explains an inconclusive test in plain words', async () => {
    await act(async () => root.render(screen({ tests: [{ ...test, status: 'inconclusive', reason: 'not_enough_views', winnerLabel: null, lift: null }] })));
    expect(container.textContent).toContain('No winner: a caption had fewer than 500 views'); expect(button('Add to workspace voice')).toBeUndefined();
  });
  it('starts a test only with at least two different posts, after confirmation', async () => {
    const execute = vi.fn(async (_: CaptionAction) => ({ ok: true as const, tests: [test] }));
    const posts = [{ id: 'p1', message: 'One', status: 'scheduled' }, { id: 'p2', message: 'Two', status: 'scheduled' }];
    await act(async () => root.render(screen({ posts, execute })));
    await click('Start a test');
    const submit = [...container.querySelectorAll('button[type="submit"]')].find(b => b.textContent === 'Start test') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const selects = container.querySelectorAll('select');
    for (const [index, id] of ['p1', 'p2'].entries()) await act(async () => { const select = selects[index]!; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, id); select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    await submitForm();
    await click('Confirm');
    expect(execute).toHaveBeenCalledWith({ type: 'start', input: { hours: 48, minViews: 500, postIds: ['p1', 'p2'] } });
  });
  it('renders French copy', async () => {
    await act(async () => root.render(screen({ copy: CAPTION_TESTS_COPY.fr, locale: 'fr' })));
    expect(container.querySelector('h1')!.textContent).toBe('Tests de légendes'); expect(container.textContent).toContain('La légende A l’emporte');
  });
});

const status = (over: Partial<MediaStatus> = {}): MediaStatus => ({
  image: { available: true, sizes: [{ id: 'square', label: { en: 'Square', fr: 'Carré' } }], defaultSize: 'square', promptMaxCharacters: 1000 },
  voice: { available: true, voices: ['marin', 'nova'], defaultVoice: 'marin', textMaxCharacters: 2000 },
  video: { available: true, aspectRatios: [{ id: '16:9', label: { en: 'Landscape', fr: 'Paysage' } }], defaultAspectRatio: '16:9', promptMaxCharacters: 1000 },
  confirmations: { image: 'GENERATE IMAGE', voice: 'GENERATE VOICE', video: 'GENERATE VIDEO' }, ...over,
});
const studio = (over: Partial<Parameters<typeof AiStudioScreen>[0]> = {}) => createElement(AiStudioScreen, { status: status(), videos: [], channels: [{ id: 'c1', name: 'Alpha' }], canCheck: true, copy: TOOLS_COPY.en, locale: 'en', ...over });
const type = (element: Element, value: string) => act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });

describe('Create with AI screen', () => {
  it('asks for consent, then sends the exact confirmation to the shared REST service and shows the saved picture', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ id: 'img-1' }));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(studio()));
    await type(container.querySelector('textarea')!, 'A red kite over the sea');
    await submitForm();
    expect(fetchMock).not.toHaveBeenCalled();
    await click('Confirm');
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/image', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ prompt: 'A red kite over the sea', size: 'square', confirmation: 'GENERATE IMAGE' });
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/api/media/img-1'); expect(container.textContent).toContain('Saved to your media library.');
  });
  it('shows a safe failure message and keeps the prompt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'The AI service could not finish this. Try again later.' }, { status: 502 })));
    await act(async () => root.render(studio()));
    await type(container.querySelector('textarea')!, 'A red kite');
    await submitForm();
    await click('Confirm');
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('could not finish'); expect(container.querySelector('textarea')!.value).toBe('A red kite');
  });
  it('shows an unavailable state instead of a stub when a kind is off, and the budget note', async () => {
    await act(async () => root.render(studio({ status: status({ image: { available: false, sizes: [], defaultSize: null, promptMaxCharacters: null }, usage: { month: '2026-10', requests: 3, spentUsd: 4, unpricedRequests: 0, budgetUsd: 10, remainingUsd: 6 } }) })));
    expect(container.textContent).toContain('This is not available for your workspace right now.'); expect(container.textContent).toContain('$6');
    expect(container.querySelector('textarea')).toBeNull();
  });
  it('lists videos with their state and renders French', async () => {
    await act(async () => root.render(studio({ copy: TOOLS_COPY.fr, locale: 'fr', videos: [{ id: 'v1', prompt: 'Vagues', aspectRatio: '16:9', status: 'working', mediaId: null, error: null, createdAt: '2026-10-22T00:00:00.000Z' }] })));
    expect(container.querySelector('h1')!.textContent).toBe('Créer avec l’IA');
    await click('Vidéo');
    expect(container.textContent).toContain('En cours de création'); expect(container.textContent).toContain('Vagues');
  });
});
