// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ push: vi.fn(), path: '/content', search: '' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }), usePathname: () => nav.path, useSearchParams: () => new URLSearchParams(nav.search) }));
vi.mock('../src/modules/publishing/ui/posts/export-actions', () => ({ loadPostExportLabels: vi.fn(async () => { throw new Error('not used'); }) }));
vi.mock('../src/modules/publishing/ui/SavedViews', () => ({ SavedViews: ({ screen }: { screen: string }) => createElement('div', { 'data-saved-views': screen }) }));

import { ApprovalsList, type ApprovalRow } from '../src/modules/publishing/ui/approvals/ApprovalsList';
import { CalendarToolbar } from '../src/modules/publishing/ui/calendar/CalendarToolbar';
import { PostsHeaderTools } from '../src/modules/publishing/ui/posts/PostsHeaderTools';
import { StatusChip } from '../src/components/StatusChip';
import { postGroup } from '../src/lib/post-groups';
import { freeQueueSlots } from '../src/modules/publishing/ui/calendar/free-slots';
import { contentCopyDefaults, contentCopySchema, contentPolicyDefaults, contentPolicySchema, fillContent } from '../src/modules/publishing/ui/content-copy';
import { ContentProvider } from '../src/modules/publishing/ui/ContentProvider';
import { resolveContentCopy } from '../src/modules/publishing/ui/content-copy';
import { publishingCopyDefaults } from '../src/modules/publishing/ui/kit/copy';
import { PublishingCopyProvider } from '../src/modules/publishing/ui/kit/CopyProvider';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nav.push.mockClear(); nav.path = '/content'; nav.search = '';
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const withContent = (child: ReturnType<typeof createElement>, locale: 'en' | 'fr' = 'en') =>
  createElement(ContentProvider, { copy: resolveContentCopy(contentCopyDefaults as never, locale), policy: contentPolicyDefaults, locale }, createElement(PublishingCopyProvider, { catalog: publishingCopyDefaults, locale, children: child }));
const setSelect = async (select: HTMLSelectElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); });

describe('Create and Content copy and policy', () => {
  it('ships English and French text for every message and keeps the same placeholders in both', () => {
    const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort().join();
    for (const [key, message] of Object.entries(contentCopyDefaults)) {
      expect(message.en.length, key).toBeGreaterThan(0);
      expect(message.fr.length, key).toBeGreaterThan(0);
      expect(placeholders(message.fr), key).toBe(placeholders(message.en));
    }
    expect(contentCopySchema.safeParse(contentCopyDefaults).success).toBe(true);
    // A catalog that drops a placeholder is refused, so Root cannot break a sentence.
    expect(contentCopySchema.safeParse({ ...contentCopyDefaults, createStatusSaved: { en: 'Draft saved', fr: 'Brouillon enregistré à {time}' } }).success).toBe(false);
  });
  it('validates the behaviour policy and refuses an unknown or out-of-range value', () => {
    expect(contentPolicySchema.safeParse(contentPolicyDefaults).success).toBe(true);
    expect(contentPolicySchema.safeParse({ ...contentPolicyDefaults, publishNowLeadMinutes: 0 }).success).toBe(false);
    expect(contentPolicySchema.safeParse({ ...contentPolicyDefaults, reconnectHref: 'https://elsewhere.test' }).success).toBe(false);
    expect(contentPolicySchema.safeParse({ ...contentPolicyDefaults, extra: 1 }).success).toBe(false);
  });
  it('fills named placeholders and leaves an unknown one visible', () => {
    expect(fillContent('Add to queue · {when} {missing}', { when: 'Oct 23' })).toBe('Add to queue · Oct 23 {missing}');
  });
});

describe('free queue slots on the calendar', () => {
  const weekly = [{ dayOfWeek: 4, hour: 9, minute: 0 }, { dayOfWeek: 4, hour: 17, minute: 30 }, { dayOfWeek: 4, hour: 9, minute: 0 }, { dayOfWeek: 5, hour: 8, minute: 15 }];
  // 2026-10-22 is a Thursday (4); 2026-10-21 is a Wednesday.
  const keys = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
  it('offers only times still ahead today, every time on later days, and nothing on past days', () => {
    const result = freeQueueSlots({ keys, today: '2026-10-22', nowTime: '10:00', weekly, taken: () => new Set(), limit: 3 });
    expect([...result.entries()]).toEqual([['2026-10-22', ['17:30']], ['2026-10-23', ['08:15']]]);
  });
  it('skips a time a post already uses and respects the per-day limit', () => {
    const taken = freeQueueSlots({ keys, today: '2026-10-21', nowTime: '00:00', weekly, taken: key => new Set(key === '2026-10-22' ? ['09:00'] : []), limit: 3 });
    expect(taken.get('2026-10-22')).toEqual(['17:30']);
    expect(freeQueueSlots({ keys, today: '2026-10-21', nowTime: '00:00', weekly, taken: () => new Set(), limit: 1 }).get('2026-10-22')).toEqual(['09:00']);
    expect(freeQueueSlots({ keys, today: '2026-10-21', nowTime: '00:00', weekly, taken: () => new Set(), limit: 0 }).size).toBe(0);
  });
});

describe('calendar toolbar', () => {
  const props = {
    navigation: { previous: '/content/calendar?view=week&date=2026-10-08&status=published', today: '/content/calendar?view=week&date=2026-10-14&status=published', next: '/content/calendar?view=week&date=2026-10-22&status=published', unit: 'week' as const },
    rangeLabel: 'Oct 12 – 18, 2026', view: 'week' as const, viewHrefs: { month: '/content/calendar?view=month', week: '/content/calendar?view=week', list: '/content/calendar?view=list' },
    statuses: [{ value: 'failed', label: 'Failed' }], origins: [], chips: [], resetHref: '/content/calendar?view=week',
  };
  it('keeps navigation, the range, the view switch and one Filter button in the page', async () => {
    nav.path = '/content/calendar';
    await act(async () => root.render(withContent(createElement(CalendarToolbar, props))));
    const links = [...container.querySelectorAll('nav a')];
    expect(links.map(link => link.getAttribute('href'))).toEqual([props.navigation.previous, props.navigation.today, props.navigation.next]);
    expect(links[0]!.getAttribute('aria-label')).toBe('Previous week');
    expect(container.querySelector('h2')?.textContent).toBe('Oct 12 – 18, 2026');
    expect(container.querySelector('a[aria-current="true"]')?.textContent).toBe('Week');
    expect(container.querySelectorAll('.ui-filter-button')).toHaveLength(1);
  });
  it('writes a chosen status into the address and keeps the other parameters', async () => {
    nav.path = '/content/calendar'; nav.search = 'view=week&date=2026-10-14&channel=c1';
    await act(async () => root.render(withContent(createElement(CalendarToolbar, props))));
    await act(async () => container.querySelector<HTMLButtonElement>('.ui-filter-button')!.click());
    await setSelect(document.querySelector<HTMLSelectElement>('.ui-filter-pop select')!, 'failed');
    expect(nav.push).toHaveBeenCalledWith('/content/calendar?view=week&date=2026-10-14&channel=c1&status=failed');
    expect(document.querySelector('[data-saved-views="calendar"]')).not.toBeNull();
  });
  it('is written in French', async () => {
    await act(async () => root.render(withContent(createElement(CalendarToolbar, props), 'fr')));
    expect(container.querySelector('.ui-filter-button')?.textContent).toBeTruthy();
    expect(container.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe('Navigation du calendrier');
  });
});

describe('posts filter row', () => {
  const props = { statuses: [{ value: 'failed', label: 'Failed' }, { value: 'published', label: 'Published' }], origins: [{ kind: 'recipe', label: 'Recipes' }], chips: [], resetHref: '/content?channel=c1', searchMaxCharacters: 120, exportMaxPosts: 100, exportMaxBytes: 1000, canExport: true };
  it('changes the status in the address, drops the page number and keeps the channel scope', async () => {
    nav.search = 'channel=c1&page=3&post=p1';
    await act(async () => root.render(withContent(createElement(PostsHeaderTools, props))));
    await act(async () => container.querySelector<HTMLButtonElement>('.ui-filter-button')!.click());
    const selects = document.querySelectorAll<HTMLSelectElement>('.ui-filter-pop select');
    expect(selects).toHaveLength(2);
    await setSelect(selects[0]!, 'failed');
    expect(nav.push).toHaveBeenCalledWith('/content?channel=c1&status=failed');
    await setSelect(selects[1]!, 'recipe');
    expect(nav.push).toHaveBeenLastCalledWith('/content?channel=c1&origin=recipe');
  });
  it('searches with a real form that keeps the active filters, and offers saved views and export', async () => {
    nav.search = 'channel=c1&status=failed&q=tart';
    await act(async () => root.render(withContent(createElement(PostsHeaderTools, props))));
    const form = container.querySelector<HTMLFormElement>('form[role="search"]')!;
    expect(form.getAttribute('action')).toBe('/content');
    expect(Object.fromEntries([...new FormData(form)])).toEqual({ channel: 'c1', status: 'failed', q: 'tart' });
    expect(container.querySelector<HTMLInputElement>('input[name="q"]')!.maxLength).toBe(120);
    await act(async () => container.querySelector<HTMLButtonElement>('.ui-filter-button')!.click());
    expect(document.querySelector('[data-saved-views="posts"]')).not.toBeNull();
    expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Export')).toBe(true);
  });
  it('hides Export when the member cannot export', async () => {
    await act(async () => root.render(withContent(createElement(PostsHeaderTools, { ...props, canExport: false }))));
    expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Export')).toBe(false);
  });
});

describe('approvals review cards', () => {
  const row = (id: string): ApprovalRow => ({ id, authorId: 'u2', message: `Please review ${id}`, firstComment: null, link: null, media: [], status: 'pending_approval', scheduledAt: null, publishedAt: null, createdAt: new Date('2026-10-20T10:00:00Z'), displayTime: 'Oct 20', targets: [{ status: 'pending', remotePostId: null, remoteUrl: null, target: { id: 'c1', type: 'page', name: 'Studio', pictureUrl: null } }], authorName: 'Amina', whenLabel: 'Oct 20, 2026' } as unknown as ApprovalRow);
  const mount = (action = vi.fn(), canReview = true) => act(async () => root.render(withContent(createElement(ApprovalsList, { rows: [row('a'), row('b')], timeZone: 'UTC', canReview, reviewAction: action }))));
  const press = async (target: Element, key: string) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });

  it('shows each post with its preview, author and the two decisions', async () => {
    await mount();
    const cards = container.querySelectorAll('article[tabindex="0"]');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('Submitted by Amina');
    expect(cards[0]!.textContent).toContain('Please review a');
    expect([...cards[0]!.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Approve', 'Request changes']);
    expect(container.textContent).toContain('press A to jump to Approve');
  });
  it('A moves focus to Approve and R opens the note, without deciding anything', async () => {
    const action = vi.fn();
    await mount(action);
    const card = container.querySelector('article')!;
    await press(card, 'a');
    expect(document.activeElement).toBe(card.querySelector('button[value="approve"]'));
    await press(card, 'r');
    expect(card.querySelector('textarea[name="note"]')).not.toBeNull();
    expect(card.querySelector('button[value="reject"]')?.textContent).toBe('Request changes');
    expect(action).not.toHaveBeenCalled();
  });
  it('submits the decision and the note through the review action', async () => {
    const action = vi.fn(async (_data: FormData) => undefined);
    await mount(action);
    const card = container.querySelector('article')!;
    await act(async () => [...card.querySelectorAll('button')].find(button => button.textContent === 'Request changes')!.click());
    const note = card.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Shorter please'); note.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => card.querySelector<HTMLButtonElement>('button[value="reject"]')!.click());
    expect(action).toHaveBeenCalledTimes(1);
    const data = action.mock.calls[0]![0];
    expect([data.get('postId'), data.get('decision'), data.get('note')]).toEqual(['a', 'reject', 'Shorter please']);
  });
  it('offers no decision to a viewer and ignores the shortcuts', async () => {
    await mount(vi.fn(), false);
    expect(container.querySelector('button[value="approve"]')).toBeNull();
    await press(container.querySelector('article')!, 'r');
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.textContent).not.toContain('press A');
  });
});

describe('planned vs outcome grouping', () => {
  it('splits draft/pending/scheduled/publishing from published and every resolved state', () => {
    for (const status of ['draft', 'pending_approval', 'scheduled', 'publishing']) expect(postGroup(status)).toBe('planned');
    for (const status of ['published', 'partially_failed', 'failed', 'cancelled', 'rejected']) expect(postGroup(status)).toBe('outcome');
  });
  it('marks post-level chips with their group and leaves other marks ungrouped', async () => {
    await act(async () => root.render(createElement('div', null,
      createElement(StatusChip, { status: 'scheduled' }),
      createElement(StatusChip, { status: 'published' }),
      createElement(StatusChip, { status: 'active' }))));
    const chips = [...container.querySelectorAll('[data-status]')];
    expect(chips.map(chip => chip.getAttribute('data-group'))).toEqual(['planned', 'outcome', null]);
    // The label and shape stay: grouping only adds the group marker.
    expect(chips[0]!.textContent).toContain('Scheduled');
    expect(chips[1]!.querySelector('svg')).not.toBeNull();
  });
});

describe('planned vs outcome status filters', () => {
  const all = [
    { value: 'draft', label: 'Draft' }, { value: 'pending_approval', label: 'Pending Approval' },
    { value: 'scheduled', label: 'Scheduled' }, { value: 'publishing', label: 'Publishing' },
    { value: 'published', label: 'Published' }, { value: 'partially_failed', label: 'Partially Failed' },
    { value: 'failed', label: 'Failed' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'rejected', label: 'Rejected' },
  ];
  const groups = () => [...document.querySelectorAll('.ui-filter-pop optgroup')].map(group => ({
    label: group.getAttribute('label'),
    values: [...group.querySelectorAll('option')].map(option => (option as HTMLOptionElement).value),
  }));
  it('groups the Posts statuses into Planned vs Outcome without dropping or renaming a value', async () => {
    await act(async () => root.render(withContent(createElement(PostsHeaderTools, { statuses: all, origins: [], chips: [], resetHref: '/content', searchMaxCharacters: 120, exportMaxPosts: 100, exportMaxBytes: 1000, canExport: false }))));
    await act(async () => container.querySelector<HTMLButtonElement>('.ui-filter-button')!.click());
    expect(groups()).toEqual([
      { label: 'Planned', values: ['draft', 'pending_approval', 'scheduled', 'publishing'] },
      { label: 'Outcome', values: ['published', 'partially_failed', 'failed', 'cancelled', 'rejected'] },
    ]);
    // Every filter value still works from its group.
    await setSelect(document.querySelector<HTMLSelectElement>('.ui-filter-pop select')!, 'cancelled');
    expect(nav.push).toHaveBeenCalledWith('/content?status=cancelled');
  });
  it('groups the Calendar statuses the same way and names the groups in French', async () => {
    const props = {
      navigation: { previous: '/p', today: '/t', next: '/n', unit: 'month' as const }, rangeLabel: 'October 2026', view: 'month' as const,
      viewHrefs: { month: '/m', week: '/w', list: '/l' }, statuses: all, origins: [], chips: [], resetHref: '/content/calendar',
    };
    nav.path = '/content/calendar';
    await act(async () => root.render(withContent(createElement(CalendarToolbar, props), 'fr')));
    await act(async () => container.querySelector<HTMLButtonElement>('.ui-filter-button')!.click());
    expect(groups()).toEqual([
      { label: 'Prévues', values: ['draft', 'pending_approval', 'scheduled', 'publishing'] },
      { label: 'Résultats', values: ['published', 'partially_failed', 'failed', 'cancelled', 'rejected'] },
    ]);
  });
});

describe('planned vs published counts', () => {
  const toolbar = (counts?: { planned: number; published: number }) => ({
    navigation: { previous: '/p', today: '/t', next: '/n', unit: 'month' as const }, rangeLabel: 'October 2026', view: 'month' as const,
    viewHrefs: { month: '/m', week: '/w', list: '/l' }, statuses: [{ value: 'failed', label: 'Failed' }], origins: [], chips: [], resetHref: '/content/calendar',
    ...(counts ? { counts } : {}),
  });
  it('says "X planned · Y published" on the calendar toolbar, never a bare total', async () => {
    nav.path = '/content/calendar';
    await act(async () => root.render(withContent(createElement(CalendarToolbar, toolbar({ planned: 3, published: 12 })))));
    expect(container.textContent).toContain('3 planned · 12 published');
  });
  it('writes the counts in French and hides them when unknown', async () => {
    nav.path = '/content/calendar';
    await act(async () => root.render(withContent(createElement(CalendarToolbar, toolbar({ planned: 3, published: 12 })), 'fr')));
    expect(container.textContent).toContain('3 prévues · 12 publiées');
    await act(async () => root.render(withContent(createElement(CalendarToolbar, toolbar()))));
    expect(container.textContent).not.toContain('planned');
  });
});
