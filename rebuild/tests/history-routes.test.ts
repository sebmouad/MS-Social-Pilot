import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(), root: vi.fn(), health: vi.fn(), report: vi.fn(), policy: vi.fn(), activity: vi.fn(), emails: vi.fn(), addEntry: vi.fn(), removeEntry: vi.fn(), listEntries: vi.fn(),
}));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: mocks.root }));
vi.mock('../src/server/request-origin', () => ({ requestOrigin: () => 'https://app.test' }));
vi.mock('../src/modules/history/server/health', () => ({ readSystemHealth: mocks.health }));
vi.mock('../src/server/errors/client-report', () => ({ reportClientError: mocks.report }));
vi.mock('../src/server/errors/recorder', () => ({ loadErrorsPolicy: mocks.policy }));
vi.mock('../src/modules/history/server/history', () => ({ listWorkspaceActivity: mocks.activity, listWorkspaceEmails: mocks.emails }));
vi.mock('../src/modules/history/server/changelog', () => ({ addRootChangelogEntry: mocks.addEntry, removeRootChangelogEntry: mocks.removeEntry, listRootChangelog: mocks.listEntries }));

import { GET as health } from '../src/app/api/health/route';
import { POST as reportError } from '../src/app/api/errors/route';
import { GET as activity } from '../src/app/api/settings/history/activity/route';
import { GET as emails } from '../src/app/api/settings/history/email/route';
import { GET as listChangelog, POST as addChangelog } from '../src/app/api/root/changelog/route';
import { DELETE as removeChangelog } from '../src/app/api/root/changelog/[id]/route';
import { RichBody } from '../src/modules/history/ui/public-pages';

const post = (url: string, body: unknown, origin: string | null = 'https://app.test') => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue({ user: { id: 'u1' }, workspaceId: 'w1' });
  mocks.root.mockResolvedValue({ id: 'root', isInstanceOwner: true });
  mocks.policy.mockResolvedValue({ 'errors.clientReportMaxBytes': 200 });
  mocks.report.mockResolvedValue({ recorded: true });
  mocks.activity.mockResolvedValue({ items: [] }); mocks.emails.mockResolvedValue({ items: [] });
  mocks.addEntry.mockResolvedValue({ entry: { id: 'c1' } }); mocks.removeEntry.mockResolvedValue({ removed: true }); mocks.listEntries.mockResolvedValue({ items: [] });
});

describe('GET /api/health', () => {
  it('answers 200 with only status and worker, and 503 without detail when the database is down', async () => {
    mocks.health.mockResolvedValueOnce({ database: true, worker: { status: 'ok', lastBeatSeconds: 4 } });
    const ok = await health();
    expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ status: 'ok', worker: { status: 'ok', lastBeatSeconds: 4 } });
    mocks.health.mockResolvedValueOnce({ database: false, worker: { status: 'unknown', lastBeatSeconds: null } });
    const down = await health();
    expect(down.status).toBe(503); expect(await down.json()).toEqual({ status: 'unavailable' });
  });
});

describe('POST /api/errors', () => {
  const url = 'https://app.test/api/errors';
  it('refuses cross-origin and anonymous callers before reading the body', async () => {
    expect((await reportError(post(url, { message: 'x' }, 'https://evil.test'))).status).toBe(403);
    expect((await reportError(post(url, { message: 'x' }, null))).status).toBe(403);
    mocks.root.mockResolvedValueOnce(null);
    expect((await reportError(post(url, { message: 'x' }))).status).toBe(401);
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('passes a valid report to the service as the signed-in person', async () => {
    const response = await reportError(post(url, { message: 'x' }));
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.report).toHaveBeenCalledWith({ userId: 'root' }, { message: 'x' });
  });
  it('refuses oversize and malformed bodies and reports an ignored one as not recorded', async () => {
    expect((await reportError(post(url, { message: 'x'.repeat(500) }))).status).toBe(400);
    expect((await reportError(post(url, '{not json'))).status).toBe(400);
    mocks.report.mockResolvedValueOnce({ recorded: false, reason: 'rate_limited' });
    expect(await (await reportError(post(url, { message: 'x' }))).json()).toEqual({ ok: false, reason: 'rate_limited' });
  });
});

describe('GET /api/settings/history/*', () => {
  it('maps a refused session or role to 401/403 and never calls the service without a session', async () => {
    mocks.viewer.mockRejectedValueOnce(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/sign-in;307;' }));
    expect((await activity(new Request('https://app.test/api/settings/history/activity'))).status).toBe(401);
    mocks.viewer.mockRejectedValueOnce(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/access-limited;307;' }));
    expect((await emails(new Request('https://app.test/api/settings/history/email'))).status).toBe(403);
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it('passes the viewer workspace and strict filters; unknown or repeated parameters are 400', async () => {
    const response = await activity(new Request('https://app.test/api/settings/history/activity?q=task&offset=5'));
    expect(response.status).toBe(200);
    expect(mocks.activity).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, { q: 'task', offset: 5 });
    expect((await activity(new Request('https://app.test/api/settings/history/activity?workspaceId=w2'))).status).toBe(400);
    expect((await emails(new Request('https://app.test/api/settings/history/email?problemsOnly=maybe'))).status).toBe(400);
    expect((await emails(new Request('https://app.test/api/settings/history/email?q=a&q=b'))).status).toBe(400);
    await emails(new Request('https://app.test/api/settings/history/email?problemsOnly=true'));
    expect(mocks.emails).toHaveBeenLastCalledWith({ userId: 'u1', workspaceId: 'w1' }, { problemsOnly: true });
  });
});

describe('/api/root/changelog (installation owner only)', () => {
  const context = { params: Promise.resolve({ id: 'c1' }) };
  it('hides the route from members and anonymous callers', async () => {
    mocks.root.mockResolvedValue({ id: 'member', isInstanceOwner: false });
    expect((await listChangelog(new Request('https://app.test/api/root/changelog'), undefined)).status).toBe(404);
    expect((await addChangelog(post('https://app.test/api/root/changelog', {}), undefined)).status).toBe(404);
    mocks.root.mockResolvedValue(null);
    expect((await listChangelog(new Request('https://app.test/api/root/changelog'), undefined)).status).toBe(401);
    expect(mocks.addEntry).not.toHaveBeenCalled();
  });
  it('refuses cross-origin writes and sends the exact body to the service for Root', async () => {
    expect((await addChangelog(post('https://app.test/api/root/changelog', {}, 'https://evil.test'), undefined)).status).toBe(403);
    const body = { publishedOn: '2026-10-21', title: 'A', confirmation: 'ADD CHANGELOG ENTRY A' };
    expect((await addChangelog(post('https://app.test/api/root/changelog', body), undefined)).status).toBe(200);
    expect(mocks.addEntry).toHaveBeenCalledWith('root', body);
    const removal = new Request('https://app.test/api/root/changelog/c1', { method: 'DELETE', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'REMOVE CHANGELOG ENTRY c1' }) });
    expect((await removeChangelog(removal, context)).status).toBe(200);
    expect(mocks.removeEntry).toHaveBeenCalledWith('root', 'c1', 'REMOVE CHANGELOG ENTRY c1');
  });
});

describe('RichBody', () => {
  it('renders Root text as escaped text, lists and safe links only', () => {
    const html = renderToStaticMarkup(createElement(RichBody, { body: 'Hello <script>x</script> [go](/help) [bad](javascript:alert(1))\n\n- one\n- two' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<a href="/help">go</a>');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
  });
});
