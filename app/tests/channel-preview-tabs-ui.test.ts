// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentProvider } from '../src/modules/publishing/ui/ContentProvider';
import { contentCopyDefaults, contentPolicyDefaults, resolveContentCopy } from '../src/modules/publishing/ui/content-copy';
import { ComposerCopyProvider } from '../src/modules/publishing/ui/compose/CopyProvider';
import { composerCatalogDefaults } from '../src/modules/publishing/composer-catalog';
import { ChannelPreviewTabs } from '../src/modules/publishing/ui/compose/ChannelPreviewTabs';
import { usePostAttachments } from '../src/modules/publishing/components/PostAttachments';
import type { PostPreviewPost } from '../src/components/PostPreview';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

const message = `First line of a long draft. ${'More words to push past the fold. '.repeat(12)}`;
const basePost: PostPreviewPost = {
  id: 'composer-preview', authorId: 'preview', message, firstComment: 'First comment draft', link: null, media: [],
  status: 'draft', scheduledAt: null, publishedAt: null, createdAt: new Date('2026-10-23T10:00:00.000Z'), displayTime: 'Oct 23, 2026',
  targets: [
    { status: 'pending', remotePostId: null, remoteUrl: null, target: { id: 'c-feed', type: 'page', name: 'Studio Page', pictureUrl: null } },
    { status: 'pending', remotePostId: null, remoteUrl: null, target: { id: 'c-story', type: 'page', name: 'Studio Stories', pictureUrl: null } },
  ],
};
const feedMedia = { kinds: ['image'] as const, maxImages: null, maxVideos: 0, mixedKinds: false, linkWithMedia: false, imageAltText: true };
const channels = [
  { id: 'c-feed', name: 'Studio Page', displayName: 'Studio Page', platformName: 'Facebook', defaultPublishingFormatId: 'post', publishingFormats: [{ id: 'post', label: 'Feed post', media: feedMedia, firstComment: true, remoteStatus: true, remoteDelete: true, preview: { textFoldChars: 60 }, scheduling: { application: true, native: false } }] },
  { id: 'c-story', name: 'Studio Stories', displayName: 'Studio Stories', platformName: 'Facebook', defaultPublishingFormatId: 'story_photo', publishingFormats: [{ id: 'story_photo', label: 'Photo story', media: { kinds: ['image'] as const, maxImages: 1, maxVideos: 0, mixedKinds: false, linkWithMedia: false, imageAltText: false }, firstComment: false, remoteStatus: true, remoteDelete: false, preview: { mediaAspect: 'story' as const, caption: false }, scheduling: { application: true, native: false } }] },
];

function Harness({ post = basePost }: { post?: PostPreviewPost }) {
  const attachments = usePostAttachments({ allowedKinds: ['image', 'video'], maxMedia: 4, maxAltCharacters: 200, allowedMimeTypes: ['image/png'], maxUploadBytes: 1024 });
  const [value, setValue] = useState('all');
  return createElement(ChannelPreviewTabs, { channels, formats: {}, previewPost: post, attachments, timeZone: 'UTC', locale: 'en', authorFallback: 'Your team', value, onChange: setValue });
}
async function render(post?: PostPreviewPost, locale: 'en' | 'fr' = 'en') {
  await act(async () => root.render(createElement(ContentProvider, { copy: resolveContentCopy(contentCopyDefaults as never, locale), policy: contentPolicyDefaults, locale },
    createElement(ComposerCopyProvider, { catalog: composerCatalogDefaults, locale, children: createElement(Harness, { post }) }))));
}
const tab = (name: string) => [...container.querySelectorAll('[role="tab"]')].find(el => el.textContent?.endsWith(name))!;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('composer channel preview tabs', () => {
  it('shows the neutral preview on All channels and one tab per destination', async () => {
    await render();
    expect([...container.querySelectorAll('[role="tab"]')].map(el => el.textContent?.replace(/^[A-Z?]{1,2}(?=Studio)/, ''))).toEqual(['All channels', 'Studio Page', 'Studio Stories']);
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('A neutral preview');
    await act(async () => tab('Studio Page').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('Feed post · Facebook');
  });
  it('folds long text per channel with an expandable See more', async () => {
    await render();
    await act(async () => tab('Studio Page').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const panel = container.querySelector('[role="tabpanel"]')!;
    const details = panel.querySelector('details')!;
    expect(details.querySelector('summary')?.textContent).toContain('See more');
    expect(details.textContent!.length).toBeGreaterThan(200);
    expect(details.parentElement?.firstChild?.textContent).toContain('First line of a long draft');
    // The neutral tab shows the whole text unfolded.
    await act(async () => tab('All channels').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[role="tabpanel"]')?.querySelector('details')).toBeNull();
  });
  it('hides the caption on story formats and explains the missing first comment', async () => {
    await render();
    await act(async () => tab('Studio Stories').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(panel.textContent).toContain('shows no caption');
    expect(panel.textContent).not.toContain('First line of a long draft');
    expect(panel.textContent).toContain('cannot carry a first comment');
  });
  it('shows the empty first-comment slot and moves with arrow keys', async () => {
    await render({ ...basePost, firstComment: null });
    await act(async () => tab('Studio Page').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('will appear here');
    await act(async () => container.querySelector('[role="tablist"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(document.activeElement?.textContent).toContain('Studio Stories');
    await render({ ...basePost }, 'fr');
    await act(async () => tab('Studio Page').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('Voir plus');
  });
});
