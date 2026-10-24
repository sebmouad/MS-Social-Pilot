import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), user: vi.fn(), config: vi.fn(), access: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: m.query, $executeRaw: m.execute, user: { findUnique: m.user }, $transaction: async (run: (tx: unknown) => unknown) => run({ $queryRaw: m.query, $executeRaw: m.execute }) } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('./server/access', () => ({ assertAgencyOverviewCredentialAccess: m.access }));
import { authenticatePersonBearer, issuePersonKey, listPersonKeys, revokePersonKey, assertPersonCredential } from '@/modules/settings/person-keys/service';
const input = { name: 'Desk', expiresInDays: 30, confirmation: 'CREATE AGENCY KEY Desk 30 DAYS' };
const identity = { scope: 'person' as const, userId: 'u', personKeyId: 'pk', readFeature: 'agency/overview' as const };
beforeEach(() => {
 vi.clearAllMocks();
 m.config.mockImplementation(async (key: string) => ({ 'mcp.enabled': true, 'mcp.personKeys.enabled': true, 'mcp.personKeys.maxActivePerPerson': 3, 'mcp.personKeys.maxLifetimeDays': 90, 'mcp.personKeys.nameMaxLength': 100, 'mcp.keys.transactionTimeoutMs': 15000, 'mcp.keys.transactionMaxWaitMs': 2000 }[key]));
 m.user.mockResolvedValue({ id: 'u', disabledAt: null }); m.access.mockResolvedValue(undefined); m.execute.mockResolvedValue(1);
 m.query.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('COUNT(*)') ? [{ count: BigInt(0) }] : [{ id: 'pk', userId: 'u', readFeature: 'agency/overview', disabledAt: null }]);
});
it('issues a separate one-time secret with hash-only storage and atomic audit', async () => {
 const result = await issuePersonKey({ userId: 'u' }, input);
 expect(result.token).toMatch(/^mcp_person_[A-Za-z0-9_-]{43}$/);
 expect(m.execute.mock.calls[0][0].join('')).toContain('INSERT INTO person_mcp_keys');
 expect(m.execute.mock.calls.flat().flat()).not.toContain(result.token);
 expect(m.execute.mock.calls[1][0].join('')).toContain('root_activities');
 expect(JSON.stringify(m.execute.mock.calls[1])).not.toContain(result.token);
});
it.each([{}, { ...input, confirmation: 'CREATE AGENCY KEY Desk' }, { ...input, expiresInDays: 0 }, { ...input, expiresInDays: 91 }, { ...input, name: 'x'.repeat(101) }, { ...input, workspaceId: 'w' }, { ...input, writeFeatures: ['publishing/posts'] }, { ...input, readFeature: 'agency/clients' }])('refuses invalid issuance %j', async value => {
 await expect(issuePersonKey({ userId: 'u' }, value)).rejects.toMatchObject({ code: 'invalid_request' }); expect(m.execute).not.toHaveBeenCalled();
});
it.each([null, { id: 'u', disabledAt: new Date() }])('refuses missing/disabled people for issue, list and revoke', async user => {
 m.user.mockResolvedValue(user);
 for (const run of [() => issuePersonKey({ userId: 'u' }, input), () => listPersonKeys({ userId: 'u' }), () => revokePersonKey({ userId: 'u' }, { id: 'pk', confirmation: 'REVOKE AGENCY KEY pk' })]) await expect(run()).rejects.toMatchObject({ code: 'forbidden' });
});
it.each(['mcp.enabled', 'mcp.personKeys.enabled'])('blocks issue/auth with %s off but permits revocation', async key => {
 const original = m.config.getMockImplementation()!; m.config.mockImplementation(async k => k === key ? false : original(k));
 await expect(issuePersonKey({ userId: 'u' }, input)).rejects.toMatchObject({ code: 'forbidden' });
 expect(await authenticatePersonBearer(`Bearer mcp_person_${'a'.repeat(43)}`)).toBeNull();
 await expect(revokePersonKey({ userId: 'u' }, { id: 'pk', confirmation: 'REVOKE AGENCY KEY pk' })).resolves.toEqual({ revoked: true });
});
it('refuses broken policy and absent current Agency authority', async () => {
 m.access.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'forbidden' }));
 await expect(issuePersonKey({ userId: 'u' }, input)).rejects.toMatchObject({ code: 'forbidden' });
 m.config.mockResolvedValue(undefined); await expect(issuePersonKey({ userId: 'u' }, input)).rejects.toMatchObject({ code: 'unavailable' });
});
it('refuses the active ceiling and a user lost before transaction entry', async () => {
 m.query.mockResolvedValueOnce([]); await expect(issuePersonKey({ userId: 'u' }, input)).rejects.toMatchObject({ code: 'forbidden' });
 m.query.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('COUNT(*)') ? [{ count: BigInt(3) }] : [{ id: 'u' }]);
 await expect(issuePersonKey({ userId: 'u' }, input)).rejects.toMatchObject({ code: 'conflict' });
});
it.each([{}, { id: 'pk', confirmation: 'REVOKE AGENCY KEY other' }, { id: 'pk', confirmation: 'REVOKE AGENCY KEY pk', userId: 'other' }])('refuses malformed revocations %j', async value => {
 await expect(revokePersonKey({ userId: 'u' }, value)).rejects.toMatchObject({ code: 'invalid_request' }); expect(m.execute).not.toHaveBeenCalled();
});
it('refuses foreign, revoked or absent keys without auditing a non-change', async () => {
 m.execute.mockResolvedValueOnce(0);
 await expect(revokePersonKey({ userId: 'u' }, { id: 'foreign', confirmation: 'REVOKE AGENCY KEY foreign' })).rejects.toMatchObject({ code: 'not_found' });
 expect(m.execute).toHaveBeenCalledTimes(1); expect(m.execute.mock.calls[0][0].join('')).toContain('"userId"=');
});
it('fails closed on failed insert or audit', async () => {
 m.execute.mockResolvedValueOnce(0); await expect(issuePersonKey({ userId: 'u' }, input)).rejects.toMatchObject({ code: 'unavailable' });
 m.execute.mockResolvedValueOnce(1).mockResolvedValueOnce(0); await expect(issuePersonKey({ userId: 'u' }, input)).rejects.toMatchObject({ code: 'unavailable' });
});
it('authenticates only person tokens and rechecks stored capability, expiry, revocation and account', async () => {
 for (const token of [null, 'Bearer mcp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Bearer invalid', `Bearer mcp_person_${'a'.repeat(44)}`]) expect(await authenticatePersonBearer(token)).toBeNull();
 expect(m.query).not.toHaveBeenCalled();
 expect(await authenticatePersonBearer(`Bearer mcp_person_${'a'.repeat(43)}`)).toEqual(identity);
 expect(m.query.mock.calls[0][0].join('')).toContain('"expiresAt">NOW()');
 for (const row of [[], [{ id: 'pk', userId: 'u', readFeature: 'agency/clients' }], [{ id: 'pk', userId: 'u', readFeature: 'agency/overview', disabledAt: new Date() }]]) {
  m.query.mockResolvedValueOnce(row); expect(await authenticatePersonBearer(`Bearer mcp_person_${'a'.repeat(43)}`)).toBeNull();
 }
 m.query.mockResolvedValueOnce([]); await expect(assertPersonCredential(identity)).rejects.toMatchObject({ code: 'forbidden' });
});
it.each(['apiKeyId', 'workspaceId', 'workspace', 'permissions', 'isInstanceOwner'])('rejects a person principal carrying %s', async field => {
 await expect(assertPersonCredential({ ...identity, [field]: 'injected' })).rejects.toMatchObject({ code: 'forbidden' }); expect(m.query).not.toHaveBeenCalled();
});
it('refuses an expanded principal capability and unavailable stored capability at dispatch', async () => {
 await expect(assertPersonCredential({ ...identity, readFeature: 'agency/clients' } as unknown as typeof identity)).rejects.toMatchObject({ code: 'forbidden' });
 m.query.mockResolvedValueOnce([{ id: 'pk', userId: 'u', readFeature: 'agency/clients', disabledAt: null }]);
 await expect(assertPersonCredential(identity)).rejects.toMatchObject({ code: 'forbidden' });
});
it('lists only bounded active metadata and can revoke without any remaining Agency workspace', async () => {
 const key = { id: 'pk', name: 'Desk', tokenPrefix: 'mcp_person_abc', expiresAt: new Date(), createdAt: new Date() };
 m.query.mockResolvedValueOnce([key, key, key, key]);
 const result = await listPersonKeys({ userId: 'u' }); expect(result.keys).toHaveLength(3); expect(result.truncated).toBe(true);
 const sql = m.query.mock.calls[0][0].join(''); expect(sql).not.toContain('tokenHash'); expect(sql).toContain('"userId"='); expect(sql).toContain('"revokedAt" IS NULL');
 m.access.mockRejectedValue(new Error('no memberships'));
 await expect(revokePersonKey({ userId: 'u' }, { id: 'pk', confirmation: 'REVOKE AGENCY KEY pk' })).resolves.toEqual({ revoked: true });
 expect(m.access).not.toHaveBeenCalled();
});
it('refuses a missing count and a failed revoke audit', async () => {
 m.query.mockImplementationOnce(async () => [{ id: 'u' }]).mockImplementationOnce(async () => []).mockImplementationOnce(async () => []);
 await expect(issuePersonKey({ userId: 'u' }, input)).rejects.toMatchObject({ code: 'unavailable' });
 m.execute.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
 await expect(revokePersonKey({ userId: 'u' }, { id: 'pk', confirmation: 'REVOKE AGENCY KEY pk' })).rejects.toMatchObject({ code: 'unavailable' });
});
