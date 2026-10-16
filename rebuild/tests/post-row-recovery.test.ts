// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  edit: vi.fn(async (_previous: unknown, _data: FormData) => ({ status: 'error', message: 'The post could not be saved. Try again.', values: {} })),
  remove: vi.fn(async (_previous: unknown, _data: FormData) => ({ status: 'error', message: 'The post could not be deleted. Try again.', deleteRemote: true })),
}));

vi.mock('../src/app/publishing/posts/actions', async importOriginal => ({
  ...await importOriginal<typeof import('../src/app/publishing/posts/actions')>(),
  updatePostWithRecoveryAction: mocks.edit,
  deletePostWithRecoveryAction: mocks.remove,
}));

import { PostRowActions, runDeletePostWithRecovery, runUpdatePostWithRecovery } from '../src/app/publishing/posts/PostActions';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const targets = [{ id: 'target-a', name: 'Studio channel', type: 'channel', provider: null, canPublish: true }];
const rules = { allowedMimeTypes: ['image/png'], maxUploadBytes: 5000, maxAltCharacters: 120, maxMessageCharacters: 500 };
const post = {
  id: 'post-1', message: 'Saved text', firstComment: 'Saved comment', link: null,
  media: [{ kind: 'image', url: 'media:123e4567-e89b-42d3-a456-426614174000', altText: 'Saved description' }],
  status: 'draft', publishedAt: null, targets: [{ status: 'draft', remotePostId: 'remote-1', target: { id: 'target-a' } }],
};

async function render() {
  await act(async () => root.render(createElement(PostRowActions, { post, targets, canEdit: true, canPublish: true, imageRules: rules })));
}

async function setValue(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('post row recovery', () => {
  it('lets successful action redirects reach the framework instead of showing a false failure', async () => {
    const redirect = Object.assign(new Error('redirect'), { digest: 'NEXT_REDIRECT;replace;/publishing/posts?notice=updated;303;' });
    mocks.edit.mockRejectedValueOnce(redirect);
    mocks.remove.mockRejectedValueOnce(redirect);
    await expect(runUpdatePostWithRecovery({ status: 'idle', values: {} }, new FormData())).rejects.toBe(redirect);
    await expect(runDeletePostWithRecovery({ status: 'idle', deleteRemote: false }, new FormData())).rejects.toBe(redirect);
  });

  it('retains the submitted edit and remote-deletion choice after a transport rejection', async () => {
    mocks.edit.mockRejectedValueOnce(new TypeError('Network failed'));
    mocks.remove.mockRejectedValueOnce(new TypeError('Network failed'));
    const data = new FormData(); data.set('message', 'Unsaved text'); data.set('firstComment', 'Unsaved comment'); data.set('deleteRemote', 'on');
    expect(await runUpdatePostWithRecovery({ status: 'idle', values: {} }, data)).toMatchObject({ status: 'error', values: { message: 'Unsaved text', firstComment: 'Unsaved comment' } });
    expect(await runDeletePostWithRecovery({ status: 'idle', deleteRemote: false }, data)).toMatchObject({ status: 'error', deleteRemote: true });
  });

  it('keeps edited values and an uploaded image reference after a server failure', async () => {
    mocks.edit.mockImplementationOnce(async (_previous, data) => ({
      status: 'error', message: 'The post could not be saved. Try again.',
      values: { message: String(data.get('message') ?? ''), firstComment: String(data.get('firstComment') ?? ''), altText: String(data.get('altText') ?? ''), uploadedImageRef: String(data.get('uploadedImageRef') ?? ''), targetIds: data.getAll('targetIds').filter((item): item is string => typeof item === 'string') },
    }));
    await render();
    await act(async () => container.querySelector('summary')!.click());
    await setValue(container.querySelector<HTMLTextAreaElement>('textarea[name="message"]')!, 'Revised text to retry');
    await setValue(container.querySelector<HTMLTextAreaElement>('textarea[name="firstComment"]')!, 'Revised comment to retry');
    await setValue(container.querySelector<HTMLInputElement>('input[name="altText"]')!, 'Revised image description');
    const destination = container.querySelector<HTMLInputElement>('input[name="targetIds"]')!;
    await act(async () => destination.click());
    const uploaded = container.querySelector<HTMLInputElement>('input[name="uploadedImageRef"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(uploaded, 'media:123e4567-e89b-42d3-a456-426614174111');
    await act(async () => container.querySelector<HTMLButtonElement>('details button[type="submit"]')!.click());

    expect(mocks.edit).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.value).toBe('Revised text to retry');
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="firstComment"]')?.value).toBe('Revised comment to retry');
    expect(container.querySelector<HTMLInputElement>('input[name="altText"]')?.value).toBe('Revised image description');
    expect(uploaded.value).toBe('media:123e4567-e89b-42d3-a456-426614174111');
    expect(destination.checked).toBe(false);
    const submitted = mocks.edit.mock.calls[0]![1] as FormData;
    expect(submitted.get('uploadedImageRef')).toBe('media:123e4567-e89b-42d3-a456-426614174111');
    expect(container.querySelector('details')?.open).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/could not be saved/i);
    expect(document.activeElement instanceof HTMLElement && document.activeElement.hasAttribute('data-edit-error')).toBe(true);
  });

  it('disables every edit control while an edit is pending', async () => {
    let finish!: (state: { status: 'error'; message: string; values: Record<string, unknown> }) => void;
    mocks.edit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render();
    await act(async () => container.querySelector('summary')!.click());
    const save = container.querySelector<HTMLButtonElement>('details button[type="submit"]')!;
    await act(async () => { save.click(); await Promise.resolve(); });

    expect(save.disabled).toBe(true);
    expect(container.querySelector('details form fieldset')?.hasAttribute('disabled')).toBe(true);
    await act(async () => finish({ status: 'error', message: 'Retry', values: {} }));
    expect(save.disabled).toBe(false);
  });

  it('keeps the delete dialog and remote deletion choice after a server failure', async () => {
    await render();
    const opener = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Delete locally'))!;
    await act(async () => opener.click());
    const dialog = container.querySelector('dialog')!;
    const remoteChoice = container.querySelector<HTMLInputElement>('input[name="deleteRemote"]')!;
    await act(async () => remoteChoice.click());
    await act(async () => dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());

    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(true);
    expect(remoteChoice.checked).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/could not be deleted/i);
    expect(document.activeElement instanceof HTMLElement && document.activeElement.hasAttribute('data-dialog-error')).toBe(true);
  });

  it('cancel closes the delete dialog and restores focus to its opener', async () => {
    await render();
    const opener = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Delete locally'))!;
    opener.focus();
    await act(async () => opener.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-dialog-cancel]')!.click());
    expect(container.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
