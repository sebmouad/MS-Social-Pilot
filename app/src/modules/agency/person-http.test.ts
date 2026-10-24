import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ cookies: vi.fn(), session: vi.fn(), list: vi.fn(), issue: vi.fn(), revoke: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: m.cookies }));
vi.mock('@/server/data', () => ({ getSessionByTokenHash: m.session }));
vi.mock('@/modules/settings/person-keys/service', () => ({ listPersonKeys: m.list, issuePersonKey: m.issue, revokePersonKey: m.revoke }));
import { GET, POST, DELETE } from '@/app/api/settings/account/person-keys/route';
const token = Buffer.alloc(32, 3).toString('base64url');
const session = { userId: 'person', expiresAt: new Date(Date.now() + 60000), pending: null, user: { id: 'person', disabledAt: null } };
const request = (method = 'POST', extra: Record<string, string> = {}, body = '{}', suffix = '') => new Request(`http://app.test/api/settings/account/person-keys${suffix}`, { method, headers: { origin: 'http://app.test', 'content-type': 'application/json', ...extra }, ...(method === 'GET' ? {} : { body }) });
beforeEach(() => {
 vi.clearAllMocks(); m.cookies.mockResolvedValue({ get: () => ({ value: token }) }); m.session.mockResolvedValue(session);
 m.list.mockResolvedValue({ keys: [] }); m.issue.mockResolvedValue({ token: 'shown-once' }); m.revoke.mockResolvedValue({ revoked: true });
});
it('uses only the current browser person for list, issue and revoke; no-store throughout', async () => {
 for (const [method, fn, service] of [['GET', GET, m.list], ['POST', POST, m.issue], ['DELETE', DELETE, m.revoke]] as const) {
  const response = await fn(request(method)); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(service.mock.calls[0][0]).toEqual({ userId: 'person' });
 }
});
it.each(['authorization', 'x-api-key'])('refuses %s even with a valid cookie', async header => {
 for (const fn of [GET, POST, DELETE]) expect((await fn(request('POST', { [header]: 'anything' }))).status).toBe(401);
 expect(m.cookies).not.toHaveBeenCalled(); expect(m.issue).not.toHaveBeenCalled();
});
it.each(['', 'http://other.test'])('refuses missing/foreign origin %s before session lookup', async origin => {
 for (const fn of [POST, DELETE]) expect((await fn(request('POST', { origin }))).status).toBe(403);
 expect(m.cookies).not.toHaveBeenCalled();
});
it('refuses query scope, non-JSON and malformed JSON', async () => {
 expect((await GET(request('GET', {}, '', '?userId=foreign'))).status).toBe(400);
 expect((await POST(request('POST', { 'content-type': 'text/plain' }))).status).toBe(400);
 expect((await POST(request('POST', {}, '{'))).status).toBe(400); expect(m.issue).not.toHaveBeenCalled();
});
it.each([null, { ...session, pending: 'verify' }, { ...session, expiresAt: new Date(0) }, { ...session, user: { disabledAt: new Date() } }])('refuses unusable sessions %j', async value => {
 m.session.mockResolvedValue(value); expect((await POST(request())).status).toBe(401); expect(m.issue).not.toHaveBeenCalled();
});
it('refuses absent cookies and safely localizes service failures', async () => {
 m.cookies.mockResolvedValueOnce({ get: () => undefined }); expect((await POST(request())).status).toBe(401); expect(m.session).not.toHaveBeenCalled();
 m.issue.mockRejectedValueOnce(new Error('private SQL and credentials'));
 const response = await POST(request('POST', { 'accept-language': 'fr-FR' })); expect(response.status).toBe(502);
 const result = await response.json(); expect(result.error).toContain('Impossible'); expect(JSON.stringify(result)).not.toContain('private');
});
