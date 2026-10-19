// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const navigation = vi.hoisted(() => ({refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>navigation}));
import { SidebarDockContext } from '../src/components/SidebarDock';
import { ReportsManager, type ReportUiLimits } from '../src/app/analytics/reports/ReportsManager';

const policy = {
  sectionOptions: [{ id: 'analysis', label: 'Analysis' }, { id: 'audience', label: 'Audience' }, { id: 'published', label: 'Published posts' }],
  sectionLabels: [{ id: 'analysis', label: 'Analysis' }, { id: 'goals', label: 'Goals' }, { id: 'audience', label: 'Audience' }, { id: 'published', label: 'Published posts' }],
  rangeOptions: [{ id: '30d', label: 'Past month' }, { id: '90d', label: 'Past quarter' }],
  frequencyOptions: [{ id: 'weekly', label: 'Every week' }, { id: 'monthly', label: 'Every month' }],
  defaultSections: ['analysis', 'audience'], defaultRange: '30d', defaultFrequency: 'weekly',
} as const;
const limits: ReportUiLimits = { nameMax: 90, maxRecipients: 12, maxRows: 5000, maxBytes: 500000 };
const template = { id: 'tpl-1', name: 'Weekly view', sections: ['analysis', 'goals'], rangeKey: '30d', scheduleCount: 1 };
const schedule = { id: 'sch-1', channelId: 'ch-1', channelName: 'North', templateId: 'tpl-1', templateName: 'Weekly view', frequency: 'weekly', recipientCount: 1, recipients: ['person@example.test'], nextRunAt: '2026-10-20T10:00:00Z', lastOutcome: 'never' };

let root: ReturnType<typeof createRoot>; let container: HTMLDivElement; let dock: HTMLDivElement;
beforeEach(() => {
  navigation.refresh.mockClear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); dock = document.createElement('div'); document.body.append(container, dock); root = createRoot(container);
  vi.stubGlobal('crypto', { randomUUID: () => '11111111-1111-4111-8111-111111111111' });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); dock.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const base = (overrides: Record<string, unknown> = {}) => ({
  templates: [], templateOptions: [], schedules: [], runs: [], canSchedule: true, canGenerate: true, canManage: true, channels: [{ id: 'ch-1', name: 'North' }],
  policy, limits, defaultPeriod: { start: '2026-10-01', end: '2026-10-30', maxDays: 90 }, timeZone: 'Africa/Casablanca', hasMoreTemplates: false, hasMoreSchedules: false, page: 1, runsPage: 1, runsHasMore: false,
  ...overrides,
});
async function render(props = base()) { await act(async () => root.render(createElement(SidebarDockContext.Provider, { value: dock }, createElement(ReportsManager, props as never)))); }
function button(label: string, scope: ParentNode = document) { const item = Array.from(scope.querySelectorAll('button')).find(node => node.textContent?.trim() === label); if (!item) throw new Error(`Missing button: ${label}`); return item as HTMLButtonElement; }
async function click(item: HTMLElement) { await act(async () => item.click()); }
async function enter(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
}

describe('Reports workflow UI', () => {
  it('keeps stored unsupported sections on template edits and uses Root labels for new choices', async () => {
    await render(base({ templates: [template] }));
    await click(button('Edit'));
    const dialog = container.querySelector('dialog')!;
    expect(dialog.textContent).toContain('Goals · kept from this template');
    expect(dialog.textContent).toContain('Past month');
    expect(dialog.textContent).toContain('Past quarter');
    const saved = dialog.querySelector<HTMLInputElement>('input[name="sections"]:disabled');
    expect(saved?.checked).toBe(true);
  });

  it('hides new email scheduling when mail is unavailable but leaves existing schedules manageable', async () => {
    await render(base({ canSchedule: false, schedules: [schedule] }));
    expect(Array.from(dock.querySelectorAll('button')).some(item => item.textContent?.trim() === 'New schedule')).toBe(false);
    expect(container.textContent).toContain('You can still review and edit saved schedules');
    expect(container.textContent).toContain('person@example.test');
    expect(button('Edit')).toBeTruthy();
    expect(button('Prepare now')).toBeTruthy();
  });

  it('submits a schedule update with internal confirmation and preserves recipients after an error', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: false, json: async () => ({ error: 'The schedule could not be saved.' }) }));
    vi.stubGlobal('fetch', fetcher);
    await render(base({ schedules: [schedule] })); await click(button('Edit'));
    const editor = container.querySelector<HTMLDialogElement>('dialog')!;
    const recipients = editor.querySelector<HTMLTextAreaElement>('textarea')!;
    await enter(recipients, 'new@example.test');
    await click(button('Save changes', editor));
    const review = Array.from(container.querySelectorAll<HTMLDialogElement>('dialog')).find(item => item.textContent?.includes('I understand the next report'))!;
    expect(review.textContent).not.toContain('UPDATE REPORT SCHEDULE');
    await click(review.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(button('Save changes', review).textContent).toBe('Save changes');
    await click(button('Save changes', review));
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/analytics/report-workflows/schedules');
    expect(body).toMatchObject({ action: 'update', id: 'sch-1', recipients: ['new@example.test'], confirmation: 'UPDATE REPORT SCHEDULE sch-1' });
    expect(review.querySelector('[role="alert"]')?.textContent).toContain('The schedule could not be saved.');
    await click(button('Cancel', review));
    await click(button('Edit'));
    expect(container.querySelector<HTMLTextAreaElement>('dialog textarea')?.value).toBe('new@example.test');
  });

  it('reuses the same request ID after an uncertain manual preparation result', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, filename: 'report-2026-10-01-2026-10-31', csv: 'a,b\n1,2', html: '<!doctype html><p>Report</p>', rowCount: 1, truncated: false, notIncluded: [] }) });
    vi.stubGlobal('fetch', fetcher);
    await render(base({ schedules: [schedule] }));
    await click(button('Prepare now'));
    await click(button('Prepare now'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(first.requestId).toBe('11111111-1111-4111-8111-111111111111');
    expect(second.requestId).toBe(first.requestId);
    expect(second.confirmation).toBe('GENERATE REPORT sch-1');
    expect(container.textContent).toContain('Report prepared. Download a CSV or printable page below. Nothing was emailed.');
  });

  it('prepares a channel report with an inclusive UTC range when email scheduling is unavailable', async () => {
    const csv = 'a,b\n1,2';
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, filename: 'report-2026-10-01-2026-10-30', csv, html: '<!doctype html><p>Report</p>', rowCount: 1, bytes: new TextEncoder().encode(csv).byteLength, truncated: false, notIncluded: [] }) });
    vi.stubGlobal('fetch', fetcher);
    await render(base({ canSchedule: false, schedules: [], templates: [template], templateOptions: [{ id: template.id, name: template.name }] }));
    await click(button('Prepare report', dock));
    const form = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(form.textContent).toContain('From (UTC)');
    expect(form.textContent).toContain('Through (UTC)');
    await act(async () => { const select = form.querySelector<HTMLSelectElement>('#report-manual-template')!; select.value = template.id; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await click(button('Review report', form));
    const review = Array.from(container.querySelectorAll<HTMLDialogElement>('dialog')).find(item => item.textContent?.includes('Nothing will be emailed'))!;
    await click(review.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    await click(button('Prepare report', review));
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ channelId: 'ch-1', templateId: template.id, start: '2026-10-01', end: '2026-10-30', requestId: '11111111-1111-4111-8111-111111111111', confirmation: 'GENERATE CHANNEL REPORT ch-1' });
    expect(container.textContent).toContain('Nothing was emailed.');
  });

  it('downloads CSV and printable HTML as named files without opening the HTML in the app', async () => {
    const csv = 'a,b\n1,2';
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:report');
    const downloads: string[] = [];
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, filename: 'report-2026-10-01-2026-10-30', csv, html: '<!doctype html><p>Printable</p>', rowCount: 1, bytes: new TextEncoder().encode(csv).byteLength, truncated: false, notIncluded: [] }) }));
    await render(); await click(button('Prepare report', dock));
    const form = container.querySelector<HTMLDialogElement>('dialog')!;
    await click(button('Review report', form));
    const review = Array.from(container.querySelectorAll<HTMLDialogElement>('dialog')).find(item => item.textContent?.includes('Nothing will be emailed'))!;
    await click(review.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    await click(button('Prepare report', review));
    await click(button('Download CSV'));
    await click(button('Download printable page'));
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect((createObjectURL.mock.calls[0]?.[0] as Blob).size).toBe(new TextEncoder().encode(csv).byteLength);
    expect((createObjectURL.mock.calls[0]?.[0] as Blob).type).toContain('text/csv');
    expect((createObjectURL.mock.calls[1]?.[0] as Blob).type).toContain('text/html');
    expect(downloads).toEqual(['report-2026-10-01-2026-10-30.csv', 'report-2026-10-01-2026-10-30.html']);
    expect(anchorClick).toHaveBeenCalledTimes(2);
  });

  it('keeps the same direct-generation ID after an unknown response and never displays protocol text', async () => {
    const csv = 'a,b\n1,2';
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, filename: 'report-2026-10-01-2026-10-30', csv, html: '<p>Report</p>', rowCount: 1, bytes: new TextEncoder().encode(csv).byteLength, truncated: false, notIncluded: [] }) });
    vi.stubGlobal('fetch', fetcher);
    await render(); await click(button('Prepare report', dock));
    const form = container.querySelector<HTMLDialogElement>('dialog')!;
    await click(button('Review report', form));
    const review = Array.from(container.querySelectorAll<HTMLDialogElement>('dialog')).find(item => item.textContent?.includes('Nothing will be emailed'))!;
    expect(review.textContent).not.toContain('GENERATE CHANNEL REPORT');
    await click(review.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    await click(button('Prepare report', review));
    expect(review.querySelector('[role="alert"]')?.textContent).toContain('result could not be confirmed');
    await click(button('Prepare report', review));
    const first = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(second.requestId).toBe(first.requestId);
    expect(second.confirmation).toBe('GENERATE CHANNEL REPORT ch-1');
  });

  it('keeps an unavailable channel and saved template understandable while editing an existing schedule', async () => {
    const unavailableSchedule = { ...schedule, channelName: 'North archive', templateId: 'removed-template', templateName: 'Quarterly archive' };
    await render(base({ channels: [], templateOptions: [], schedules: [unavailableSchedule] }));
    await click(button('Edit'));
    const editor = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(editor.querySelector<HTMLSelectElement>('#report-schedule-channel')?.selectedOptions[0]?.textContent).toContain('North archive (no longer available)');
    expect(editor.querySelector<HTMLSelectElement>('#report-schedule-template')?.selectedOptions[0]?.textContent).toContain('Quarterly archive (unavailable here; saved choice retained)');
    expect(container.textContent).toContain('Quarterly archive');
  });

  it('distinguishes an empty later page from an empty workspace',async()=>{await render(base({page:2,runsPage:2}));expect(container.textContent).toContain('No templates on this page');expect(container.textContent).toContain('No schedules on this page');expect(container.textContent).toContain('No runs on this page');expect(dock.textContent).toContain('Previous history page');});

  it('labels manual completion Prepared without claiming email delivery', async () => {
    await render(base({runs:[{id:'manual-1',channelId:'ch-1',kind:'manual',status:'completed',periodStart:'2026-10-01',periodEnd:'2026-10-30',startedAt:'2026-10-30T10:00:00Z',rowCount:2,truncated:false,note:null,deliveries:[]}]}));
    const row=container.querySelector('tbody tr')!;
    expect(row.textContent).toContain('Prepared');expect(row.textContent).toContain('Download prepared');expect(row.textContent).not.toContain('Completed');expect(row.textContent).not.toContain('sent');
  });

  it('reports completion separately from email delivery outcomes', async () => {
    await render(base({ runs: [{ id: 'run-1', channelId: 'ch-1', kind: 'scheduled', status: 'completed', periodStart: '2026-10-01', periodEnd: '2026-10-30', startedAt: '2026-10-30T10:00:00Z', rowCount: 2, truncated: false, note: null, deliveries: [{ mask: 'p***@example.test', status: 'sent' }] }] }));
    expect(container.textContent).toContain('Completed');
    expect(container.textContent).toContain('Scheduled email');
    expect(container.textContent).toContain('p***@example.test · sent');
  });

  it('does not reveal recipient addresses or write actions to a reader', async () => {
    await render(base({ canManage: false, schedules: [schedule] }));
    expect(container.textContent).not.toContain('person@example.test');
    expect(Array.from(container.querySelectorAll('button')).some(item => /^(Edit|Delete|Prepare now)$/.test(item.textContent?.trim() ?? ''))).toBe(false);
    expect(Array.from(dock.querySelectorAll('button')).some(item => /^(New template|New schedule)$/.test(item.textContent?.trim() ?? ''))).toBe(false);
  });
});
