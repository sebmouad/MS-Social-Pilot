import { ASYNC_POST_EXPORT_COPY } from '@/modules/publishing/server/export/config';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), raw: vi.fn(), config: vi.fn(), execute: vi.fn(), transaction: vi.fn(), exporter: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.raw, $executeRaw: mocks.execute, $transaction: mocks.transaction } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/modules/publishing/server/read-query', () => ({ publishingPostReadQuery: mocks.query }));
vi.mock('@/modules/publishing/server/export', () => ({ exportPublishingPosts: mocks.exporter }));
import { readPostExport, requestPostExport, runPostExportJob } from '@/modules/publishing/server/export/jobs';
const actor = { userId: 'member', workspaceId: 'workspace' };
beforeEach(() => { vi.resetAllMocks(); mocks.config.mockImplementation(async (key: string) => key === 'publishing.asyncExportCopy' ? ASYNC_POST_EXPORT_COPY : key === 'publishing.asyncExportPolicy' ? { expiryMs: 86400000, leaseMs: 300000, maxPendingPerUser: 3 } : 1000); mocks.execute.mockResolvedValue(1); mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: mocks.raw, $executeRaw: mocks.execute })); });
describe('private background export access', () => {
 it('checks current authorization before disclosing existence', async () => {
  mocks.query.mockRejectedValue(new Error('denied'));
  await expect(readPostExport(actor, 'foreign')).rejects.toThrow('denied');
  expect(mocks.raw).not.toHaveBeenCalled();
 });
 it('refuses missing or expired jobs', async () => {
  mocks.query.mockResolvedValue({ scope: { targetIds: ['a'] } }); mocks.raw.mockResolvedValue([]);
  await expect(readPostExport(actor, 'expired', true)).rejects.toMatchObject({ code: 'not_found' });
 });
 it('refuses a saved export after resource scope changes', async () => {
  mocks.query.mockResolvedValue({ scope: { targetIds: [] } });
  mocks.raw.mockResolvedValue([{ id: 'job', filters: {}, scope: 'old', status: 'ready', csv: 'private' }]);
  await expect(readPostExport(actor, 'job', true)).rejects.toMatchObject({ code: 'not_found' });
 });
 it('downloads only a ready export with unchanged authorized scope', async () => {
  mocks.query.mockResolvedValue({ scope: { targetIds: ['a'] } });
  const scope = createHash('sha256').update(JSON.stringify({ targetIds: ['a'], authorId: null })).digest('hex');
  mocks.raw.mockResolvedValue([{ id: 'job', filters: {}, scope, status: 'ready', csv: 'header\r\n', expiresAt: new Date('2030-01-01') }]);
  await expect(readPostExport(actor, 'job', true)).resolves.toMatchObject({ csv: 'header\r\n', fileName: 'posts.csv' });
 });
 it('requires confirmation before enqueueing a job', async () => {
  mocks.query.mockResolvedValue({ scope: { targetIds: [] } });
  await expect(requestPostExport(actor, {}, 'wrong')).rejects.toMatchObject({ code: 'invalid_request' });
  expect(mocks.raw).not.toHaveBeenCalled();
 });
 it('returns idle when no job can be claimed', async () => {

  mocks.raw.mockResolvedValue([]);
  await expect(runPostExportJob()).resolves.toBe(false);
 });

});

describe('durable export worker', () => {
 const scope = createHash('sha256').update(JSON.stringify({ targetIds: ['a'], authorId: null })).digest('hex');
 const claimed = { id: 'job', workspaceId: 'workspace', userId: 'member', filters: {}, ceiling: null, scope, attempts: 1 };
 it('records completion and audit only after a current lease settles', async () => {
  mocks.raw.mockResolvedValue([claimed]); mocks.query.mockResolvedValue({ scope: { targetIds: ['a'] } });
  mocks.exporter.mockResolvedValue({ csv: 'data', postCount: 1, byteLength: 4 });
  await expect(runPostExportJob()).resolves.toBe(true);
  const sql = mocks.execute.mock.calls.map(call => call[0].join('?')).join('\n');
  expect(sql).toContain("outcome = 'succeeded'"); expect(sql).toContain('publishing.export_completed');
 });
 it('does not audit or settle history when its lease was lost', async () => {
  mocks.raw.mockResolvedValue([claimed]); mocks.query.mockResolvedValue({ scope: { targetIds: ['a'] } });
  mocks.exporter.mockResolvedValue({ csv: 'data', postCount: 1, byteLength: 4 });
  mocks.execute.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes("SET status = 'ready'") ? 0 : 1);
  await runPostExportJob();
  expect(mocks.execute.mock.calls.some(call => call[0].join('').includes('publishing.export_completed'))).toBe(false);
  expect(mocks.execute.mock.calls.some(call => call[0].join('').includes("outcome = 'succeeded'"))).toBe(false);
 });
 it('retries transient failures and stores only a safe diagnostic code', async () => {
  mocks.raw.mockResolvedValue([claimed]); mocks.query.mockResolvedValue({ scope: { targetIds: ['a'] } });
  mocks.exporter.mockRejectedValue(new Error('secret-token-private-content'));
  await runPostExportJob();
  const args = JSON.stringify(mocks.execute.mock.calls);
  expect(args).toContain('upstream_failure'); expect(args).toContain('retry'); expect(args).not.toContain('secret-token');
 });
 it('never creates an artifact when current scope was revoked', async () => {
  mocks.raw.mockResolvedValue([claimed]); mocks.query.mockResolvedValue({ scope: { targetIds: [] } });
  await runPostExportJob();
  expect(mocks.exporter).not.toHaveBeenCalled();
  expect(JSON.stringify(mocks.execute.mock.calls)).toContain('not_found');
 });
});
