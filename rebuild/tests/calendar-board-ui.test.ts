// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../src/app/publishing/calendar/actions', () => ({ reschedulePostAction: vi.fn() }));

import { SidebarDockContext } from '../src/components/SidebarDock';
import { CalendarBoard } from '../src/app/publishing/calendar/CalendarBoard';
import { reschedulePostAction } from '../src/app/publishing/calendar/actions';
import type { BoardDay, BoardPost } from '../src/app/publishing/calendar/types';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let sidebar: HTMLDivElement;

const samplePost: BoardPost = {
  id: 'post-1', text: 'A full calendar post with useful detail.', status: 'scheduled', whenIso: '2026-10-15T12:00:00.000Z', clockLabel: 'Server clock label', wallTime: { date: '2026-10-15', time: '23:30' }, movable: true,
  moveOptions: [{ id: 'day-later', label: '1 day later', date: '2026-10-16', time: '23:30' }],
  channels: [{ id: 'channel-1', name: 'Studio', platformName: 'Social', mark: { text: 'S', color: '#286b4b' } }],
  authorName: 'Amina',
  preview: {
    id: 'post-1', authorId: 'author-1', message: 'A full calendar post with useful detail.', firstComment: 'Follow-up information.',
    link: 'https://example.test/article', media: [{ kind: 'image', url: 'https://cdn.example.test/photo.jpg', altText: 'Studio photo' }],
    status: 'published', scheduledAt: null, publishedAt: new Date('2026-10-15T12:00:00.000Z'), createdAt: new Date('2026-10-14T12:00:00.000Z'),
    displayTime: 'Server preview time',
    targets: [{ status: 'published', remotePostId: 'remote-1', remoteUrl: 'https://social.example.test/posts/1', target: { id: 'channel-1', type: 'page', name: 'Studio', pictureUrl: null } }],
  },
};
const days: BoardDay[] = [{ key: '2026-10-15', label: 'Thu 15', longLabel: 'Thursday, October 15', inMonth: true, isToday: false, isPast: false, slotEndedByHour: Object.fromEntries(Array.from({ length: 24 }, (_, hour) => [`${String(hour).padStart(2, '0')}:00`, false])), posts: [samplePost] }];

const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); this.tabIndex = -1; });
const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });

async function render(dayOverrides: Partial<BoardDay> = {}) {
  await act(async () => root.render(createElement(SidebarDockContext.Provider, { value: sidebar }, createElement(CalendarBoard, {
    view: 'week', days: days.map(day => ({ ...day, ...dayOverrides })), timeZone: 'UTC', nowIso: '2026-10-14T09:00:00.000Z', canCreate: false, filterQuery: '&status=published', defaultScheduleTime: '09:00',
    navigation: { previous: '/publishing/calendar?view=week&date=2026-10-08&status=published', today: '/publishing/calendar?view=week&date=2026-10-14&status=published', next: '/publishing/calendar?view=week&date=2026-10-22&status=published', unit: 'week' },
  }))));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = close;
  container = document.createElement('div'); sidebar = document.createElement('div');
  document.body.append(container, sidebar); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); sidebar.remove(); });

describe('calendar post preview and navigation', () => {
  it('keeps invalid picked times in the move dialog with associated field errors', async () => {
    await render();
    const moveButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.startsWith('Move'))!;
    await act(async () => moveButton.click());
    const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-labelledby]')!;
    const date = dialog.querySelector<HTMLInputElement>('[name=date]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(date, ''); date.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Review move')!.click());
    expect(document.activeElement).toBe(date); expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(date.getAttribute('aria-describedby')!)?.textContent).toBeTruthy();
    expect(dialog.textContent).toContain('Pick a date and time'); expect(reschedulePostAction).not.toHaveBeenCalled();
  });
  it('rejects drag targets in elapsed slots while keeping later slots available', async () => {
    await render({ slotEndedByHour: { ...days[0]!.slotEndedByHour, '06:00': true } });
    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
    const drag = (type: string) => { const event = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: transfer }); return event; };
    await act(async () => container.querySelector('[draggable="true"]')!.dispatchEvent(drag('dragstart')));
    const elapsed = container.querySelector('[role="group"][aria-label="Thursday, October 15, 6 AM"]')!;
    const later = container.querySelector('[role="group"][aria-label="Thursday, October 15, 7 AM"]')!;
    const rejected = drag('dragover'); const accepted = drag('dragover');
    await act(async () => { elapsed.dispatchEvent(rejected); later.dispatchEvent(accepted); });
    expect(rejected.defaultPrevented).toBe(false);
    expect(accepted.defaultPrevented).toBe(true);
  });

  it('opens and closes the full shared preview with saved media and destination details', async () => {
    await render();
    expect(container.textContent).toContain('Server clock label');
    const lateHourSlot = container.querySelector('[role="group"][aria-label="Thursday, October 15, 11 PM"]');
    expect(lateHourSlot?.textContent).toContain('A full calendar post with useful detail.');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="View post:"]')!.click());
    const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-labelledby]')!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('A full calendar post with useful detail.');
    expect(dialog.textContent).toContain('Follow-up information.');
    expect(dialog.textContent).toContain('Server preview time');
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.test/photo.jpg');
    expect(dialog.querySelector('a[href="https://social.example.test/posts/1"]')).not.toBeNull();
    await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click());
    expect(document.querySelector('dialog[aria-labelledby]')).toBeNull();
  });
  it('shows a content summary for captionless calendar cards and keeps the preview focused on media', async () => {
    const preview = samplePost.preview!;
    const post: BoardPost = {
      ...samplePost,
      text: 'Post with 2 images and link',
      preview: { ...preview, message: '', firstComment: null, media: [...preview.media as Array<{ kind: string; url: string }>, { kind: 'image', url: 'https://cdn.example.test/photo-2.jpg' }] },
    };
    await render({ posts: [post] });
    const lateHourSlot = container.querySelector('[role="group"][aria-label="Thursday, October 15, 11 PM"]')!;
    expect(lateHourSlot.textContent).toContain('Post with 2 images and link');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="View post:"]')!.click());
    const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-labelledby]')!;
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.test/photo.jpg');
    expect(dialog.textContent).not.toContain('No text included');
    expect(dialog.textContent).not.toContain('Your post text will appear here');
  });

  it('places previous, today and next navigation in the contextual sidebar with filters retained', async () => {
    await render();
    const nav = sidebar.querySelector('nav[aria-label="Calendar week navigation"]')!;
    expect(nav.querySelector('a')?.getAttribute('href')).toContain('status=published');
    expect(nav.querySelectorAll('a')).toHaveLength(3);
    expect([...nav.querySelectorAll('a')].map(link => link.textContent?.trim())).toEqual(['Previous week', 'Today', 'Next week']);
  });

  it('uses the server wall time in the move dialog and the server success label after saving', async () => {
    vi.mocked(reschedulePostAction).mockResolvedValue({ ok: true, scheduledAt: '2026-10-16T22:30:00.000Z', displayTime: 'Fri, Oct 16, 11:30 PM' });
    await render();
    const moveButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.startsWith('Move'))!;
    await act(async () => moveButton.click());
    let dialog = document.querySelector<HTMLDialogElement>('dialog[aria-labelledby]')!;
    expect(dialog.textContent).toContain('Currently scheduled for 2026-10-15 at 23:30.');
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '1 day later')!.click());
    dialog = document.querySelector<HTMLDialogElement>('dialog[aria-labelledby]')!;
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Move post')!.click());
    expect(container.textContent).toContain('Post moved to Fri, Oct 16, 11:30 PM');
  });
});
