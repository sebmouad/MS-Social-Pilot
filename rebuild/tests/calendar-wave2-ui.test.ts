// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../src/modules/publishing/ui/calendar/actions', () => ({ reschedulePostAction: vi.fn() }));

import { PublishingCopyProvider } from '../src/modules/publishing/ui/kit/CopyProvider';
import { publishingCopyDefaults } from '../src/modules/publishing/ui/kit/copy';
import { ContentProvider } from '../src/modules/publishing/ui/ContentProvider';
import { contentCopyDefaults, contentPolicyDefaults, resolveContentCopy } from '../src/modules/publishing/ui/content-copy';
import { CalendarBoard } from '../src/modules/publishing/ui/calendar/CalendarBoard';
import type { BoardDay, BoardPost } from '../src/modules/publishing/ui/calendar/types';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

const post = (id: string, text: string, channels: BoardPost['channels'], wallTime = { date: '2026-10-15', time: '10:00' }): BoardPost => ({
  id, text, status: 'scheduled', whenIso: `2026-10-15T${wallTime.time}:00.000Z`, clockLabel: `${wallTime.date} ${wallTime.time}`, wallTime,
  movable: true, moveOptions: [{ id: 'day-later', label: '1 day later', date: '2026-10-16', time: wallTime.time }], channels, authorName: 'Amina',
});
const studio = { id: 'channel-1', name: 'Studio', platformName: 'Social', mark: { text: 'S', color: '#286b4b' } };
const news = { id: 'channel-2', name: 'News', platformName: 'Social', mark: { text: 'N', color: '#7a2e2e' } };
const openHours = Object.fromEntries(Array.from({ length: 24 }, (_, hour) => [`${String(hour).padStart(2, '0')}:00`, false]));
const days: BoardDay[] = [
  { key: '2026-10-15', label: 'Thu 15', longLabel: 'Thursday, October 15', inMonth: true, isToday: true, isPast: false, slotEndedByHour: openHours, posts: [post('p1', 'Studio morning post', [studio]), post('p2', 'Joint noon post', [studio, news], { date: '2026-10-15', time: '12:00' })] },
  { key: '2026-10-16', label: 'Fri 16', longLabel: 'Friday, October 16', inMonth: true, isToday: false, isPast: false, slotEndedByHour: openHours, posts: [post('p3', 'News evening post', [news], { date: '2026-10-16', time: '18:00' })] },
];
const guardrails = { quietStartHour: 22, quietEndHour: 7, maxSendsPerDay: 2, sendsByDay: { '2026-10-15': 2 } };

const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });

async function render(view: 'month' | 'week' | 'list', locale: 'en' | 'fr' = 'en') {
  await act(async () => root.render(createElement(ContentProvider, { copy: resolveContentCopy(contentCopyDefaults as never, locale), policy: contentPolicyDefaults, locale },
    createElement(PublishingCopyProvider, { catalog: publishingCopyDefaults, locale, children: createElement(CalendarBoard, {
      view, days, timeZone: 'UTC', nowIso: '2026-10-14T09:00:00.000Z', canCreate: true, filterQuery: '', defaultScheduleTime: '09:00', guardrails,
    }) }))));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = close;
  container = document.createElement('div');
  document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('calendar wave 2: list, lanes and guardrails', () => {
  it('lists the week day by day with working drop targets', async () => {
    await render('list');
    const sections = [...container.querySelectorAll('section[aria-labelledby^="list-"]')];
    expect(sections.map(section => section.querySelector('h3')?.textContent)).toEqual(['Thursday, October 15Today', 'Friday, October 16']);
    expect(sections[0]!.textContent).toContain('Studio morning post');
    expect(sections[0]!.textContent).toContain('Joint noon post');
    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
    const drag = (type: string) => { const event = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: transfer }); return event; };
    await act(async () => container.querySelector('[draggable="true"]')!.dispatchEvent(drag('dragstart')));
    const over = drag('dragover');
    await act(async () => sections[1]!.dispatchEvent(over));
    expect(over.defaultPrevented).toBe(true);
  });
  it('groups the week into per-profile swimlanes without losing posts', async () => {
    await render('week');
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'By channel')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const heads = [...container.querySelectorAll('[class*="laneHead"]')];
    expect(heads.map(head => head.textContent)).toEqual(['News2 posts', 'Studio2 posts']);
    const joint = [...container.querySelectorAll('[class*="laneCell"]')].filter(cell => cell.textContent?.includes('Joint noon post'));
    expect(joint).toHaveLength(2);
    const studioOnly = [...container.querySelectorAll('[class*="laneCell"]')].filter(cell => cell.textContent?.includes('Studio morning post'));
    expect(studioOnly).toHaveLength(1);
  });
  it('shades quiet hours in the timeline and names them in the legend', async () => {
    await render('week');
    const slot = (label: string) => container.querySelector(`[role="group"][aria-label="Thursday, October 15, ${label}"]`)!;
    expect(slot('10 PM').getAttribute('data-quiet')).toBe('true');
    expect(slot('12 PM').hasAttribute('data-quiet')).toBe(false);
    expect(container.textContent).toContain('Shaded hours are autopilot quiet hours');
  });
  const timelineMoves = () => [...container.querySelectorAll('button')].filter(button => button.textContent?.startsWith('Move') && button.closest('[role="group"]'));
  it('warns about quiet hours and the daily cap in the move dialog without blocking', async () => {
    await render('week');
    await act(async () => timelineMoves()[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-labelledby]')!;
    const setInput = async (name: string, value: string) => {
      const input = dialog.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
      await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
    };
    await setInput('date', '2026-10-15');
    await setInput('time', '23:30');
    await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Review move')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(dialog.textContent).toContain('Quiet hours 22:00–07:00');
    // The moved post itself is one of the two sends on the 15th, so one slot is still free: no cap warning.
    expect(dialog.textContent).not.toContain('cap reached');
    const moveButton = [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Move post')!;
    expect(moveButton.hasAttribute('disabled')).toBe(false);
  });
  it('warns when the target day already reached the cap', async () => {
    await render('week');
    // p3 moves from the 16th to the 15th, which already holds two sends against a cap of two.
    await act(async () => timelineMoves()[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-labelledby]')!;
    const setInput = async (name: string, value: string) => {
      const input = dialog.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
      await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
    };
    await setInput('date', '2026-10-15');
    await setInput('time', '09:00');
    await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Review move')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(dialog.textContent).toContain('cap reached (2/2)');
  });
});

describe('calendar event preview', () => {
  it('links the preview dialog to the post detail page', async () => {
    const preview = { id: 'p9', authorId: 'user-1', message: 'Preview post', firstComment: null, link: null, media: [], status: 'scheduled', scheduledAt: new Date('2026-10-15T10:00:00Z'), publishedAt: null, createdAt: new Date('2026-10-14T10:00:00Z'), targets: [] };
    const previewDays: BoardDay[] = [{ ...days[0], posts: [{ ...post('p9', 'Preview post', [studio]), preview }] }];
    await act(async () => root.render(createElement(ContentProvider, { copy: resolveContentCopy(contentCopyDefaults as never, 'en'), policy: contentPolicyDefaults, locale: 'en' },
      createElement(PublishingCopyProvider, { catalog: publishingCopyDefaults, locale: 'en', children: createElement(CalendarBoard, {
        view: 'month', days: previewDays, timeZone: 'UTC', nowIso: '2026-10-14T09:00:00.000Z', canCreate: true, filterQuery: '', defaultScheduleTime: '09:00', guardrails,
      }) }))));
    const view = container.querySelector('button[aria-label="View post: Preview post"]') as HTMLButtonElement | null;
    expect(view).not.toBeNull();
    await act(async () => { view!.click(); });
    expect(container.querySelector('a[href="/content/post/p9"]')).not.toBeNull();
  });
});
