// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { publishingActionCopy, publishingActionCopySchema, publishingActionText } from '../src/modules/publishing/action-catalog';
import { PublishingActionCopyProvider } from '../src/modules/publishing/ui/WorkflowSubmitButtons';
import { PublishNowButton } from '../src/modules/publishing/ui/posts/PublishNowButton';
vi.mock('../src/modules/publishing/ui/posts/actions', () => ({ publishPostAction: vi.fn() }));

it('validates both languages, rejects missing keys and protects named context placeholders', () => {
  expect(publishingActionCopySchema.safeParse(publishingActionCopy).success).toBe(true);
  expect(publishingActionCopySchema.parse(publishingActionCopy)).toEqual(publishingActionCopy);
  expect(publishingActionCopySchema.safeParse({ ...publishingActionCopy, publishNow: { en: 'Publish' } }).success).toBe(false);
  expect(publishingActionCopySchema.safeParse({ ...publishingActionCopy, countdown: { en: 'Sending', fr: 'Envoi' } }).success).toBe(false);
  expect(publishingActionCopySchema.safeParse({ ...publishingActionCopy, additional: { en: 'Extra', fr: 'Autre' } }).success).toBe(false);
});
it('formats Root copy as plain text and selects French', () => {
  const catalog = structuredClone(publishingActionCopy);
  catalog.queued.fr = 'Prévu pour {time}';
  expect(publishingActionText(catalog, 'fr-FR')('queued', { time: '<time>' })).toBe('Prévu pour <time>');
});
it('uses a serialized Root catalog and locale in the real publish control', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const catalog = structuredClone(publishingActionCopy);
  catalog.publishNow.fr = 'Envoyer la publication';
  try {
    await act(async () => root.render(createElement(PublishingActionCopyProvider, { catalog, locale: 'fr', children: createElement(PublishNowButton, { postId: 'p1', undoSendSeconds: 0 }) })));
    expect(container.querySelector('button')?.textContent).toBe('Envoyer la publication');
  } finally { await act(async () => root.unmount()); container.remove(); }
});
