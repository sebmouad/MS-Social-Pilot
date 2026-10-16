// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  action: vi.fn(async (_previous: unknown, _data: FormData) => ({ status: 'error', message: 'safe failure', values: {} })),
}));
vi.mock('../src/app/publishing/posts/actions', () => ({ createPostWithRecoveryAction: mocks.action }));

import { SidebarDockContext } from '../src/components/SidebarDock';
import { PostComposer } from '../src/app/publishing/compose/PostComposer';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let dock: HTMLDivElement;
const targets = [{ id: 'target-a', name: 'Studio channel', type: 'channel', provider: null, canPublish: true }];
const rules = { allowedMimeTypes: ['image/png'], maxUploadBytes: 5000, maxAltCharacters: 120, maxMessageCharacters: 500 };
const schedule = { date: '2026-10-20', time: '10:30', timeZone: 'UTC' };

async function render() {
  await act(async () => root.render(createElement(SidebarDockContext.Provider, { value: dock }, createElement(PostComposer, { targets, imageRules: rules, schedule, authorName: 'Your team', createdAt: new Date('2026-10-16T10:00:00.000Z'), createdAtDisplay: 'Oct 16, 2026, 10:00 AM' }))));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); dock = document.createElement('div'); document.body.append(container, dock); root = createRoot(container);
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reference: 'media:123e4567-e89b-42d3-a456-426614174000' }) }));
  class TestURL extends URL { static createObjectURL = vi.fn(() => 'blob:preview'); static revokeObjectURL = vi.fn(); }
  vi.stubGlobal('URL', TestURL);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); dock.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('dedicated post composer', () => {
  it('keeps the sidebar destinations associated with the form and updates the neutral preview', async () => {
    await render();
    const message = container.querySelector<HTMLTextAreaElement>('#composer-message')!;
    const nativeTextValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!;
    await act(async () => { nativeTextValue.set!.call(message, 'A useful update'); message.dispatchEvent(new Event('input', { bubbles: true })); });
    const destination = dock.querySelector<HTMLInputElement>('input[name="targetIds"]')!;
    await act(async () => { destination.click(); });

    expect(destination.form?.id).toBe('post-composer-form');
    expect(container.textContent).toContain('A useful update');
    expect(container.textContent).toContain('Studio channel');
    expect(container.textContent).toContain('Unsaved preview');
  });

  it('uploads a selected file once and submits the post once after upload completes', async () => {
    await render();
    await act(async () => dock.querySelector<HTMLInputElement>('input[name="targetIds"]')!.click());
    await act(async () => container.querySelector<HTMLInputElement>('input[name="attachmentChoice"][value="upload"]')?.click());
    const input = container.querySelector<HTMLInputElement>('#composer-upload')!;
    const file = new File(['image-bytes'], 'post.png', { type: 'image/png' });
    let liveFiles: { 0?: File; length: number; item: (index: number) => File | null } = { 0: file, length: 1, item: (index: number) => index === 0 ? file : null };
    Object.defineProperty(input, 'files', { configurable: true, get: () => liveFiles });
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(input, 'value', { configurable: true, get: () => nativeValue.get!.call(input), set: value => { nativeValue.set!.call(input, value); if (value === '') liveFiles = { length: 0, item: () => null }; } });
    const message = container.querySelector<HTMLTextAreaElement>('#composer-message')!;
    const nativeTextValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!;
    await act(async () => { nativeTextValue.set!.call(message, 'Upload this image'); message.dispatchEvent(new Event('input', { bubbles: true })); });
    const submitter = dock.querySelector<HTMLButtonElement>('button[name="intent"][value="draft"]')!;

    await act(async () => submitter.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.action).toHaveBeenCalledTimes(1);
    const submitted = mocks.action.mock.calls[0]![1] as FormData;
    expect(submitted.get('uploadedImageRef')).toBe('media:123e4567-e89b-42d3-a456-426614174000');
    expect(submitted.get('intent')).toBe('draft');
    expect(submitter.disabled).toBe(false);
    expect(container.querySelector<HTMLTextAreaElement>('#composer-message')?.value).toBe('Upload this image');
  });

  it('keeps composer fields and retry available when the server action transport rejects', async () => {
    mocks.action.mockRejectedValueOnce(new Error('Network request failed with internal transport detail'));
    await render();
    const message = container.querySelector<HTMLTextAreaElement>('#composer-message')!;
    const firstComment = container.querySelector<HTMLTextAreaElement>('#composer-first-comment')!;
    const textSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      textSetter.call(message, 'Offline draft text'); message.dispatchEvent(new Event('input', { bubbles: true }));
      textSetter.call(firstComment, 'Offline follow-up'); firstComment.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => dock.querySelector<HTMLButtonElement>('button[name="intent"][value="draft"]')!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(container.querySelector<HTMLTextAreaElement>('#composer-message')?.value).toBe('Offline draft text');
    expect(container.querySelector<HTMLTextAreaElement>('#composer-first-comment')?.value).toBe('Offline follow-up');
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/could not confirm whether this post was saved/i);
    expect(container.querySelector('a[href="/publishing/posts"]')?.getAttribute('target')).toBe('_blank');
    expect(container.textContent).not.toContain('internal transport detail');
    expect(dock.querySelector<HTMLButtonElement>('button[name="intent"][value="draft"]')?.disabled).toBe(false);
  });
});
