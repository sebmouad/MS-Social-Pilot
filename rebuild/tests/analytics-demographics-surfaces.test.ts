import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ read: vi.fn(), viewer: vi.fn(), language: 'en' }));
vi.mock('@/modules/analytics/server/copy', async () => {
  const c = await import('@/modules/analytics/copy');
  return { analyticsCopy: async () => ({ reports: c.reportCopyDefaults, goals: c.goalsCopyDefaults, downloads: c.downloadCopyDefaults, demographics: c.demographicsCopyDefaults, workspace: c.workspaceCopyDefaults, records: c.recordsCopyDefaults, errors: c.errorCopyDefaults }) };
});
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': state.language }) }));
vi.mock('@/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('@/modules/shell/server/scope', () => ({ pageChannelScope: async (_viewer: unknown, params: { channel?: string }) => ({ ids: params.channel ? params.channel.split(',') : [], dropped: 0, source: params.channel ? 'url' : 'none', channels: [] }) }));
vi.mock('@/modules/analytics/demographics/server/demographics', () => ({ readDemographics: state.read }));
vi.mock('@/modules/analytics/server/read', () => ({ readAnalyticsSnapshot: async () => ({ period: { start: '2026-10-01', end: '2026-10-02' }, options: { channels: [] } }) }));
vi.mock('@/server/PageFrame', () => ({ PageFrame: ({ children }: { children: ReactNode }) => createElement('main', null, children) }));
vi.mock('@/modules/analytics/ui/reports/WorkflowNav', () => ({ WorkflowNav: ({ children }: { children: ReactNode }) => children }));
import Page from '../src/modules/analytics/ui/demographics/DemographicsScreen';
import { GET } from '../src/app/api/analytics/demographics/route';
import { OperationError } from '../src/lib/operation-error';
const asOf = new Date('2026-10-01T00:00:00Z');
beforeEach(() => {
  vi.clearAllMocks(); state.language = 'en';
  state.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w' });
  state.read.mockResolvedValue({ csv: null, empty: false, period: { start: '2026-10-01', end: '2026-10-02' }, selected: { channelIds: ['a'] }, options: { channels: [{ id: 'a', name: 'Example channel' }] }, audience: { covered: 0, selected: 1, total: 0 }, other: [], groups: [{ metrics: [{ key: 'country', label: 'Country', sourceLabel: 'Stored audience', unit: 'count', historyCoverage: { covered: 1, selected: 1, oldestAsOf: asOf, newestAsOf: asOf }, history: [{ resourceId: 'a', resourceLabel: 'Example channel', asOf, fetchedAt: asOf, rows: [{ label: 'FR', value: null, share: null }] }] }] }] });
});
it('renders historical dates, unknowns and a scope-bound export in-page', async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('Audience history'); expect(html).toContain('2026-10-01 00:00:00 UTC');
  expect(html).toContain('Not available'); expect(html).not.toContain('>0<');
  expect(html).toContain('format=csv'); expect(html).toContain('channel=a'); expect(html).toContain('filter=1');
  expect(html).not.toContain('<aside');
});
it('renders French copy and retains invalid filters after read failure without exposing details', async () => {
  state.language = 'fr-FR'; state.read.mockRejectedValue(new Error('private database'));
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ start: 'bad-date', filter: '1', channel: 'gone' }) }));
  expect(html).toContain('Historique de l’audience'); expect(html).toContain('Impossible de charger');
  // The typed date stays for correction; the channel scope travels as a hidden field (the page has no channel boxes of its own).
  expect(html).toContain('value="bad-date"'); expect(html).toContain('<input type="hidden" name="channel" value="gone"/>'); expect(html).not.toContain('type="checkbox"'); expect(html).not.toContain('private database');
});
it.each(['en-US,en;q=0.9,fr;q=0.8', 'en,fr-FR;q=0.5'])('keeps the English heading when French is a fallback: %s', async language => {
  state.language = language;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('<h1>Audience history</h1>');
  expect(html).not.toContain('Historique de l’audience');
});
it('returns private HTTP JSON and CSV through the same service', async () => {
  const json = await GET(new Request('http://example.test/api/analytics/demographics?channel=a&channel=b&filter=1'));
  expect(json.status).toBe(200);
  expect(state.read).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' }, { filter: '1', channel: ['a', 'b'] });
  state.read.mockResolvedValueOnce({ csv: '"Category"\r\n"FR"\r\n' });
  const csv = await GET(new Request('http://example.test/api/analytics/demographics?format=csv'));
  expect(csv.headers.get('content-type')).toContain('text/csv'); expect(csv.headers.get('cache-control')).toBe('no-store');
  expect(csv.headers.get('content-disposition')).toContain('audience-history.csv'); expect(await csv.text()).toContain('FR');
});
it('denies anonymous HTTP and preserves service scope denial for CSV', async () => {
  state.viewer.mockRejectedValueOnce(new Error('no session'));
  expect((await GET(new Request('http://example.test/api/analytics/demographics?format=csv'))).status).toBe(401);
  expect(state.read).not.toHaveBeenCalled();
  state.read.mockRejectedValueOnce(new OperationError('forbidden', 'Unavailable selection.'));
  expect((await GET(new Request('http://example.test/api/analytics/demographics?format=csv'))).status).toBe(403);
});
