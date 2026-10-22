// @vitest-environment jsdom
import type { ComposerActionState } from '../src/modules/publishing/ui/posts/actions';
import type { PublishingFormatDescriptor } from '../src/platforms/types';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  action: vi.fn(async (_previous: unknown, _data: FormData): Promise<ComposerActionState> => ({ status: 'error', message: 'safe failure', values: {} })),
  autosave: vi.fn(async (_id: string | null, _data: FormData) => ({ status: 'saved' as const, draftPostId: 'draft-1', savedAt: '2026-10-20T10:00:00.000Z' })),
  saveExisting: vi.fn(async (_previous: unknown, _data: FormData): Promise<ComposerActionState> => ({ status: 'error', message: 'safe failure', values: {} })),
  targetRows: vi.fn(async () => [] as Array<{ id: string; socialAccount: { provider: string } | null }>),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock('../src/modules/publishing/ui/posts/actions', async importOriginal => ({
  ...await importOriginal<typeof import('../src/modules/publishing/ui/posts/actions')>(),
  createPostWithRecoveryAction: mocks.action,
}));
vi.mock('../src/modules/publishing/ui/compose/queue-actions', () => ({
  autosaveDraftAction: mocks.autosave,
  previewQueueAction: vi.fn(async () => ({ status: 'error', message: 'unavailable' })),
  saveQueueComposerAction: mocks.saveExisting,
}));
vi.mock('../src/server/data', () => ({ prisma: { target: { findMany: mocks.targetRows } } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: vi.fn(async () => 50) }));

import { ContentProvider } from '../src/modules/publishing/ui/ContentProvider';
import { contentCopyDefaults, contentPolicyDefaults, resolveContentCopy } from '../src/modules/publishing/ui/content-copy';
import { ToastProvider } from '../src/components/Toast';
import { PostComposer } from '../src/modules/publishing/ui/compose/PostComposer';
import { withPlatformNames } from '../src/modules/publishing/server/read';
import { PostsTable, type PostsTableRow } from '../src/modules/publishing/ui/posts/PostsTable';
import { StatusCell, remotePlatformName } from '../src/modules/publishing/ui/posts/PostTableCells';
import { QueueTimeline, groupByChannel } from '../src/modules/publishing/ui/queue/QueueTimeline';
import { composerCopy } from '../src/modules/publishing/ui/compose/composer-copy';
import { postsNotice } from '../src/modules/publishing/ui/posts/notices';
import { kitCopy } from '../src/modules/publishing/ui/kit/copy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const target = (id: string, name: string, status: string, platformName: string | null = 'Facebook') => ({ id: `pt-${id}-${status}`, status, remotePostId: null, remoteUrl: null, target: { id, type: 'channel', name, pictureUrl: null, platformName } });
const post = (id: string, over: Record<string, unknown> = {}) => ({
  id, authorId: 'user-1', createdAt: new Date('2026-10-18T10:00:00Z'), message: `Message ${id}`, firstComment: null, link: null, media: [], status: 'scheduled', publishedAt: null,
  scheduledAt: new Date('2026-10-21T10:00:00Z'), targets: [target('c1', 'Studio', 'pending')], whenLabel: 'Oct 21, 2026', canEdit: true, canDuplicate: false, ...over,
}) as unknown as PostsTableRow;

describe('platform display names in the read model', () => {
  it('adds the installed module name to every destination and null for unknown providers', async () => {
    mocks.targetRows.mockResolvedValueOnce([{ id: 'c1', socialAccount: { provider: 'facebook' } }, { id: 'c2', socialAccount: { provider: 'removed-provider' } }, { id: 'c3', socialAccount: null }]);
    const posts = await withPlatformNames('workspace', [{ targets: [{ target: { id: 'c1' } }, { target: { id: 'c2' } }] }, { targets: [{ target: { id: 'c3' } }, { target: { id: 'c1' } }] }]);
    expect(posts[0]!.targets.map(entry => entry.target.platformName)).toEqual(['Facebook', null]);
    expect(posts[1]!.targets.map(entry => entry.target.platformName)).toEqual([null, 'Facebook']);
    expect(mocks.targetRows).toHaveBeenCalledOnce();
    expect(mocks.targetRows.mock.calls[0]).toEqual([{ where: { workspaceId: 'workspace', id: { in: ['c1', 'c2', 'c3'] } }, select: { id: true, socialAccount: { select: { provider: true } } } }]);
  });

  it('does not query when there are no destinations', async () => {
    expect(await withPlatformNames('workspace', [{ targets: [] }])).toEqual([{ targets: [] }]);
    expect(mocks.targetRows).not.toHaveBeenCalled();
  });

  it('names the platform on the scheduling badge only for remotely held destinations', () => {
    const held = post('p', { targets: [target('c1', 'Studio', 'scheduled_remote', 'Facebook'), target('c2', 'Shop', 'scheduled_remote', 'Facebook'), target('c3', 'Blog', 'pending', 'Other')] });
    expect(remotePlatformName(held)).toBe('Facebook');
    expect(renderToStaticMarkup(createElement(StatusCell, { post: held }))).toContain('>Facebook<');
    expect(renderToStaticMarkup(createElement(StatusCell, { post: held, locale: 'fr' }))).toContain('publiée là-bas');
    // Without module metadata the generic word is used, never a guessed provider.
    expect(renderToStaticMarkup(createElement(StatusCell, { post: post('q', { targets: [target('c1', 'Studio', 'scheduled_remote', null)] }) }))).toContain('>Platform<');
  });
});

describe('posts table', () => {
  const manage = { targets: [], canPublish: false, canOrganize: false, canQueue: false, imageRules: { allowedMimeTypes: [], maxUploadBytes: 1, maxAltCharacters: 1, maxMedia: 1, maxFirstCommentDelayMinutes: 1 }, timeZone: 'UTC', undoSendSeconds: 0 };
  const mount = async (rows: PostsTableRow[], extra: Partial<Parameters<typeof PostsTable>[0]> = {}) =>
    act(async () => root.render(createElement(ToastProvider, null, createElement(PostsTable, { rows, caption: 'Posts', selectable: true, canRetry: true, manage, empty: createElement('p', null, 'Nothing here'), ...extra }))));

  it('shows the empty state supplied by the screen', async () => {
    await mount([]);
    expect(container.textContent).toContain('Nothing here');
    expect(container.querySelector('table')).toBeNull();
  });

  it('selects rows with the shared checkboxes and reveals the bulk toolbar with a count', async () => {
    await mount([post('a'), post('b')]);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    const boxes = container.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.getAttribute('aria-label')).toBe('Select post Message a');
    await act(async () => boxes[0]!.click());
    expect(container.querySelector('[role="toolbar"]')?.textContent).toContain('1 selected');
    await act(async () => container.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!.click());
    expect(container.querySelector('[role="toolbar"]')?.textContent).toContain('2 selected');
    const clear = [...container.querySelectorAll('button')].find(button => button.textContent === 'Clear selection')!;
    await act(async () => clear.click());
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('omits selection when the member cannot write posts', async () => {
    await mount([post('a')], { selectable: false });
    expect(container.querySelector('tbody input[type="checkbox"]')).toBeNull();
  });

  it('keeps the bulk dialog open with Retry when the service result is unconfirmed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await mount([post('a')]);
    await act(async () => container.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')!.click());
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Duplicate')!.click());
    const dialog = container.querySelector('dialog')!;
    await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Duplicate')!.click());
    expect(dialog.textContent).toContain('could not be confirmed');
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Try again');
    // Selection and the dialog survive so nothing typed or chosen is lost.
    expect(container.querySelector('[role="toolbar"]')?.textContent).toContain('1 selected');
  });

  it('offers the side preview and the post page from every row menu', async () => {
    await mount([post('a'), post('b', { canEdit: false })]);
    const menus = [...container.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')];
    expect(menus.map(button => button.getAttribute('aria-label'))).toEqual(['Actions for Message a', 'Actions for Message b']);
    await act(async () => menus[1]!.click());
    expect([...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)).toEqual(['Post', 'Open details']);
  });

  it('opens the post beside the list, keeps the address shareable, and closes with Escape', async () => {
    window.history.replaceState(null, '', '/content?status=failed');
    await mount([post('a', { authorName: 'Amina' }), post('b', { authorName: 'Amina' })]);
    expect(container.querySelector('aside')).toBeNull();
    const open = container.querySelector<HTMLButtonElement>('button[aria-label^="Open post: Message a"]')!;
    await act(async () => open.click());
    const panel = container.querySelector('aside')!;
    expect(panel.querySelector('h2')?.textContent).toBe('Post');
    expect(panel.textContent).toContain('Message a');
    expect(panel.textContent).toContain('Where it goes');
    expect(panel.querySelector('a[href="/content/post/a"]')?.textContent).toBe('Open full details');
    expect(window.location.search).toBe('?status=failed&post=a');
    await act(async () => { panel.focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(container.querySelector('aside')).toBeNull();
    expect(window.location.search).toBe('?status=failed');
  });

  it('opens straight to the post named in a shared link', async () => {
    window.history.replaceState(null, '', '/content?post=b');
    await mount([post('a', { authorName: 'Amina' }), post('b', { authorName: 'Amina' })], { initialPostId: 'b' });
    expect(container.querySelector('aside')?.textContent).toContain('Message b');
  });

  it('lists compact rows that open the post page on phones', async () => {
    await mount([post('a'), post('b')]);
    const rows = [...container.querySelectorAll<HTMLAnchorElement>('ul li a.ui-list-row__main')];
    expect(rows.map(link => link.getAttribute('href'))).toEqual(['/content/post/a', '/content/post/b']);
    expect(rows[0]!.textContent).toContain('Message a');
  });
});

describe('queue timeline by channel', () => {
  const posts = [
    { id: 'p1', message: 'First', link: null, media: [], status: 'scheduled', scheduledAt: new Date('2026-10-21T09:00:00Z'), targets: [{ status: 'pending', target: { id: 'c2', name: 'Shop', pictureUrl: null, platformName: 'Facebook' } }, { status: 'scheduled_remote', target: { id: 'c1', name: 'Atelier', pictureUrl: null, platformName: 'Facebook' } }] },
    { id: 'p2', message: 'Second', link: null, media: [], status: 'scheduled', scheduledAt: new Date('2026-10-21T12:00:00Z'), targets: [{ status: 'pending', target: { id: 'c1', name: 'Atelier', pictureUrl: null, platformName: 'Facebook' } }] },
    { id: 'p3', message: 'Third', link: null, media: [], status: 'scheduled', scheduledAt: new Date('2026-10-22T12:00:00Z'), targets: [{ status: 'pending', target: { id: 'c1', name: 'Atelier', pictureUrl: null, platformName: 'Facebook' } }] },
  ];
  it('groups posts under each channel they publish to, sorted by channel name, keeping the order given', () => {
    const groups = groupByChannel(posts);
    expect(groups.map(group => group.name)).toEqual(['Atelier', 'Shop']);
    expect(groups[0]!.posts.map(item => item.id)).toEqual(['p1', 'p2', 'p3']);
    expect(groups[1]!.posts.map(item => item.id)).toEqual(['p1']);
  });

  it('limits slots per channel from the setting, says how many more, and badges who sends each post', () => {
    const html = renderToStaticMarkup(createElement(QueueTimeline, { posts, timeZone: 'UTC', maxPerChannel: 2 }));
    expect(html).toContain('+1 more on this page');
    expect(html).not.toContain('Third');
    expect(html).toContain('>Facebook<');
    expect(html).toContain('>App<');
    const fr = renderToStaticMarkup(createElement(QueueTimeline, { posts, timeZone: 'UTC', maxPerChannel: 2, locale: 'fr' }));
    expect(fr).toContain('+1 de plus sur cette page');
  });

  it('has matching English and French screen copy', () => {
    expect(Object.keys(kitCopy.fr).sort()).toEqual(Object.keys(kitCopy.en).sort());
    expect(Object.keys(composerCopy.fr).sort()).toEqual(Object.keys(composerCopy.en).sort());
    expect(postsNotice('created', 'fr')).toBe('Publication enregistrée.');
    expect(postsNotice('imported-3', 'en')).toBe('3 posts imported as drafts.');
    expect(postsNotice('unknown-code', 'fr')).toBeNull();
  });
});

describe('composer steps, scheduling words and autosave', () => {
  const nativeFormat: PublishingFormatDescriptor = { id: 'feed', label: 'Feed post', media: undefined, scheduling: { native: true, nativeLeadSeconds: { min: 600, max: 86400 } }, firstComment: true, remoteStatus: true, remoteDelete: true } as unknown as PublishingFormatDescriptor;
  const targets = [
    { id: 'a', name: 'Studio', type: 'channel', provider: 'facebook', platformName: 'Facebook', canPublish: true, publishingFormats: [nativeFormat], defaultPublishingFormatId: 'feed' },
    { id: 'b', name: 'Shop', type: 'channel', provider: 'other', platformName: 'Other', canPublish: true },
  ];
  const rules = { allowedMimeTypes: ['image/png'], maxUploadBytes: 5000, maxAltCharacters: 120, maxMessageCharacters: 500, maxMedia: 2 };
  const schedule = { date: '2026-10-25', time: '10:30', timeZone: 'UTC' };
  const render = (props: Record<string, unknown> = {}) => act(async () => root.render(createElement(ContentProvider, { copy: resolveContentCopy(contentCopyDefaults as never, props.aiLocale === 'fr' ? 'fr' : 'en'), policy: contentPolicyDefaults, locale: props.aiLocale === 'fr' ? 'fr' : 'en' }, createElement(PostComposer, { targets, imageRules: rules, maxFirstCommentDelayMinutes: 10080, schedule, authorName: 'Your team', createdAt: new Date('2026-10-16T10:00:00.000Z'), createdAtDisplay: 'Oct 16, 2026', ...props } as never))));
  const chips = () => [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].filter(button => !['Edit', 'Preview', 'Modifier', 'Aperçu'].includes(button.textContent ?? '') && !button.closest('aside'));
  const saveButton = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === label)!;
  const type = async (selector: string, value: string) => act(async () => {
    const field = container.querySelector<HTMLTextAreaElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
  });

  it('lays the editor out as Channels, Post text and Media, with the first comment and more options folded away', async () => {
    await render();
    const headings = [...container.querySelectorAll('form section h2')].map(heading => heading.textContent);
    expect(headings).toEqual(['Channels', 'Post text', 'Media']);
    expect(container.querySelector('#composer-message')).not.toBeNull();
    // Channels are toggle chips inside the editor; the actions live in the sticky action bar, not in the sidebar.
    expect(chips().map(button => button.querySelector('[class*="chipName"]')?.textContent)).toEqual(['Studio', 'Shop']);
    expect(saveButton('Save draft')).toBeDefined();
    expect(container.querySelector('details summary')?.textContent).toBe('More options');
    expect(container.querySelector('input[type="hidden"][name="scheduleDate"]')).not.toBeNull();
  });

  it('explains in plain words who publishes each destination and names the platform', async () => {
    await render({ remoteScheduling: { offered: true, defaultMode: 'application' } });
    await act(async () => chips()[0]!.click());
    await act(async () => chips()[1]!.click());
    const list = container.querySelector('ul[aria-label="Who sends the post at that time"]')!;
    expect(list.textContent).toContain('We publish at the time.');
    expect(list.textContent).toContain('this destination cannot hold a schedule itself');
    expect(container.textContent).toContain('Sent now to Facebook');
    const remote = container.querySelector<HTMLInputElement>('input[name="scheduleMode"][value="remote"]')!;
    await act(async () => remote.click());
    expect(list.textContent).toContain('Sent now to Facebook; it publishes at the time even if we are offline.');
    expect(list.textContent).toContain('this destination cannot hold a schedule itself');
  });

  it('marks the chosen channels and counts them', async () => {
    await render();
    expect(chips().every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(container.querySelector('form section')!.textContent).toContain('0 selected');
    await act(async () => chips()[0]!.click());
    expect(chips()[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('form section')!.textContent).toContain('1 selected');
  });

  it('keeps the channel thumbnail on its chip', async () => {
    await render({ targets: [{ ...targets[0], pictureUrl: 'https://images.example.test/studio.jpg' }] });
    expect(container.querySelector('form section button img')?.getAttribute('src')).toBe('https://images.example.test/studio.jpg');
  });

  it('is written in French when the page language is French', async () => {
    await render({ aiLocale: 'fr' });
    expect([...container.querySelectorAll('form section h2')].map(heading => heading.textContent)).toEqual(['Canaux', 'Texte de la publication', 'Médias']);
    expect(saveButton('Enregistrer le brouillon')).toBeDefined();
  });

  it('saves a draft in the background after the interval, then updates the same draft', async () => {
    vi.useFakeTimers();
    await render({ autosaveSeconds: 5 });
    await type('#composer-message', 'Hello world');
    await act(async () => { await vi.advanceTimersByTimeAsync(4900); });
    expect(mocks.autosave).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(mocks.autosave).toHaveBeenCalledTimes(1);
    expect(mocks.autosave.mock.calls[0]![0]).toBeNull();
    expect((mocks.autosave.mock.calls[0]![1] as FormData).get('message')).toBe('Hello world');
    expect(container.textContent).toContain('Draft saved 10:00 AM');
    expect(container.querySelector<HTMLInputElement>('input[name="draftPostId"]')!.value).toBe('draft-1');
    await type('#composer-message', 'Hello world again');
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(mocks.autosave).toHaveBeenCalledTimes(2);
    expect(mocks.autosave.mock.calls[1]![0]).toBe('draft-1');
    // Nothing changed since: no third save.
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(mocks.autosave).toHaveBeenCalledTimes(2);
  });

  it('never autosaves when the setting is off, the text is empty, or an upload is pending', async () => {
    vi.useFakeTimers();
    await render({ autosaveSeconds: 0 });
    await type('#composer-message', 'Hello');
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mocks.autosave).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ autosaveSeconds: 5 });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(mocks.autosave).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Could not save automatically');
  });

  it('serializes slow background saves and saves the latest recipe to the same draft', async () => {
    vi.useFakeTimers();
    let finish!: (value: Awaited<ReturnType<typeof mocks.autosave>>) => void;
    mocks.autosave.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render({ autosaveSeconds: 5 });
    await type('#composer-message', 'WordPress recipe: apple tart');
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    await type('#composer-message', 'WordPress recipe: apple tart with cinnamon');
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(mocks.autosave).toHaveBeenCalledTimes(1);
    await act(async () => finish({ status: 'saved', draftPostId: 'recipe-draft', savedAt: '2026-10-20T10:00:00Z' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(mocks.autosave).toHaveBeenCalledTimes(2);
    expect(mocks.autosave.mock.calls[1]![0]).toBe('recipe-draft');
    expect(mocks.autosave.mock.calls[1]![1].get('message')).toBe('WordPress recipe: apple tart with cinnamon');
  });

  it('submits once after an in-flight autosave and preserves ten Page destinations and schedule intent', async () => {
    vi.useFakeTimers();
    let finish!: (value: Awaited<ReturnType<typeof mocks.autosave>>) => void;
    mocks.autosave.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pages = Array.from({ length: 10 }, (_, index) => ({ ...targets[0], id: `page-${index + 1}`, name: `Recipe Page ${index + 1}` }));
    await render({ targets: pages, autosaveSeconds: 5 });
    await act(async () => { chips().forEach(button => button.click()); });
    await type('#composer-message', 'WordPress recipe: apple tart');
    await act(async () => saveButton('Add a first comment').click());
    await type('#composer-first-comment', 'Ingredients and preparation');
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === 'Schedule for Oct 25, 10:30')!;
    await act(async () => { button.click(); button.click(); });
    expect(mocks.saveExisting).not.toHaveBeenCalled();
    await act(async () => finish({ status: 'saved', draftPostId: 'recipe-draft', savedAt: '2026-10-20T10:00:00Z' }));
    expect(mocks.saveExisting).toHaveBeenCalledTimes(1);
    const data = mocks.saveExisting.mock.calls[0]![1];
    expect(data.get('draftPostId')).toBe('recipe-draft');
    expect(data.get('intent')).toBe('schedule');
    expect(data.getAll('targetIds')).toEqual(pages.map(page => page.id));
    expect(data.get('firstComment')).toBe('Ingredients and preparation');
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it('says autosave paused, keeps the text, and does not retry in a loop when the save fails', async () => {
    vi.useFakeTimers();
    mocks.autosave.mockResolvedValueOnce({ status: 'error' } as never);
    await render({ autosaveSeconds: 5 });
    await type('#composer-message', 'Keep me');
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(container.textContent).toContain('Could not save automatically');
    expect(container.querySelector<HTMLTextAreaElement>('#composer-message')!.value).toBe('Keep me');
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(mocks.autosave).toHaveBeenCalledTimes(1);
  });
});
