// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PostAttachments, usePostAttachments, type PostAttachmentOptions } from '../src/modules/publishing/components/PostAttachments';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const base: PostAttachmentOptions = { allowedKinds: ['image', 'video'], maxMedia: 3, maxAltCharacters: 30, allowedMimeTypes: ['image/png'], maxUploadBytes: 1000, allowMixedKinds: true };

function Harness({ kinds = base.allowedKinds }: { kinds?: PostAttachmentOptions['allowedKinds'] }) {
  const controller = usePostAttachments({ ...base, allowedKinds: kinds });
  return createElement('div', null, createElement(PostAttachments, { controller }), createElement('output', { 'data-testid': 'serialized' }, controller.mediaJson));
}
const serialized = () => JSON.parse(container.querySelector('[data-testid="serialized"]')!.textContent ?? '[]');
const addButton = () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Add media link')!;
function setValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
async function addLink(url: string) {
  await act(async () => addButton().click());
  const input = container.querySelector<HTMLInputElement>('input[name^="mediaUrl-"]')!;
  await act(async () => { setValue(input, url); input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}
async function chooseType(value: string) {
  const select = container.querySelector<HTMLSelectElement>('select')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('single media link with type detection', () => {
  const render = (props = {}) => act(async () => root.render(createElement(Harness, props)));

  it('offers one media link field and no separate image or video URL fields', async () => {
    await render();
    await act(async () => addButton().click());
    expect(container.querySelectorAll('input[name^="mediaUrl-"]')).toHaveLength(1);
    expect(container.textContent).toContain('Media link 1 (image or video)');
    expect(container.textContent).not.toMatch(/Image URL|Video URL/);
  });

  it('does not contact the link while it is still being typed', async () => {
    await render();
    await act(async () => addButton().click());
    await act(async () => setValue(container.querySelector<HTMLInputElement>('input[name^="mediaUrl-"]')!, 'https://cdn.example/clip.mp4'));
    expect(container.querySelector('li img, li video')).toBeNull();
  });

  it('keeps an image when the link loads as an image and shows it as the preview', async () => {
    await render();
    await addLink('https://cdn.example/photo');
    const image = container.querySelector<HTMLImageElement>('li img')!;
    expect(image.getAttribute('src')).toBe('https://cdn.example/photo');
    await act(async () => image.dispatchEvent(new Event('load')));
    expect(serialized()).toEqual([{ kind: 'image', url: 'https://cdn.example/photo' }]);
    expect(container.textContent).toContain('Recognised as an image.');
  });

  it('switches to video when the link does not load as an image but loads as a video', async () => {
    await render();
    await addLink('https://cdn.example/stream');
    await act(async () => container.querySelector<HTMLImageElement>('li img')!.dispatchEvent(new Event('error')));
    await act(async () => container.querySelector<HTMLVideoElement>('li video')!.dispatchEvent(new Event('loadedmetadata')));
    expect(serialized()).toEqual([{ kind: 'video', url: 'https://cdn.example/stream' }]);
    expect(container.textContent).toContain('Recognised as a video.');
    expect(container.querySelector<HTMLSelectElement>('select')!.value).toBe('video');
  });

  it('asks for the type when the link loads as neither and keeps the choice', async () => {
    await render();
    await addLink('https://cdn.example/blocked');
    await act(async () => container.querySelector<HTMLImageElement>('li img')!.dispatchEvent(new Event('error')));
    await act(async () => container.querySelector<HTMLVideoElement>('li video')!.dispatchEvent(new Event('error')));
    expect(container.textContent).toContain('We could not tell what this link is');
    await chooseType('video');
    expect(serialized()[0].kind).toBe('video');
  });

  it('limits the type choices to what the destinations accept', async () => {
    await render({ kinds: ['image'] });
    await addLink('https://cdn.example/photo');
    expect(Array.from(container.querySelectorAll('select option')).map(option => option.textContent)).toEqual(['Image']);
  });
});
