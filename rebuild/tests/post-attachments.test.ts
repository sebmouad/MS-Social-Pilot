// @vitest-environment jsdom
import { act, createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthoringMediaPreview, PostAttachments, usePostAttachments, type PostAttachmentOptions, type PostAttachmentsController } from '../src/modules/publishing/components/PostAttachments';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const options: PostAttachmentOptions = {
  allowedKinds: ['image', 'video'], maxMedia: 3, maxAltCharacters: 30,
  allowedMimeTypes: ['image/jpeg', 'image/png'], maxUploadBytes: 1000, allowMixedKinds: true,
};

function Harness({ initialMedia = [], allowedKinds = options.allowedKinds, allowedMimeTypes = options.allowedMimeTypes, maxMedia = options.maxMedia, disabled = false, onController, onPickLibrary }: { onPickLibrary?: () => void; initialMedia?: PostAttachmentOptions['initialMedia']; allowedKinds?: PostAttachmentOptions['allowedKinds']; allowedMimeTypes?: PostAttachmentOptions['allowedMimeTypes']; maxMedia?: number; disabled?: boolean; onController?: (controller: PostAttachmentsController) => void }) {
  const last = useRef<PostAttachmentsController | null>(null);
  const controller = usePostAttachments({ ...options, initialMedia, allowedKinds, allowedMimeTypes, maxMedia });
  last.current = controller;
  onController?.(controller);
  return createElement('div', null,
    createElement(PostAttachments, { controller, disabled, onPickLibrary }),
    createElement(AuthoringMediaPreview, { controller }),
    createElement('output', { 'data-testid': 'serialized' }, controller.mediaJson),
    createElement('output', { 'data-testid': 'items' }, JSON.stringify(controller.items)),
    createElement('output', { 'data-testid': 'file-names' }, JSON.stringify(controller.items.map(item => item.file?.name ?? null))),
    createElement('output', { 'data-testid': 'error' }, controller.error),
    createElement('button', { type: 'button', 'data-testid': 'validate', onClick: () => { controller.validate(); } }, 'Validate attachments'),
    createElement('button', { type: 'button', 'data-testid': 'prepare', onClick: () => { void controller.prepareUploads(); } }, 'Prepare uploads'),
    createElement('button', { type: 'button', 'data-testid': 'add-invalid-file', onClick: () => { controller.addLocalImage(new File(['bad'], 'bad.gif', { type: 'image/gif' })); } }, 'Add invalid local file'),
  );
}

async function render(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(createElement(Harness, props)));
}

function output(name: string) { return container.querySelector<HTMLOutputElement>(`[data-testid="${name}"]`)!.textContent ?? ''; }
function setValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn());
  class TestURL extends URL { static createObjectURL = vi.fn(() => 'blob:attachment-preview'); static revokeObjectURL = vi.fn(); }
  vi.stubGlobal('URL', TestURL);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shared post attachment editor', () => {
  it('preserves saved order and each image description while moving and removing rows', async () => {
    await render({ initialMedia: [
      { kind: 'image', url: 'https://images.example/first.jpg', altText: 'First photo' },
      { kind: 'image', url: 'https://images.example/second.jpg', altText: 'Second photo' },
      { kind: 'video', url: 'https://videos.example/clip.mp4' },
    ] });

    const descriptions = Array.from(container.querySelectorAll<HTMLInputElement>('input[name^="mediaAlt-"]'));
    expect(descriptions.map(field => field.value)).toEqual(['First photo', 'Second photo']);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Move attachment 2 up"]')!.click());

    expect(JSON.parse(output('serialized'))).toEqual([
      { kind: 'image', url: 'https://images.example/second.jpg', altText: 'Second photo' },
      { kind: 'image', url: 'https://images.example/first.jpg', altText: 'First photo' },
      { kind: 'video', url: 'https://videos.example/clip.mp4' },
    ]);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove attachment 2"]')!.click());
    expect(JSON.parse(output('serialized'))).toEqual([
      { kind: 'image', url: 'https://images.example/second.jpg', altText: 'Second photo' },
      { kind: 'video', url: 'https://videos.example/clip.mp4' },
    ]);
  });

  it('uploads sequentially, retains an uploaded reference after a later failure, and reuses it on retry', async () => {
    const first = new File(['one'], 'first.png', { type: 'image/png' });
    const second = new File(['two'], 'second.png', { type: 'image/png' });
    const firstRef = 'media:123e4567-e89b-42d3-a456-426614174000';
    const secondRef = 'media:123e4567-e89b-42d3-a456-426614174001';
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reference: firstRef }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'temporary unavailable' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reference: secondRef }) });
    vi.stubGlobal('fetch', request);
    await render();
    const filePicker = container.querySelector<HTMLInputElement>('input[data-testid="local-image-input"]')!;
    for (const file of [first, second]) {
      await act(async () => {
        Object.defineProperty(filePicker, 'files', { configurable: true, value: [file] });
        filePicker.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    const altInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[name^="mediaAlt-"]'));
    await act(async () => {
      setValue(altInputs[0]!, 'First retained description');
      setValue(altInputs[1]!, 'Second retained description');
    });
    expect(JSON.parse(output('items')).map((item: { file?: File }) => item.file)).toHaveLength(2);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="prepare"]')!.click();
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(request).toHaveBeenCalledTimes(2);
    const afterFailure = JSON.parse(output('items')) as Array<{ url: string; file?: File; error?: string; altText?: string }>;
    expect(afterFailure[0]).toMatchObject({ url: firstRef });
    expect(afterFailure[0]?.file).toBeUndefined();
    expect(afterFailure[1]?.file).toBeTruthy();
    expect(afterFailure[1]?.error).toMatch(/try again/i);
    expect(afterFailure.map((item: { altText?: string }) => item.altText)).toEqual(['First retained description', 'Second retained description']);
    expect(JSON.parse(output('serialized'))).toEqual([{ kind: 'image', url: firstRef, altText: 'First retained description' }]);
    const failedRow = container.querySelector<HTMLElement>('li[aria-describedby]')!;
    expect(document.activeElement).toBe(failedRow);
    expect(container.querySelector(`#${failedRow.getAttribute('aria-describedby')}`)?.textContent).toMatch(/try again/i);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="prepare"]')!.click();
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(JSON.parse(output('serialized'))).toEqual([
      { kind: 'image', url: firstRef, altText: 'First retained description' },
      { kind: 'image', url: secondRef, altText: 'Second retained description' },
    ]);
  });

  it('locks row fields during a pending retry while keeping mediaJson enabled and errors visible', async () => {
    const file = new File(['local'], 'local.png', { type: 'image/png' });
    let resolveRetry!: (response: { ok: boolean; json: () => Promise<{ reference: string }> }) => void;
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'temporary unavailable' }) })
      .mockImplementationOnce(() => new Promise(resolve => { resolveRetry = resolve; }));
    vi.stubGlobal('fetch', request);
    const existing = { kind: 'image' as const, url: 'https://images.example/saved.jpg', altText: 'Saved description' };
    await render({ initialMedia: [existing], allowedKinds: ['image'] });
    const picker = container.querySelector<HTMLInputElement>('input[data-testid="local-image-input"]')!;
    await act(async () => {
      Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const altInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[name^="mediaAlt-"]'));
    await act(async () => setValue(altInputs[1]!, 'Local description'));

    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="prepare"]')!.click());
    expect(container.textContent).toMatch(/could not be uploaded/i);
    const mediaInput = container.querySelector<HTMLInputElement>('input[name="mediaJson"]')!;
    expect(JSON.parse(mediaInput.value)).toEqual([existing]);

    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="prepare"]')!.click());
    expect(request).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/uploading/i);
    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input[type="url"], input[name^="mediaAlt-"]')).every(input => input.disabled)).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="mediaJson"]')?.disabled).toBe(false);
    expect(JSON.parse(container.querySelector<HTMLInputElement>('input[name="mediaJson"]')!.value)).toEqual([existing]);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/could not be uploaded/i);
    expect(container.querySelector<HTMLInputElement>('input[name^="mediaAlt-"]')?.value).toBe('Saved description');

    await act(async () => {
      resolveRetry({ ok: true, json: async () => ({ reference: 'media:123e4567-e89b-42d3-a456-426614174099' }) });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  });

  it('rejects an invalid or unsupported item without dropping it from the draft', async () => {
    await render({ initialMedia: [{ kind: 'video', url: 'http://videos.example/clip.mp4' }] });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="validate"]')!.click());

    expect(output('serialized')).toBe('[{"kind":"video","url":"http://videos.example/clip.mp4"}]');
    expect(container.textContent).toMatch(/HTTPS/i);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('fails closed on absent media support and keeps the stored item visible', async () => {
    await render({ allowedKinds: [], initialMedia: [{ kind: 'image', url: 'https://images.example/photo.jpg' }] });
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="validate"]')!.click());

    expect(JSON.parse(output('serialized'))).toEqual([{ kind: 'image', url: 'https://images.example/photo.jpg' }]);
    expect(container.textContent).toMatch(/not available for the selected destinations/i);
  });

  it('rejects malformed workspace references without dropping the row', async () => {
    await render({ allowedKinds: ['image'], initialMedia: [{ kind: 'image', url: 'media:../../another-workspace' }] });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="validate"]')!.click());
    expect(JSON.parse(output('serialized'))).toEqual([{ kind: 'image', url: 'media:../../another-workspace' }]);
    expect(output('items')).toContain('media:../../another-workspace');
    expect(container.textContent).toMatch(/choose the image file again/i);
  });

  it('does not silently discard an over-limit initial list', async () => {
    await render({ maxMedia: 1, initialMedia: [
      { kind: 'image', url: 'https://images.example/one.jpg' },
      { kind: 'image', url: 'https://images.example/two.jpg' },
    ] });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="validate"]')!.click());

    expect(JSON.parse(output('serialized'))).toHaveLength(2);
    expect(output('items')).toContain('https://images.example/two.jpg');
    expect(container.textContent).toMatch(/up to 1 media attachments/i);
  });

  it('explains the ceiling and removal step when the workspace limit is reached', async () => {
    await render({ maxMedia: 2, initialMedia: [
      { kind: 'image', url: 'https://images.example/one.jpg' },
      { kind: 'video', url: 'https://videos.example/two.mp4' },
    ] });

    expect(container.textContent).toMatch(/2 of 2 media attachments are used/i);
    expect(container.textContent).toMatch(/remove an attachment before adding another/i);
    expect(container.textContent).not.toMatch(/root setup/i);
  });

  it('shows only supported add controls and hides local upload without MIME support', async () => {
    await render({ allowedKinds: ['image'], allowedMimeTypes: [] });

    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Add media link')).toBe(true);
    expect(Array.from(container.querySelectorAll('button')).some(button => /Add (image|video) URL/.test(button.textContent ?? ''))).toBe(false);
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Upload')).toBe(false);
    expect(container.querySelector('input[data-testid="local-image-input"]')).toBeNull();
  });

  it('preserves a selected local file for review when upload MIME support is removed', async () => {
    await render({ allowedKinds: ['image'] });
    const picker = container.querySelector<HTMLInputElement>('input[data-testid="local-image-input"]')!;
    const file = new File(['photo'], 'photo.png', { type: 'image/png' });
    await act(async () => {
      Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await render({ allowedKinds: ['image'], allowedMimeTypes: [] });
    expect(JSON.parse(output('file-names'))).toEqual(['photo.png']);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="validate"]')!.click());
    expect(container.textContent).toContain('photo.png');
    expect(container.textContent).toMatch(/local image uploads are unavailable for the selected destinations/i);
  });

  it('explains a zero workspace media ceiling without configuration instructions', async () => {
    await render({ maxMedia: 0 });

    expect(container.textContent).toMatch(/media attachments are unavailable for this workspace/i);
    expect(container.textContent).not.toMatch(/root setup|configure root/i);
    expect(Array.from(container.querySelectorAll('button')).some(button => /Add (image|video|local)/.test(button.textContent ?? ''))).toBe(false);
  });

  it('keeps labels and validation focus scoped when multiple editors are mounted', async () => {
    await act(async () => root.render(createElement('div', null,
      createElement('div', { 'data-testid': 'editor-a' }, createElement(Harness, { initialMedia: [{ kind: 'image', url: 'http://images.example/a.jpg' }] })),
      createElement('div', { 'data-testid': 'editor-b' }, createElement(Harness, { initialMedia: [{ kind: 'image', url: 'http://images.example/b.jpg' }] })),
    )));
    const headingIds = Array.from(container.querySelectorAll('h3[id]')).map(element => element.id);
    const fieldIds = Array.from(container.querySelectorAll('input[id]')).map(element => element.id);
    const errorIds = Array.from(container.querySelectorAll('[role="alert"][id]')).map(element => element.id);
    expect(new Set(headingIds).size).toBe(2);
    expect(new Set(fieldIds).size).toBe(fieldIds.length);
    expect(new Set(errorIds).size).toBe(errorIds.length);

    const editorA = container.querySelector<HTMLElement>('[data-testid="editor-a"]')!;
    await act(async () => {
      editorA.querySelector<HTMLButtonElement>('[data-testid="validate"]')!.click();
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    });
    const inputA = editorA.querySelector<HTMLInputElement>('input[type="url"]')!;
    expect(document.activeElement).toBe(inputA);
    expect(inputA.labels?.[0]?.control).toBe(inputA);
    expect(editorA.querySelector(`#${inputA.getAttribute('aria-describedby')}`)).not.toBeNull();
  });

  it('focuses the visible local-image row and its error when a file fails validation', async () => {
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="add-invalid-file"]')!.click());
    const row = container.querySelector<HTMLElement>('li[id*="media-item-"]')!;
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="validate"]')!.click();
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    });

    expect(document.activeElement).toBe(row);
    expect(row.tabIndex).toBe(-1);
    expect(row.getAttribute('aria-describedby')).toBeTruthy();
    expect(container.querySelector(`#${row.getAttribute('aria-describedby')}`)?.textContent).toMatch(/allowed image up to/i);
    expect(container.textContent).toMatch(/allowed image up to/i);
  });

  it('adds one multi-file selection in FileList order and keeps each image description with its preview', async () => {
    await render();
    const picker = container.querySelector<HTMLInputElement>('input[data-testid="local-image-input"]')!;
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Upload')).toBe(true);
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.png', { type: 'image/png' });
    expect(picker.multiple).toBe(true);
    await act(async () => {
      Object.defineProperty(picker, 'files', { configurable: true, value: [first, second] });
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const altInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[name^="mediaAlt-"]'));
    await act(async () => {
      setValue(altInputs[0]!, 'First image description');
      setValue(altInputs[1]!, 'Second image description');
    });

    const items = JSON.parse(output('items')) as Array<{ altText?: string }>;
    expect(JSON.parse(output('file-names'))).toEqual(['first.png', 'second.png']);
    expect(items.map(item => item.altText)).toEqual(['First image description', 'Second image description']);
    const preview = container.querySelector<HTMLOListElement>('ol[aria-label="Attachment preview"]')!;
    expect(Array.from(preview.querySelectorAll('li')).map(item => item.textContent)).toEqual([
      '1. ImageFirst image description', '2. ImageSecond image description',
    ]);
    const previewImages = Array.from(preview.querySelectorAll('img'));
    expect(previewImages.map(image => image.alt)).toEqual(['First image description', 'Second image description']);
    expect(previewImages.map(image => image.getAttribute('src'))).toEqual(['blob:attachment-preview', 'blob:attachment-preview']);
  });

  it('rejects an over-count multi-file selection atomically and keeps existing items', async () => {
    await render({ maxMedia: 2, initialMedia: [{ kind: 'image', url: 'https://images.example/existing.jpg', altText: 'Existing' }] });
    const picker = container.querySelector<HTMLInputElement>('input[data-testid="local-image-input"]')!;
    await act(async () => {
      Object.defineProperty(picker, 'files', { configurable: true, value: [
        new File(['one'], 'one.png', { type: 'image/png' }),
        new File(['two'], 'two.png', { type: 'image/png' }),
      ] });
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(JSON.parse(output('serialized'))).toEqual([{ kind: 'image', url: 'https://images.example/existing.jpg', altText: 'Existing' }]);
    expect(JSON.parse(output('items'))).toHaveLength(1);
    expect(container.textContent).toMatch(/choose up to 2 media attachments/i);
  });
});

describe('library images and drop zone', () => {
  const id1 = '123e4567-e89b-42d3-a456-426614174001';
  const id2 = '123e4567-e89b-42d3-a456-426614174002';
  const id3 = '123e4567-e89b-42d3-a456-426614174003';
  let controller!: PostAttachmentsController;
  const capture = (value: PostAttachmentsController) => { controller = value; };

  it('adds library images by id, skips duplicates and stops at the media limit', async () => {
    await render({ onController: capture, maxMedia: 2 });
    await act(async () => controller.addLibraryImages([id1, id1, 'not-an-id', id2, id3]));
    expect(JSON.parse(output('serialized'))).toEqual([{ kind: 'image', url: `media:${id1}` }, { kind: 'image', url: `media:${id2}` }]);
    await act(async () => controller.addLibraryImages([id3]));
    expect(output('error')).toMatch(/choose up to 2 media attachments/i);
    expect(JSON.parse(output('serialized'))).toHaveLength(2);
  });

  it('refuses library images when the chosen channels take no images', async () => {
    await render({ onController: capture, allowedKinds: ['video'] });
    await act(async () => controller.addLibraryImages([id1]));
    expect(JSON.parse(output('serialized'))).toEqual([]);
    expect(output('error')).not.toBe('');
  });

  it('shows the From library button only when the screen offers a picker', async () => {
    await render();
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'From library')).toBe(false);
    const onPickLibrary = vi.fn();
    await act(async () => root.render(createElement(Harness, { onPickLibrary })));
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'From library')!.click());
    expect(onPickLibrary).toHaveBeenCalledOnce();
  });

  it('adds files dropped on the media area', async () => {
    await render({ onController: capture });
    const area = container.querySelector('section')!;
    const file = new File(['x'], 'dropped.png', { type: 'image/png' });
    const event = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown };
    event.dataTransfer = { files: [file], types: ['Files'] };
    await act(async () => { area.dispatchEvent(event); });
    expect(JSON.parse(output('file-names'))).toEqual(['dropped.png']);
  });
});

it('uses edited French attachment copy and focuses the description field without matching its wording', async () => {
  const { ComposerCopyProvider } = await import('@/modules/publishing/ui/compose/CopyProvider');
  const { composerCatalogDefaults } = await import('@/modules/publishing/composer-catalog');
  const catalog = structuredClone(composerCatalogDefaults);
  catalog.attachments_descriptionMax.fr = 'Texte alternatif trop long : {max}.';
  catalog.attachments_heading.fr = 'Médias de campagne ';
  await act(async () => root.render(createElement(ComposerCopyProvider, { catalog, locale: 'fr', children: createElement(Harness, { initialMedia: [{ kind: 'image', url: 'https://images.example/test.jpg', altText: 'A'.repeat(31) }] }) })));
  expect(container.querySelector('h3')?.textContent).toContain('Médias de campagne');
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="validate"]')!.click());
  await act(async () => new Promise(resolve => requestAnimationFrame(() => resolve())));
  const input = container.querySelector<HTMLInputElement>('input[name^="mediaAlt-"]')!;
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(input);
  expect(container.textContent).toContain('Texte alternatif trop long : 30.');
});
