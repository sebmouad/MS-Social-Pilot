// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  edit: vi.fn(async (_previous: unknown, _data: FormData) => ({ status: 'error', message: 'The post could not be saved. Try again.', values: {} })),
  remove: vi.fn(async (_previous: unknown, _data: FormData) => ({ status: 'error', message: 'The post could not be deleted. Try again.', deleteRemote: true })),
  sendComment: vi.fn(async (_previous: unknown, _data: FormData) => ({ status: 'error', postId: 'post-1', postTargetId: 'post-target-a', message: 'Check its status.' })),
  recordComment: vi.fn(async (_previous: unknown, _data: FormData) => ({ status: 'error', postId: 'post-1', postTargetId: 'post-target-a', message: 'Check its status.' })),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock('../src/app/publishing/posts/actions', async importOriginal => ({
  ...await importOriginal<typeof import('../src/app/publishing/posts/actions')>(),
  updatePostWithRecoveryAction: mocks.edit,
  deletePostWithRecoveryAction: mocks.remove,
  sendFirstCommentAction: mocks.sendComment,
  recordFirstCommentOutcomeAction: mocks.recordComment,
}));

import { PostRowActions, runDeletePostWithRecovery, runRecordFirstCommentWithRecovery, runSendFirstCommentWithRecovery, runUpdatePostWithRecovery } from '../src/app/publishing/posts/PostActions';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const targets = [{ id: 'target-a', name: 'Studio channel', type: 'channel', provider: null, canPublish: true, publishingMedia: { kinds: ['image', 'video'] as const, maxImages: 4, maxVideos: 1, mixedKinds: true, linkWithMedia: true, imageAltText: true }, localImageUpload: { maxBytes: 5000, mimeTypes: ['image/png'] } }];
const rules = { allowedMimeTypes: ['image/png'], maxUploadBytes: 5000, maxAltCharacters: 120, maxMessageCharacters: 500, maxMedia: 4 };
const post = {
  id: 'post-1', message: 'Saved text', firstComment: 'Saved comment', link: null,
  media: [{ kind: 'image', url: 'media:123e4567-e89b-42d3-a456-426614174000', altText: 'Saved description' }],
  status: 'draft', publishedAt: null, targets: [{ id: 'post-target-draft', status: 'draft', remotePostId: 'remote-1', target: { id: 'target-a' } }],
};

async function render(row = post) {
  await act(async () => root.render(createElement(PostRowActions, { post: row, targets, canEdit: true, canPublish: true, imageRules: rules })));
}
const publishedWithReadyComment = { ...post, status: 'published', publishedAt: new Date(), targets: [{ id: 'post-target-a', status: 'published', remotePostId: 'remote-1', remoteUrl: null, target: { id: 'target-a', name: 'Studio channel' } }] };
const publishedWithUnknownComment = { ...publishedWithReadyComment, targets: [{ ...publishedWithReadyComment.targets[0]!, firstCommentAt: new Date(), firstCommentError: 'must never be shown to customers' }] };

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
  class TestURL extends URL { static createObjectURL = vi.fn(() => 'blob:preview'); static revokeObjectURL = vi.fn(); }
  vi.stubGlobal('URL', TestURL);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('post row recovery', () => {
  it('lets successful action redirects reach the framework instead of showing a false failure', async () => {
    const redirect = Object.assign(new Error('redirect'), { digest: 'NEXT_REDIRECT;replace;/publishing/posts?notice=updated;303;' });
    mocks.edit.mockRejectedValueOnce(redirect);
    mocks.remove.mockRejectedValueOnce(redirect);
    mocks.sendComment.mockRejectedValueOnce(redirect);
    mocks.recordComment.mockRejectedValueOnce(redirect);
    await expect(runUpdatePostWithRecovery({ status: 'idle', values: {} }, new FormData())).rejects.toBe(redirect);
    await expect(runDeletePostWithRecovery({ status: 'idle', deleteRemote: false }, new FormData())).rejects.toBe(redirect);
    await expect(runSendFirstCommentWithRecovery({ status: 'idle', postId: 'post-1', postTargetId: 'post-target-a' }, new FormData())).rejects.toBe(redirect);
    await expect(runRecordFirstCommentWithRecovery({ status: 'idle', postId: 'post-1', postTargetId: 'post-target-a' }, new FormData())).rejects.toBe(redirect);
  });

  it('retains first-comment recovery context after transport failures', async () => {
    mocks.sendComment.mockRejectedValueOnce(new TypeError('network failure'));
    mocks.recordComment.mockRejectedValueOnce(new TypeError('network failure'));
    const sendData = new FormData(); sendData.set('postId', 'post-1'); sendData.set('postTargetId', 'post-target-a');
    const recordData = new FormData(); recordData.set('postId', 'post-1'); recordData.set('postTargetId', 'post-target-a'); recordData.set('outcome', 'sent'); recordData.set('remoteId', 'comment-42');
    expect(await runSendFirstCommentWithRecovery({ status: 'idle', postId: 'post-1', postTargetId: 'post-target-a' }, sendData)).toMatchObject({ status: 'error', postId: 'post-1', postTargetId: 'post-target-a', message: expect.stringMatching(/unconfirmed/i) });
    expect(await runRecordFirstCommentWithRecovery({ status: 'idle', postId: 'post-1', postTargetId: 'post-target-a' }, recordData)).toMatchObject({ status: 'error', outcome: 'sent', remoteId: 'comment-42', message: expect.stringMatching(/unconfirmed/i) });
  });

  it('requires acknowledgement before sending and retains the dialog after an uncertain result', async () => {
    mocks.sendComment.mockImplementationOnce(async (_previous, data) => ({ status: 'error', postId: 'post-1', postTargetId: 'post-target-a', message: 'The result could not be confirmed. Check its current state.' }));
    await act(async () => root.render(createElement(PostRowActions, { post: publishedWithReadyComment, targets, canEdit: true, canPublish: true, imageRules: rules })));
    const send = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Send first comment')!;
    expect(send).toBeTruthy();
    await act(async () => send.click());
    const dialog = container.querySelector('dialog')!;
    const submit = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Send once')!;
    expect(submit.disabled).toBe(true);
    await act(async () => dialog.querySelector<HTMLInputElement>('input[name="acknowledged"]')!.click());
    await act(async () => submit.click());
    const submitted = mocks.sendComment.mock.calls[0]![1] as FormData;
    expect(submitted.get('confirmation')).toBe('SEND FIRST COMMENT post-target-a');
    expect(submitted.get('acknowledged')).toBe('on');
    expect(container.querySelector('dialog')).toBeTruthy();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/check its current state/i);
  });

  it('keeps uncertain comments blocked until a manually verified outcome is acknowledged', async () => {
    await act(async () => root.render(createElement(PostRowActions, { post: publishedWithUnknownComment, targets, canEdit: true, canPublish: true, imageRules: rules })));
    expect(container.textContent).not.toContain('must never be shown to customers');
    const review = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Record comment outcome')!;
    await act(async () => review.click());
    const dialog = container.querySelector('dialog')!;
    const submit = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Record result')!;
    expect(submit.disabled).toBe(true);
    await act(async () => dialog.querySelector<HTMLInputElement>('input[name="acknowledged"]')!.click());
    await act(async () => submit.click());
    const submitted = mocks.recordComment.mock.calls[0]![1] as FormData;
    expect(submitted.get('outcome')).toBe('not_sent');
    expect(submitted.get('confirmation')).toBe('RECORD FIRST COMMENT post-target-a NOT SENT');
    expect(submitted.get('acknowledged')).toBe('on');
    expect(container.querySelector('dialog')).toBeTruthy();
  });

  it('keeps the latest uncertain receipt after cancelling and resets a reopened recovery dialog', async () => {
    mocks.recordComment.mockImplementationOnce(async () => ({ status: 'success', postId: 'post-1', postTargetId: 'post-target-a', state: 'ready', message: 'Outcome recorded.' }));
    mocks.sendComment.mockImplementationOnce(async () => ({ status: 'error', postId: 'post-1', postTargetId: 'post-target-a', state: 'needs_review', message: 'The send result is unconfirmed.' }));
    await act(async () => root.render(createElement(PostRowActions, { post: publishedWithUnknownComment, targets, canEdit: true, canPublish: true, imageRules: rules })));

    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Record comment outcome')!.click());
    let dialog = container.querySelector('dialog')!;
    await act(async () => dialog.querySelector<HTMLInputElement>('input[name="acknowledged"]')!.click());
    await act(async () => Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Record result')!.click());
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Send first comment')).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('[data-first-comment-control]'));

    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Send first comment')!.click());
    dialog = container.querySelector('dialog')!;
    await act(async () => dialog.querySelector<HTMLInputElement>('input[name="acknowledged"]')!.click());
    await act(async () => Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Send once')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/unconfirmed/i);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-first-comment-cancel]')!.click());
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Send first comment')).toBe(false);
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Record comment outcome')).toBe(true);

    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Record comment outcome')!.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('requires the platform comment ID before recording a sent outcome', async () => {
    await act(async () => root.render(createElement(PostRowActions, { post: publishedWithUnknownComment, targets, canEdit: true, canPublish: true, imageRules: rules })));
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Record comment outcome')!.click());
    const dialog = container.querySelector('dialog')!;
    await act(async () => dialog.querySelector<HTMLInputElement>('input[type="radio"][name="outcomeChoice"][value="sent"]')!.click());
    await act(async () => dialog.querySelector<HTMLInputElement>('input[name="acknowledged"]')!.click());
    const submit = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Record result')!;
    expect(submit.disabled).toBe(true);
    const idField = dialog.querySelector<HTMLInputElement>('input[name="remoteId"]')!;
    await setValue(idField, 'remote-comment-42');
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    const submitted = mocks.recordComment.mock.calls[0]![1] as FormData;
    expect(submitted.get('outcome')).toBe('sent');
    expect(submitted.get('remoteId')).toBe('remote-comment-42');
    expect(submitted.get('confirmation')).toBe('RECORD FIRST COMMENT post-target-a SENT');
    expect(dialog.querySelector<HTMLInputElement>('input[name="acknowledged"]')?.checked).toBe(true);
    expect(dialog.querySelector<HTMLInputElement>('input[name="outcomeChoice"][value="sent"]')?.checked).toBe(true);
    expect(idField.value).toBe('remote-comment-42');
    // A server refresh can update delivery evidence while a recoverable dialog remains open.
    const refreshed = { ...publishedWithUnknownComment, targets: [{ ...publishedWithUnknownComment.targets[0]!, firstCommentError: 'refreshed-review-required' }] };
    await act(async () => root.render(createElement(PostRowActions, { post: refreshed, targets, canEdit: true, canPublish: true, imageRules: rules })));
    expect(container.querySelector('dialog')).toBe(dialog);
    expect(idField.value).toBe('remote-comment-42');
    expect(dialog.querySelector<HTMLInputElement>('input[name="acknowledged"]')?.checked).toBe(true);
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
      values: { message: String(data.get('message') ?? ''), firstComment: String(data.get('firstComment') ?? ''), mediaJson: String(data.get('mediaJson') ?? ''), targetIds: data.getAll('targetIds').filter((item): item is string => typeof item === 'string') },
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reference: 'media:123e4567-e89b-42d3-a456-426614174222' }) }));
    await render();
    await act(async () => container.querySelector('summary')!.click());
    await setValue(container.querySelector<HTMLTextAreaElement>('textarea[name="message"]')!, 'Revised text to retry');
    await setValue(container.querySelector<HTMLTextAreaElement>('textarea[name="firstComment"]')!, 'Revised comment to retry');
    await setValue(container.querySelector<HTMLInputElement>('input[name^="mediaAlt-"]')!, 'Revised image description');
    const destination = container.querySelector<HTMLInputElement>('input[name="targetIds"]')!;
    expect(destination.checked).toBe(true);
    const input = container.querySelector<HTMLInputElement>('[data-testid="local-image-input"]')!;
    const file = new File(['new-image'], 'second.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, get: () => ({ 0: file, length: 1, item: (index: number) => index === 0 ? file : null }) });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => container.querySelector<HTMLButtonElement>('details button[type="submit"]')!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(mocks.edit).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.value).toBe('Revised text to retry');
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="firstComment"]')?.value).toBe('Revised comment to retry');
    expect(container.querySelectorAll<HTMLInputElement>('input[name^="mediaAlt-"]')[0]?.value).toBe('Revised image description');
    expect(destination.checked).toBe(true);
    const submitted = mocks.edit.mock.calls[0]![1] as FormData;
    expect(JSON.parse(String(submitted.get('mediaJson')))).toEqual([
      { kind: 'image', url: 'media:123e4567-e89b-42d3-a456-426614174000', altText: 'Revised image description' },
      { kind: 'image', url: 'media:123e4567-e89b-42d3-a456-426614174222' },
    ]);
    expect(container.querySelector('details')?.open).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/could not be saved/i);
    expect(document.activeElement instanceof HTMLElement && document.activeElement.hasAttribute('data-edit-error')).toBe(true);
  });

  it('allows an edited post to keep a link with an empty caption', async () => {
    const linkPost = { ...post, message: 'Old caption', firstComment: '', link: null, media: [] };
    await render(linkPost);
    await act(async () => container.querySelector('summary')!.click());
    await setValue(container.querySelector<HTMLTextAreaElement>('textarea[name="message"]')!, '   ');
    await setValue(container.querySelector<HTMLInputElement>('input[name="link"]')!, 'https://example.com/story');
    await act(async () => container.querySelector<HTMLButtonElement>('details button[type="submit"]')!.click());

    expect(mocks.edit).toHaveBeenCalledTimes(1);
    const submitted = mocks.edit.mock.calls[0]![1] as FormData;
    expect(submitted.get('message')).toBe('   ');
    expect(submitted.get('link')).toBe('https://example.com/story');
    expect(container.querySelector('[data-edit-error]')).toBeTruthy();
  });

  it('rejects an empty edited post even when its first comment has text', async () => {
    const emptyPost = { ...post, message: 'Old caption', firstComment: 'Saved comment', link: null, media: [] };
    await render(emptyPost);
    await act(async () => container.querySelector('summary')!.click());
    await setValue(container.querySelector<HTMLTextAreaElement>('textarea[name="message"]')!, ' ');
    await act(async () => container.querySelector<HTMLButtonElement>('details button[type="submit"]')!.click());

    expect(mocks.edit).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/add post text, a link, or media/i);
    expect(document.activeElement).toBe(container.querySelector('textarea[name="message"]'));
  });

  it('disables every edit control while an edit is pending', async () => {
    let finish!: (state: { status: 'error'; message: string; values: Record<string, unknown> }) => void;
    mocks.edit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render();
    await act(async () => container.querySelector('summary')!.click());
    const save = container.querySelector<HTMLButtonElement>('details button[type="submit"]')!;
    await act(async () => { save.click(); await Promise.resolve(); });

    expect(save.disabled).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.disabled).toBe(true);
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
    await act(async () => Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Delete post')!.click());

    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(true);
    expect(remoteChoice.checked).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/could not be deleted/i);
    expect(document.activeElement instanceof HTMLElement && document.activeElement.hasAttribute('data-dialog-error')).toBe(true);
  });

  it('keeps remote deletion blocked after ambiguity and sends explicit external outcome confirmation', async () => {
    mocks.remove.mockImplementationOnce(async (_previous, data) => ({ status: 'error', deleteRemote: data.get('deleteRemote') === 'on', message: 'Deletion needs review.', receipt: { ok: true, postId: 'post-1', localConfirmed: false, remoteDeletionRequested: true, state: 'needs_review', operations: [{ operationId: 'op-a', targetId: 'target-a', targetName: 'Studio channel', state: 'uncertain', remoteConfirmed: false, localConfirmed: false }] } }));
    await act(async () => root.render(createElement(PostRowActions, { post: publishedWithReadyComment, targets, canEdit: true, canPublish: true, imageRules: rules })));
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Delete locally'))!.click());
    await act(async () => container.querySelector<HTMLInputElement>('input[name="deleteRemote"]')!.click());
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Delete post')!.click());
    expect(container.querySelector<HTMLInputElement>('input[name="deleteRemote"]')!.checked).toBe(true);
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Delete post')!.disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/needs review/i);

    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]:not([name="deleteRemote"])')!.click());
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Record deleted')!.click());
    const submitted = mocks.remove.mock.calls[1]![1] as FormData;
    expect(submitted.get('intent')).toBe('record');
    expect(submitted.get('operationId')).toBe('op-a');
    expect(submitted.get('outcome')).toBe('deleted');
    expect(submitted.get('verifiedOnPlatform')).toBe('on');
    expect(submitted.get('confirmation')).toBe('RECORD POST DELETION op-a DELETED');
    expect(submitted.get('deleteRemote')).toBe('on');
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
