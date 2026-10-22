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
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, back: vi.fn() }) }));
vi.mock('../src/modules/publishing/ui/posts/actions', () => ({ createPostWithRecoveryAction: mocks.action }));

import { PostComposer } from '../src/modules/publishing/ui/compose/PostComposer';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const targets = [{ id: 'target-a', name: 'Studio channel', type: 'channel', provider: 'facebook', canPublish: true, publishingMedia: { kinds: ['image', 'video'] as const, maxImages: 2, maxVideos: 1, mixedKinds: true, linkWithMedia: false, imageAltText: true }, localImageUpload: { maxBytes: 5000, mimeTypes: ['image/png'] } }];
type TestTarget = { id: string; name: string; type: string; provider: string | null; canPublish: boolean; publishingFormats?: readonly PublishingFormatDescriptor[]; defaultPublishingFormatId?: string; publishingMedia?: { kinds: readonly ('image' | 'video')[]; maxImages: number | null; maxVideos: number | null; mixedKinds: boolean; linkWithMedia: boolean; imageAltText: boolean }; localImageUpload?: { maxBytes: number; mimeTypes: readonly string[] } };
const rules = { allowedMimeTypes: ['image/png'], maxUploadBytes: 5000, maxAltCharacters: 120, maxMessageCharacters: 500, maxMedia: 2 };
const schedule = { date: '2026-10-20', time: '10:30', timeZone: 'UTC' };

async function render(targetChoices: TestTarget[] = targets, templates: Array<{ id: string; name: string; category: string; body: string; hashtags: string; firstComment: string; firstCommentDelayMinutes: number; labelId: string | null }> = [], slot = schedule) {
  await act(async () => root.render(createElement(PostComposer, { targets: targetChoices, templates, imageRules: rules, maxFirstCommentDelayMinutes: 10080, schedule: slot, authorName: 'Your team', createdAt: new Date('2026-10-16T10:00:00.000Z'), createdAtDisplay: 'Oct 16, 2026, 10:00 AM' })));
}

const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
const byText = (text: string) => buttons().find(button => button.textContent?.trim() === text)!;
/** A channel chip in the Channels section (the Edit/Preview switch and preview channel buttons are toggles too). */
const chip = (name: string) => buttons().find(button => button.hasAttribute('aria-pressed') && button.textContent?.includes(name))!;
const saveDraft = () => byText('Save draft');
const textSetter = () => Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
const inputSetter = () => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
async function openFirstComment() { await act(async () => byText('Add a first comment').click()); }

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reference: 'media:123e4567-e89b-42d3-a456-426614174000' }) }));
  class TestURL extends URL { static createObjectURL = vi.fn(() => 'blob:preview'); static revokeObjectURL = vi.fn(); }
  vi.stubGlobal('URL', TestURL);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('full-screen post composer', () => {
  it('opens as a named modal sheet with channels, text, media and an action bar', async () => {
    await render();
    const sheet = container.querySelector('[role="dialog"][aria-modal="true"]')!;
    expect(sheet.getAttribute('aria-labelledby')).toBeTruthy();
    expect(sheet.querySelector('h1')?.textContent).toBe('New post');
    expect(Array.from(sheet.querySelectorAll('section h2')).map(heading => heading.textContent)).toEqual(expect.arrayContaining(['Channels', 'Post text', 'Media']));
    expect(container.querySelector('[role="group"][aria-label="Post actions"]')).not.toBeNull();
    expect(container.querySelector('textarea#composer-message')?.getAttribute('placeholder')).toBe('What do you want to share?');
  });

  it('exposes a bounded accessible minute field and applies the template delay', async () => {
    await render(targets, [{ id: 'template-a', name: 'Welcome', category: '', body: 'Hello', hashtags: '', firstComment: 'Follow up', firstCommentDelayMinutes: 37, labelId: null }]);
    await act(async () => byText('Templates').click());
    await act(async () => byText('Use template').click());
    const delay = container.querySelector<HTMLInputElement>('#composer-first-comment-delay')!;
    expect(delay.labels?.[0]?.textContent).toMatch(/minutes/i);
    expect(delay.min).toBe('0'); expect(delay.max).toBe('10080');
    expect(container.querySelector<HTMLInputElement>('#composer-first-comment-delay')?.value).toBe('37');
    expect(container.querySelector<HTMLTextAreaElement>('#composer-first-comment')?.value).toBe('Follow up');
  });

  it('navigates only after confirmed save and prevents another submission while opening Posts', async () => {
    mocks.action.mockResolvedValueOnce({ status: 'success', destination: '/content?notice=created', values: {} });
    await render();
    const link = container.querySelector<HTMLInputElement>('#composer-link')!;
    await act(async () => { inputSetter().call(link, 'https://example.test/saved'); link.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => saveDraft().click());
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/content?notice=created');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Post saved');
    expect(container.querySelector<HTMLTextAreaElement>('#composer-message')!.disabled).toBe(true);
    expect(container.textContent).toContain('Saved post preview');
    expect(container.querySelector<HTMLAnchorElement>('a[href="/content?notice=created"]')).not.toBeNull();
    expect(saveDraft().disabled).toBe(true);
    expect(mocks.action).toHaveBeenCalledTimes(1);
    expect((mocks.action.mock.calls[0]![1] as FormData).get('intent')).toBe('draft');
  });

  it('keeps chosen channels in the form and updates the neutral preview', async () => {
    await render();
    const message = container.querySelector<HTMLTextAreaElement>('#composer-message')!;
    await act(async () => { textSetter().call(message, 'A useful update'); message.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(chip('Studio channel').getAttribute('aria-pressed')).toBe('false');
    await act(async () => chip('Studio channel').click());
    expect(chip('Studio channel').getAttribute('aria-pressed')).toBe('true');
    const destination = container.querySelector<HTMLInputElement>('input[type="hidden"][name="targetIds"]')!;
    expect(destination.value).toBe('target-a');
    expect(destination.form?.id).toBe('post-composer-form');
    expect(container.textContent).toContain('A useful update');
    expect(container.textContent).toContain('Unsaved preview');
  });

  it('saves a no-caption post with a link and leaves its preview focused on the link content', async () => {
    await render();
    const link = container.querySelector<HTMLInputElement>('#composer-link')!;
    await act(async () => { inputSetter().call(link, 'https://example.com/story'); link.dispatchEvent(new Event('input', { bubbles: true })); });
    const preview = container.querySelector('[data-variant="card"]')!;
    expect(preview.textContent).not.toContain('Your post text will appear here');
    expect(preview.textContent).not.toContain('No text included');
    expect(preview.textContent).toContain('Open shared link');

    await act(async () => saveDraft().click());

    expect(mocks.action).toHaveBeenCalledTimes(1);
    expect((mocks.action.mock.calls[0]![1] as FormData).get('message')).toBe('');
  });

  it('offers the first comment on request, shows its delay only once it has text, and still submits the delay', async () => {
    await render();
    expect(container.querySelector('#composer-first-comment')).toBeNull();
    expect(container.querySelector('#composer-first-comment-delay')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[type="hidden"][name="firstCommentDelayMinutes"]')?.value).toBe('0');
    await openFirstComment();
    expect(container.querySelector('#composer-first-comment-delay')).toBeNull();
    const comment = container.querySelector<HTMLTextAreaElement>('#composer-first-comment')!;
    await act(async () => { textSetter().call(comment, 'Link in the first comment'); comment.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(container.querySelector('#composer-first-comment-delay')).not.toBeNull();
  });

  it('rejects first-comment-only posts when attachment URL rows are still empty', async () => {
    await render();
    await act(async () => byText('Add media link').click());
    await openFirstComment();
    const comment = container.querySelector<HTMLTextAreaElement>('#composer-first-comment')!;
    await act(async () => { textSetter().call(comment, 'A first comment only'); comment.dispatchEvent(new Event('input', { bubbles: true })); });

    await act(async () => saveDraft().click());

    expect(mocks.action).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/add post text, a link, or media/i);
    expect(document.activeElement).toBe(container.querySelector('[role="alert"]'));
  });

  it('hides local upload for a selected remote-only destination without provider-specific rules', async () => {
    const remoteOnly = [{ id: 'remote-only', name: 'Remote-only fake provider', type: 'channel', provider: 'fake-provider', canPublish: true, publishingMedia: { kinds: ['image'] as const, maxImages: 3, maxVideos: 0, mixedKinds: false, linkWithMedia: true, imageAltText: false } }];
    await render(remoteOnly);
    await act(async () => chip('Remote-only fake provider').click());

    expect(buttons().some(button => button.textContent?.trim() === 'Upload')).toBe(false);
    expect(buttons().some(button => button.textContent?.trim() === 'Add media link')).toBe(true);
  });

  it('uploads a selected file once and submits the post once after upload completes', async () => {
    await render();
    await act(async () => chip('Studio channel').click());
    expect(buttons().some(button => button.textContent?.trim() === 'Upload')).toBe(true);
    const input = container.querySelector<HTMLInputElement>('[data-testid="local-image-input"]')!;
    const file = new File(['image-bytes'], 'post.png', { type: 'image/png' });
    let liveFiles: { 0?: File; length: number; item: (index: number) => File | null } = { 0: file, length: 1, item: (index: number) => index === 0 ? file : null };
    Object.defineProperty(input, 'files', { configurable: true, get: () => liveFiles });
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(input, 'value', { configurable: true, get: () => nativeValue.get!.call(input), set: value => { nativeValue.set!.call(input, value); if (value === '') liveFiles = { length: 0, item: () => null }; } });
    const message = container.querySelector<HTMLTextAreaElement>('#composer-message')!;
    await act(async () => { textSetter().call(message, 'Upload this image'); message.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const submitter = saveDraft();

    await act(async () => submitter.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.action).toHaveBeenCalledTimes(1);
    const submitted = mocks.action.mock.calls[0]![1] as FormData;
    expect(JSON.parse(String(submitted.get('mediaJson')))).toEqual([{ kind: 'image', url: 'media:123e4567-e89b-42d3-a456-426614174000' }]);
    expect(submitted.get('intent')).toBe('draft');
    expect(saveDraft().disabled).toBe(false);
    expect(container.querySelector<HTMLTextAreaElement>('#composer-message')?.value).toBe('Upload this image');
  });

  it('keeps composer fields and retry available when the server action transport rejects', async () => {
    mocks.action.mockRejectedValueOnce(new Error('Network request failed with internal transport detail'));
    await render();
    await openFirstComment();
    const message = container.querySelector<HTMLTextAreaElement>('#composer-message')!;
    const firstComment = container.querySelector<HTMLTextAreaElement>('#composer-first-comment')!;
    await act(async () => {
      textSetter().call(message, 'Offline draft text'); message.dispatchEvent(new Event('input', { bubbles: true }));
      textSetter().call(firstComment, 'Offline follow-up'); firstComment.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => saveDraft().click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(container.querySelector<HTMLTextAreaElement>('#composer-message')?.value).toBe('Offline draft text');
    expect(container.querySelector<HTMLTextAreaElement>('#composer-first-comment')?.value).toBe('Offline follow-up');
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/could not confirm whether this post was saved/i);
    expect(container.querySelector('[role="alert"] a[href="/content"]')?.getAttribute('target')).toBe('_blank');
    expect(container.textContent).not.toContain('internal transport detail');
    expect(saveDraft().disabled).toBe(false);
  });

  it('serializes remote media in visible order with each image description attached', async () => {
    await render();
    await act(async () => byText('Add media link').click());
    await act(async () => byText('Add media link').click());
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
      imageUrl.dispatchEvent(new Event('focus'));
      inputSetter().call(imageUrl, 'https://example.com/image.png'); imageUrl.dispatchEvent(new Event('input', { bubbles: true }));
      inputSetter().call(videoUrl, 'https://example.com/video.mp4'); videoUrl.dispatchEvent(new Event('input', { bubbles: true }));
      inputSetter().call(alt, 'Studio exterior'); alt.dispatchEvent(new Event('input', { bubbles: true }));
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
    await act(async () => chip('Studio channel').click());
    const fileInput = container.querySelector<HTMLInputElement>('[data-testid="local-image-input"]')!;
    const file = new File(['image-bytes'], 'post.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { configurable: true, get: () => ({ 0: file, length: 1, item: (index: number) => index === 0 ? file : null }) });
    const link = container.querySelector<HTMLInputElement>('#composer-link')!;
    const message = container.querySelector<HTMLTextAreaElement>('#composer-message')!;
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      inputSetter().call(link, 'https://example.com'); link.dispatchEvent(new Event('input', { bubbles: true }));
      textSetter().call(message, 'A link and image'); message.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => saveDraft().click());

    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.action).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/cannot combine a link with media/i);
  });
});

describe('scheduling from the action bar', () => {
  const typeMessage = async () => {
    const message = container.querySelector<HTMLTextAreaElement>('#composer-message')!;
    await act(async () => { textSetter().call(message, 'Plan this'); message.dispatchEvent(new Event('input', { bubbles: true })); });
  };

  it('submits a schedule straight away when Create was opened from a calendar slot', async () => {
    await render();
    await typeMessage();
    await act(async () => chip('Studio channel').click());
    expect(byText('Schedule for Oct 20, 10:30')).toBeDefined();
    await act(async () => byText('Schedule for Oct 20, 10:30').click());
    const sent = mocks.action.mock.calls[0]![1] as FormData;
    expect(sent.get('intent')).toBe('schedule');
    expect(sent.get('scheduleDate')).toBe('2026-10-20');
    expect(sent.get('scheduleTime')).toBe('10:30');
  });

  it('asks for a time first, then the main button submits a schedule at that time', async () => {
    await render(targets, [], { date: '', time: '', timeZone: 'UTC' });
    await typeMessage();
    await act(async () => chip('Studio channel').click());
    // No time is picked yet, so Schedule opens the time picker instead of submitting.
    await act(async () => byText('Schedule').click());
    expect(mocks.action).not.toHaveBeenCalled();
    const popover = container.querySelector('[role="dialog"][aria-label="Pick a time"]')!;
    expect(popover).not.toBeNull();
    const [date, time] = Array.from(popover.querySelectorAll<HTMLInputElement>('input'));
    await act(async () => { inputSetter().call(date!, '2026-10-23'); date!.dispatchEvent(new Event('input', { bubbles: true })); inputSetter().call(time!, '09:00'); time!.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => Array.from(popover.querySelectorAll('button')).find(button => button.textContent === 'Use this time')!.click());
    expect(buttons().some(button => button.textContent?.startsWith('Schedule for'))).toBe(true);
    await act(async () => buttons().find(button => button.textContent?.startsWith('Schedule for'))!.click());
    expect(mocks.action).toHaveBeenCalledTimes(1);
    const sent = mocks.action.mock.calls[0]![1] as FormData;
    expect(sent.get('intent')).toBe('schedule');
    expect(sent.get('scheduleDate')).toBe('2026-10-23');
    expect(sent.get('scheduleTime')).toBe('09:00');
    expect(sent.getAll('targetIds')).toEqual(['target-a']);
  });

  it('confirms Publish now, then schedules a moment ahead through the same action', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
    try {
      await render();
      await typeMessage();
      await act(async () => chip('Studio channel').click());
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="More ways to publish"]')!.click());
      await act(async () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent === 'Publish now')!.click());
      const dialog = document.querySelector('dialog[open]')!;
      expect(dialog.textContent).toContain('Publish now?');
      expect(mocks.action).not.toHaveBeenCalled();
      await act(async () => Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Publish now')!.click());
      expect(mocks.action).toHaveBeenCalledTimes(1);
      const sent = mocks.action.mock.calls[0]![1] as FormData;
      expect(sent.get('intent')).toBe('schedule');
      // The server computes now plus the Root lead; the browser sends no zoned wall time of its own.
      expect(sent.get('publishNow')).toBe('1');
    } finally { vi.useRealTimers(); }
  });

  it('asks before leaving with unsaved content', async () => {
    await render();
    await typeMessage();
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    const dialog = document.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('Leave without saving?');
    await act(async () => Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Keep editing')!.click());
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

it('keeps destination controls and format serialization in sync when an action requests a native form reset', async () => {
  const format: PublishingFormatDescriptor = { id: 'compact', label: 'Compact', media: { kinds: [], maxImages: 0, maxVideos: 0, mixedKinds: false, linkWithMedia: false, imageAltText: false }, firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } };
  await render([{ ...targets[0]!, publishingFormats: [format], defaultPublishingFormatId: 'compact' }]);
  await act(async () => chip('Studio channel').click());
  const form = container.querySelector<HTMLFormElement>('#post-composer-form')!;
  expect(chip('Studio channel').getAttribute('aria-pressed')).toBe('true');
  await act(async () => form.reset());
  expect(chip('Studio channel').getAttribute('aria-pressed')).toBe('true');
  expect(new FormData(form).getAll('targetIds')).toEqual(['target-a']);
  expect(JSON.parse(new FormData(form).get('destinationFormatsJson') as string)).toEqual({ 'target-a': 'compact' });
});

it('uses Instagram destination format descriptors without offering undeclared formats', async () => {
  const formats: PublishingFormatDescriptor[] = ['Photo', 'Reel', 'Story'].map(label => ({
    id: label.toLowerCase(), label, media: { kinds: ['image', 'video'], maxImages: 1, maxVideos: 1, mixedKinds: false, linkWithMedia: false, imageAltText: false },
    firstComment: false, remoteStatus: true, remoteDelete: false, scheduling: { application: true, native: false },
  }));
  await render([{ ...targets[0]!, id: 'ig-atlas', provider: 'instagram', name: 'Atelier Atlas', publishingFormats: formats, defaultPublishingFormatId: 'photo' },
    { ...targets[0]!, id: 'unavailable', provider: 'instagram', name: 'Unavailable channel', canPublish: false }]);
  expect(container.textContent).toContain('Atelier Atlas');
  // A channel that cannot publish is never selectable; it points to reconnecting instead.
  expect(chip('Unavailable channel')).toBeUndefined();
  expect(container.querySelector('a[href="/settings/connections"]')?.textContent).toBe('Reconnect');
  await act(async () => chip('Atelier Atlas').click());
  expect(container.textContent).toContain('Photo');
  expect(container.textContent).toContain('Reel');
  expect(container.textContent).toContain('Story');
  expect(container.textContent).not.toContain('Live');
});
