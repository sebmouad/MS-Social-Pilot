// @vitest-environment jsdom
import type { ComposerActionState } from '../src/modules/publishing/ui/posts/actions';
import type { PublishingFormatDescriptor } from '../src/platforms/types';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  action: vi.fn(async (_previous: unknown, _data: FormData): Promise<ComposerActionState> => ({ status: 'error', message: 'safe failure', values: {} })),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../src/modules/publishing/ui/posts/actions', () => ({ createPostWithRecoveryAction: mocks.action }));

import { SidebarDockContext } from '../src/components/SidebarDock';
import { PostComposer } from '../src/modules/publishing/ui/compose/PostComposer';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let dock: HTMLDivElement;
const targets = [{ id: 'target-a', name: 'Studio channel', type: 'channel', provider: 'facebook', canPublish: true, publishingMedia: { kinds: ['image', 'video'] as const, maxImages: 2, maxVideos: 1, mixedKinds: true, linkWithMedia: false, imageAltText: true }, localImageUpload: { maxBytes: 5000, mimeTypes: ['image/png'] } }];
type TestTarget = { id: string; name: string; type: string; provider: string | null; canPublish: boolean; publishingFormats?: readonly PublishingFormatDescriptor[]; defaultPublishingFormatId?: string; publishingMedia?: { kinds: readonly ('image' | 'video')[]; maxImages: number | null; maxVideos: number | null; mixedKinds: boolean; linkWithMedia: boolean; imageAltText: boolean }; localImageUpload?: { maxBytes: number; mimeTypes: readonly string[] } };
const rules = { allowedMimeTypes: ['image/png'], maxUploadBytes: 5000, maxAltCharacters: 120, maxMessageCharacters: 500, maxMedia: 2 };
const schedule = { date: '2026-10-20', time: '10:30', timeZone: 'UTC' };

async function render(targetChoices: TestTarget[] = targets, templates: Array<{ id: string; name: string; category: string; body: string; hashtags: string; firstComment: string; firstCommentDelayMinutes: number; labelId: string | null }> = []) {
  await act(async () => root.render(createElement(SidebarDockContext.Provider, { value: dock }, createElement(PostComposer, { targets: targetChoices, templates, imageRules: rules, maxFirstCommentDelayMinutes: 10080, schedule, authorName: 'Your team', createdAt: new Date('2026-10-16T10:00:00.000Z'), createdAtDisplay: 'Oct 16, 2026, 10:00 AM' }))));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); dock = document.createElement('div'); document.body.append(container, dock); root = createRoot(container);
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reference: 'media:123e4567-e89b-42d3-a456-426614174000' }) }));
  class TestURL extends URL { static createObjectURL = vi.fn(() => 'blob:preview'); static revokeObjectURL = vi.fn(); }
  vi.stubGlobal('URL', TestURL);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); dock.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('dedicated post composer', () => {
  it('exposes a bounded accessible minute field and applies the template delay', async () => {
    await render(targets, [{ id: 'template-a', name: 'Welcome', category: '', body: 'Hello', hashtags: '', firstComment: 'Follow up', firstCommentDelayMinutes: 37, labelId: null }]);
    await act(async () => dock.querySelector<HTMLButtonElement>('button')!.click());
    const choose = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === 'Use template')!;
    await act(async () => choose.click());
    const delay = container.querySelector<HTMLInputElement>('#composer-first-comment-delay')!;
    expect(delay.labels?.[0]?.textContent).toMatch(/minutes/i);
    expect(delay.min).toBe('0'); expect(delay.max).toBe('10080');
    expect(container.querySelector<HTMLInputElement>('#composer-first-comment-delay')?.value).toBe('37');
    expect(container.querySelector<HTMLTextAreaElement>('#composer-first-comment')?.value).toBe('Follow up');
  });
  it('navigates only after confirmed save and prevents another submission while opening Posts', async () => {
    mocks.action.mockResolvedValueOnce({status:'success',destination:'/publishing/posts?notice=created',values:{}});
    await render();
    const link=container.querySelector<HTMLInputElement>('#composer-link')!;
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
    await act(async()=>{setter.call(link,'https://example.test/saved');link.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async()=>dock.querySelector<HTMLButtonElement>('button[name="intent"][value="draft"]')!.click());
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/publishing/posts?notice=created');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Post saved');
    expect(container.querySelector<HTMLTextAreaElement>('#composer-message')!.disabled).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>('#composer-first-comment')!.disabled).toBe(true);
    expect(container.textContent).toContain('Saved post preview');
    expect(container.querySelector<HTMLAnchorElement>('a[href="/publishing/posts?notice=created"]')).not.toBeNull();
    expect(dock.querySelector<HTMLButtonElement>('button[name="intent"][value="draft"]')!.disabled).toBe(true);
    expect(mocks.action).toHaveBeenCalledTimes(1);
  });

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

  it('saves a no-caption post with a link and leaves its preview focused on the link content', async () => {
    await render();
    const link = container.querySelector<HTMLInputElement>('#composer-link')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(link, 'https://example.com/story'); link.dispatchEvent(new Event('input', { bubbles: true })); });
    const preview = container.querySelector('[data-variant="card"]')!;
    expect(preview.textContent).not.toContain('Your post text will appear here');
    expect(preview.textContent).not.toContain('No text included');
    expect(preview.textContent).toContain('Open shared link');

    await act(async () => dock.querySelector<HTMLButtonElement>('button[name="intent"][value="draft"]')!.click());

    expect(mocks.action).toHaveBeenCalledTimes(1);
    expect((mocks.action.mock.calls[0]![1] as FormData).get('message')).toBe('');
  });

  it('shows the first-comment delay only once there is a first comment, and still submits its value', async () => {
    await render();
    expect(container.querySelector('#composer-first-comment-delay')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[type="hidden"][name="firstCommentDelayMinutes"]')?.value).toBe('0');
    const comment = container.querySelector<HTMLTextAreaElement>('#composer-first-comment')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(comment, 'Link in the first comment'); comment.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(container.querySelector('#composer-first-comment-delay')).not.toBeNull();
  });

  it('rejects first-comment-only posts when attachment URL rows are still empty', async () => {
    await render();
    const addImage = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === 'Add media link')!;
    await act(async () => addImage.click());
    const comment = container.querySelector<HTMLTextAreaElement>('#composer-first-comment')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(comment, 'A first comment only'); comment.dispatchEvent(new Event('input', { bubbles: true })); });

    await act(async () => dock.querySelector<HTMLButtonElement>('button[name="intent"][value="draft"]')!.click());

    expect(mocks.action).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/add post text, a link, or media/i);
    expect(document.activeElement).toBe(container.querySelector('[role="alert"]'));
  });

  it('hides local upload for a selected remote-only destination without provider-specific rules', async () => {
    const remoteOnly = [{ id: 'remote-only', name: 'Remote-only fake provider', type: 'channel', provider: 'fake-provider', canPublish: true, publishingMedia: { kinds: ['image'] as const, maxImages: 3, maxVideos: 0, mixedKinds: false, linkWithMedia: true, imageAltText: false } }];
    await render(remoteOnly);
    await act(async () => dock.querySelector<HTMLInputElement>('input[name="targetIds"]')!.click());

    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Add local images')).toBe(false);
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Add media link')).toBe(true);
  });

  it('uploads a selected file once and submits the post once after upload completes', async () => {
    await render();
    await act(async () => dock.querySelector<HTMLInputElement>('input[name="targetIds"]')!.click());
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Add local images')).toBe(true);
    const input = container.querySelector<HTMLInputElement>('[data-testid="local-image-input"]')!;
    const file = new File(['image-bytes'], 'post.png', { type: 'image/png' });
    let liveFiles: { 0?: File; length: number; item: (index: number) => File | null } = { 0: file, length: 1, item: (index: number) => index === 0 ? file : null };
    Object.defineProperty(input, 'files', { configurable: true, get: () => liveFiles });
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(input, 'value', { configurable: true, get: () => nativeValue.get!.call(input), set: value => { nativeValue.set!.call(input, value); if (value === '') liveFiles = { length: 0, item: () => null }; } });
    const message = container.querySelector<HTMLTextAreaElement>('#composer-message')!;
    const nativeTextValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!;
    await act(async () => { nativeTextValue.set!.call(message, 'Upload this image'); message.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const submitter = dock.querySelector<HTMLButtonElement>('button[name="intent"][value="draft"]')!;

    await act(async () => submitter.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.action).toHaveBeenCalledTimes(1);
    const submitted = mocks.action.mock.calls[0]![1] as FormData;
    expect(JSON.parse(String(submitted.get('mediaJson')))).toEqual([{ kind: 'image', url: 'media:123e4567-e89b-42d3-a456-426614174000' }]);
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

  it('serializes remote media in visible order with each image description attached', async () => {
    await render();
    const addButton = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === label)!;
    await act(async () => addButton('Add media link').click());
    await act(async () => addButton('Add media link').click());
    expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
    expect(Array.from(container.querySelectorAll('button')).some(button => /Add (image|video) URL/.test(button.textContent ?? ''))).toBe(false);
    // Linked media starts as an image; the person (or the loaded preview) can correct the type of the second link.
    const typeSelect = container.querySelectorAll<HTMLSelectElement>('select')[1]!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(typeSelect, 'video');
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const urls = Array.from(container.querySelectorAll<HTMLInputElement>('input[name^="mediaUrl-"]'));
    const imageUrl = urls[0]!;
    const videoUrl = urls[1]!;
    const alt = container.querySelector<HTMLInputElement>('input[name^="mediaAlt-"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(imageUrl, 'https://example.com/image.png'); imageUrl.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(videoUrl, 'https://example.com/video.mp4'); videoUrl.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(alt, 'Studio exterior'); alt.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Move attachment 2 up"]')?.click());
    const field = container.querySelector<HTMLInputElement>('input[name="mediaJson"]')!;

    expect(JSON.parse(field.value)).toEqual([
      { kind: 'video', url: 'https://example.com/video.mp4' },
      { kind: 'image', url: 'https://example.com/image.png', altText: 'Studio exterior' },
    ]);
    expect(container.textContent).toContain('Video 1');
    expect(container.textContent).toContain('Image 2');
  });

  it('checks destination combinations before uploading or submitting', async () => {
    await render();
    await act(async () => dock.querySelector<HTMLInputElement>('input[name="targetIds"]')!.click());
    const fileInput = container.querySelector<HTMLInputElement>('[data-testid="local-image-input"]')!;
    const file = new File(['image-bytes'], 'post.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { configurable: true, get: () => ({ 0: file, length: 1, item: (index: number) => index === 0 ? file : null }) });
    const link = container.querySelector<HTMLInputElement>('#composer-link')!;
    const message = container.querySelector<HTMLTextAreaElement>('#composer-message')!;
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      setInput.call(link, 'https://example.com'); link.dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(message, 'A link and image'); message.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => dock.querySelector<HTMLButtonElement>('button[name="intent"][value="draft"]')!.click());

    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.action).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/cannot combine a link with media/i);
  });
});

 it('keeps portal destination controls and format serialization in sync when an action requests a native form reset', async () => {
 const format:PublishingFormatDescriptor={id:'compact',label:'Compact',media:{kinds:[],maxImages:0,maxVideos:0,mixedKinds:false,linkWithMedia:false,imageAltText:false},firstComment:true,remoteStatus:true,remoteDelete:true,scheduling:{application:true,native:false}};
 await render([{...targets[0]!,publishingFormats:[format],defaultPublishingFormatId:'compact'}]);
 const destination=dock.querySelector<HTMLInputElement>('input[name="targetIds"]')!;
 await act(async()=>destination.click());
 const form=container.querySelector<HTMLFormElement>('#post-composer-form')!;
 expect(destination.checked).toBe(true);
 await act(async()=>form.reset());
 expect(destination.checked).toBe(true);
 expect(new FormData(form).getAll('targetIds')).toEqual(['target-a']);
 expect(JSON.parse(new FormData(form).get('destinationFormatsJson') as string)).toEqual({'target-a':'compact'});
 });
