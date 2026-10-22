// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
const m = vi.hoisted(() => ({ action: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock('@/modules/calendar-extras/ui/actions', () => ({ calendarAction: m.action }));
import { CalendarWorkspace, type WorkspaceProps } from '@/modules/calendar-extras/ui/CalendarWorkspace';
import { TrendPanels } from '@/modules/calendar-extras/ui/TrendPanels';
import { buildNotesTimeSeriesModel } from '@/modules/calendar-extras/ui/NotesTimeSeriesChart';
import { copy } from '@/modules/calendar-extras/copy';
import { policyDefaults } from '@/modules/calendar-extras/config';
import type { ChartEnv } from '@/components/charts/theme';
const props: WorkspaceProps = { area: 'dates', workspaceId: 'w1', locale: 'en', policy: policyDefaults, copy: copy.en, channels: [{ id: 't1', name: 'Studio journal' }], allChannels: true, canWrite: true, rows: [{ id: 'd1', date: '2026-11-10', title: 'Winter launch', yearly: true, targetIds: ['t1'] }], offset: 0, limit: 40, hasMore: false, from: '2026-11-01', to: '2026-11-30', targetId: '' };
beforeEach(() => { vi.clearAllMocks(); document.body.innerHTML = ''; Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } }); Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } }); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
it('renders the agenda and explicit read-only French state without write controls', () => {
 const html = renderToStaticMarkup(createElement(CalendarWorkspace, { ...props, locale: 'fr', copy: copy.fr, canWrite: false }));
 expect(html).toContain('Dates clés'); expect(html).toContain('Winter launch'); expect(html).toContain('Répéter chaque année'); expect(html).toContain(copy.fr.readOnly); expect(html).not.toContain('aria-label="Supprimer:');
});
it('keeps values and the exact confirmation visible after a recoverable failed save', async () => {
 const host = document.createElement('div'); document.body.append(host); const root: Root = createRoot(host);
 m.action.mockResolvedValue({ ok: false, error: copy.en.invalid, uncertain: false });
 await act(async () => root.render(createElement(CalendarWorkspace, props)));
 await act(async () => (Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Add') as HTMLButtonElement).click());
 const form = document.querySelector('form[id]') as HTMLFormElement;
 expect(form).not.toBeNull();
 const title = form.elements.namedItem('title') as HTMLInputElement; title.value = 'Winter sale';
 const confirmation = form.elements.namedItem('confirmation') as HTMLInputElement; confirmation.value = 'CREATE CALENDAR DATES w1';
 await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
 expect(m.action).toHaveBeenCalledWith('dates', expect.objectContaining({ confirmation: 'CREATE CALENDAR DATES w1', data: expect.objectContaining({ title: 'Winter sale' }) }));
 expect(title.value).toBe('Winter sale'); expect(confirmation.value).toBe('CREATE CALENDAR DATES w1'); expect(document.body.textContent).toContain(copy.en.invalid);
 await act(async () => root.unmount());
});
it('blocks another creation after an unconfirmed transport result', async () => {
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
 m.action.mockRejectedValue(new Error('transport'));
 await act(async () => root.render(createElement(CalendarWorkspace, props)));
 await act(async () => (Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Add') as HTMLButtonElement).click());
 const form = document.querySelector('form[id]') as HTMLFormElement;
 (form.elements.namedItem('title') as HTMLInputElement).value = 'Winter sale';
 (form.elements.namedItem('confirmation') as HTMLInputElement).value = 'CREATE CALENDAR DATES w1';
 await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
 await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
 expect(m.action).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain(copy.en.failure);
 await act(async () => root.unmount());
});
it('makes chart notes available as dated marks and an accessible table column', () => {
 const model = buildNotesTimeSeriesModel({ label: 'Reach', locale: 'en', timeZone: 'UTC', series: [{ id: 'reach', name: 'Reach', points: [{ t: '2026-11-10T00:00:00Z', v: 24 }] }], notes: [{ id: 'n1', label: 'Campaign began', day: '2026-11-10', targetId: null, color: 'blue' }], noteColors: policyDefaults.colors, copy: copy.en });
 expect(model.table.columns.at(-1)).toBe(copy.en.notesCaption); expect(model.table.rows[0].at(-1)).toBe('Campaign began');
 const option = model.option({ theme: { palette: ['blue'], text: 'black', surface: 'white' }, reducedMotion: true } as unknown as ChartEnv);
 expect(JSON.stringify(option.series)).toContain('Campaign began');
});
it('retains French empty holiday and trend frames and never renders unsafe news links', () => {
 const html = renderToStaticMarkup(createElement(TrendPanels, { data: { countries: ['FR'], keywords: [], holidays: [], items: [{ id: 't', title: 'Cuisine', country: 'FR', traffic: null, newsTitle: 'Recipe news', newsUrl: 'javascript:alert(1)', fetchedAt: new Date(), startedAt: null }], coverage: [] }, copy: copy.fr, locale: 'fr', workspaceId: 'w1', canWrite: false }));
 expect(html).toContain(copy.fr.holidays); expect(html).toContain(copy.fr.noMatches); expect(html).toContain('Recipe news'); expect(html).not.toContain('href="javascript:');
});
