import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ read: vi.fn(), viewer: vi.fn(), headers: vi.fn() }));
vi.mock('./service', () => ({ readAdObjects: m.read }));
vi.mock('@/server/context', () => ({ requireViewer: m.viewer }));
vi.mock('next/headers', () => ({ headers: m.headers }));
vi.mock('@/server/PageFrame', () => ({ PageFrame: ({ children, sidebar }: { children: React.ReactNode; sidebar: React.ReactNode }) => <main>{sidebar}{children}</main> }));
vi.mock('@/server/mcp/kit', () => ({ analyticsActorFor: (v: Record<string, unknown>, cap: number) => ({ userId: v.userId, workspaceId: v.workspaceId, allowedAdAccountIds: v.allowedAdAccountIds, adAccountTargetScope: v.adAccountTargetScope, maxResultItems: cap }) }));
import Screen from './Screen';
import { GET } from '@/app/api/analytics/ad-objects/route';
import { adObjectsMcp } from './mcp';
import { OperationError } from '@/lib/operation-error';
const data = () => ({ input: { level: 'campaign', page: 1 }, period: { start: '2026-10-01', end: '2026-10-03' }, options: [{ id: 'a', name: 'Account' }], items: [{ key: 'key', accountId: 'a', accountName: 'Account', objectId: 'c', name: 'Campaign', currency: null, spend: null, impressions: 0, clicks: 2, reach: 20, reachDate: '2026-10-01', cpc: null, cpm: null, ctr: 2, coveredDays: 1, requestedDays: 3, lastFetchedAt: null, daily: [] }], coverage: { selectedAccounts: 1, coveredAccounts: 1, unknownParentObjects: 0 }, page: 1, nextPage: null, total: 1, csv: null });
beforeEach(() => { vi.clearAllMocks(); m.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w' }); m.headers.mockResolvedValue(new Headers()); m.read.mockResolvedValue(data()); });
it('HTTP returns the shared read and CSV, masks storage errors and preserves typed denials', async () => {
  const response = await GET(new Request('https://example.test/api/analytics/ad-objects?accountId=a'));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ total: 1 }); expect(m.read).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' }, { accountId: 'a' });
  m.read.mockResolvedValueOnce({ ...data(), csv: 'Dépenses' });
  const csv = await GET(new Request('https://example.test/api/analytics/ad-objects?format=csv', { headers: { 'accept-language': 'fr' } }));
  expect(csv.headers.get('content-type')).toContain('text/csv'); expect(await csv.text()).toBe('Dépenses');
  m.read.mockRejectedValueOnce(new OperationError('forbidden', 'Denied')); expect((await GET(new Request('https://example.test/api/analytics/ad-objects'))).status).toBe(403);
  m.read.mockRejectedValueOnce(new Error('private database detail')); const error = await GET(new Request('https://example.test/api/analytics/ad-objects')); expect(await error.text()).not.toContain('private database');
});
it('MCP uses the same service with credential ceilings and a bounded export', async () => {
  await adObjectsMcp.execute!({ userId: 'u', workspaceId: 'w', allowedAdAccountIds: [], adAccountTargetScope: { all: false, ids: ['t'] } } as never, 'get_analytics_ad_objects', { level: 'adset' }, 7);
  expect(m.read).toHaveBeenCalledWith(expect.objectContaining({ allowedAdAccountIds: [], adAccountTargetScope: { all: false, ids: ['t'] }, maxResultItems: 7 }), { level: 'adset' });
});
it('renders bilingual coverage, unknown values, sidebar filters, CSV and account-bound drill-down', async () => {
  const html = renderToStaticMarkup(await Screen({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('Not available'); expect(html).toContain('1 / 3'); expect(html).toContain('format=csv'); expect(html).toContain('level=adset'); expect(html).toContain('parentId=c'); expect(html).toContain('accountId=a'); expect(html).toContain('snapshot');
  m.headers.mockResolvedValueOnce(new Headers({ 'accept-language': 'fr' }));
  const french = renderToStaticMarkup(await Screen({ searchParams: Promise.resolve({}) })); expect(french).toContain('Non disponible'); expect(french).toContain('Campagnes');
});
it('preserves submitted filter context on safe recovery and has a deliberate empty state', async () => {
  m.read.mockRejectedValueOnce(new Error('secret'));
  const failure = renderToStaticMarkup(await Screen({ searchParams: Promise.resolve({ start: 'bad-date' }) }));
  expect(failure).toContain('bad-date'); expect(failure).not.toContain('secret'); expect(failure).toContain('role="alert"');
  m.read.mockResolvedValueOnce({ ...data(), items: [] }); const empty = renderToStaticMarkup(await Screen({ searchParams: Promise.resolve({}) })); expect(empty).toContain('No stored objects');
});
it('HTTP turns session redirects into explicit authentication responses', async () => {
  const redirect = (url: string) => Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  m.viewer.mockRejectedValueOnce(redirect('/sign-in'));
  expect((await GET(new Request('https://example.test/api/analytics/ad-objects'))).status).toBe(401);
  m.viewer.mockRejectedValueOnce(redirect('/access-limited'));
  expect((await GET(new Request('https://example.test/api/analytics/ad-objects'))).status).toBe(403);
  expect(m.read).not.toHaveBeenCalled();
});
