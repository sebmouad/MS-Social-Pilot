import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
const h = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, refresh: vi.fn(), replace: vi.fn(), confirm: vi.fn(async () => true) }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useCallback: (fn: unknown) => fn, useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = initial; return [h.state[i], (value: unknown) => { h.state[i] = value; }]; } }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useRouter: () => h, usePathname: () => '/reports', useSearchParams: () => new URLSearchParams('pages=page-a') }));
vi.mock('../src/components/ConfirmProvider', () => ({ useConfirm: () => h.confirm }));
import { ReportBuilder } from '../src/components/ReportBuilder';
import { ReportControls } from '../src/components/ReportControls';
import { ReportSchedules } from '../src/components/ReportSchedules';
function elements(node: unknown): ReactElement<Record<string, any>>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const el = node as ReactElement<Record<string, any>>;
  return [el, ...elements(el.props?.children), ...elements(el.props?.footer)];
}
function render(fn: () => unknown) { h.cursor = 0; return elements(fn()); }
beforeEach(() => { h.state = []; vi.clearAllMocks(); });
it('Cancel and reopening restore committed branding and sections, including new props', () => {
  let branding = { logoUrl: '', reportTitle: 'Saved', reportSubtitle: '', reportFooter: '' };
  const draw = () => render(() => ReportBuilder({ sections: ['analysis'], branding, canBrand: true }));
  draw().find(e => e.type === 'button')!.props.onClick();
  draw().find(e => e.props.id === 'report-reportTitle')!.props.onChange({ target: { value: 'Unsaved' } });
  draw().find(e => e.props.type === 'checkbox')!.props.onChange();
  draw().find(e => e.type === 'button' && e.props.children === 'cancel')!.props.onClick();
  branding = { ...branding, reportTitle: 'Latest saved' };
  draw().find(e => e.type === 'button')!.props.onClick();
  expect(draw().find(e => e.props.id === 'report-reportTitle')!.props.value).toBe('Latest saved');
  expect(draw().find(e => e.props.type === 'checkbox')!.props.checked).toBe(true);
});
it('CSV carries the applied explicit channel scope and dates', () => {
  const tree = render(() => ReportControls({ from: '2026-10-01', to: '2026-10-12', targetIds: ['page-a'] } as Parameters<typeof ReportControls>[0]));
  const query = new URL(tree.find(e => e.type === 'a')!.props.href, 'https://example.test').searchParams;
  expect(query.get('pages')).toBe('page-a');
  expect(query.get('from')).toBe('2026-10-01');
});
it('schedule deletion reports refusal and does not refresh as if successful', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Cannot remove schedule' }), { status: 403 })));
  const schedules = [{ id: 'row', frequency: 'weekly' as const, recipients: ['a@example.test'], nextLabel: 'Next', lastLabel: null, lastError: null, aiRecap: false }];
  const draw = () => render(() => ReportSchedules({ targetId: 'page', pageName: 'Page', schedules, templateId: null, aiOn: false, emailOn: true } as Parameters<typeof ReportSchedules>[0]));
  await draw().find(e => e.props['aria-label'] === 'scheduleDelete')!.props.onClick();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(draw().find(e => e.props.role === 'alert')!.props.children).toBe('Cannot remove schedule');
  expect(h.refresh).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
it('offers an explanation and disables creation when email is unavailable', () => {
  const tree = render(() => ReportSchedules({ targetId: 'page', pageName: 'Page', schedules: [], templateId: null, aiOn: false, emailOn: false }));
  expect(tree.find(e => e.type === 'button' && e.props.children === 'scheduleCreate')!.props.disabled).toBe(true);
  expect(tree.find(e => e.type === 'p' && e.props.children === 'scheduleEmailUnavailable')).toBeDefined();
});
it('Apply saves branding and preserves channel context when changing report sections', async () => {
  const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const draw = () => render(() => ReportBuilder({ sections: ['analysis'], branding: { logoUrl: '', reportTitle: 'Saved', reportSubtitle: '', reportFooter: '' }, canBrand: true }));
  draw().find(e => e.type === 'button')!.props.onClick();
  draw().find(e => e.props.id === 'report-reportTitle')!.props.onChange({ target: { value: 'Applied' } });
  await draw().find(e => e.type === 'button' && e.props.children === 'applyChanges')!.props.onClick();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(fetch).toHaveBeenCalledWith('/api/workspace', expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('Applied') }));
  expect(h.replace).toHaveBeenCalledWith('/reports?pages=page-a&sections=analysis', { scroll: false });
  expect(h.refresh).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
