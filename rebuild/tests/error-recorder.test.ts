import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prisma: { $executeRaw: vi.fn() }, batch: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfigBatch: mocks.batch }));

import { ERRORS_CONFIG } from '../src/server/errors/config';
import { cleanLocation, fingerprintOf, loadErrorsPolicy, recordError, reportRequestError, resetErrorRecorderForTests, scrub } from '../src/server/errors/recorder';
import { reportClientError, resetClientReportLimitsForTests } from '../src/server/errors/client-report';

const defaults = Object.fromEntries(ERRORS_CONFIG.map(item => [item.key, item.defaultValue]));
let overrides: Record<string, unknown> = {}; let sql: Array<{ text: string; values: unknown[] }> = [];

beforeEach(() => {
  vi.clearAllMocks(); resetErrorRecorderForTests(); resetClientReportLimitsForTests(); overrides = {}; sql = [];
  mocks.batch.mockImplementation(async () => ({ ...defaults, ...overrides }));
  mocks.prisma.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => { sql.push({ text: strings.join('?'), values }); return 1; });
});

describe('scrubbing and grouping', () => {
  it('removes tokens, keys, bearer credentials and addresses', () => {
    const text = scrub('GET /x?access_token=EAAB1234567890123456789012345 failed for me@example.test Bearer abc.def-ghi sk-abcdefghijklmnopqrstuv password=hunter2');
    expect(text).not.toMatch(/EAAB|me@example|abc\.def|sk-abc|hunter2/);
    expect(text).toContain('[email]');
  });
  it('drops query strings from locations and bounds them', () => {
    expect(cleanLocation('/api/x?token=1#frag', 300)).toBe('/api/x');
    expect(cleanLocation('/' + 'a'.repeat(50), 10)).toHaveLength(10);
    expect(cleanLocation(null, 10)).toBeNull();
  });
  it('folds ids and numbers so one fault is one group', () => {
    expect(fingerprintOf('server', 'Error', 'Post abc12345def failed after 3 tries', null)).toBe(fingerprintOf('server', 'Error', 'Post 99887766aa failed after 9 tries', null));
    expect(fingerprintOf('server', 'Error', 'a', null)).not.toBe(fingerprintOf('worker', 'Error', 'a', null));
  });
});

describe('recordError', () => {
  it('upserts a scrubbed row tagged with source and location, reopening a resolved group', async () => {
    const ok = await recordError({ source: 'server', error: Object.assign(new Error('Boom for me@example.test'), { name: 'TypeError' }), location: '/publishing/posts?x=1' });
    expect(ok).toBe(true);
    const write = sql.find(call => call.text.includes('INSERT INTO error_events'))!;
    expect(write.text).toContain('ON CONFLICT (fingerprint)');
    expect(write.text).toContain('"resolvedAt" = NULL');
    expect(write.values).toContain('server'); expect(write.values).toContain('/publishing/posts'); expect(write.values).toContain('TypeError');
    expect(write.values.join(' ')).not.toContain('me@example.test');
  });
  it('honours the Root switch and size limits', async () => {
    overrides = { 'errors.recordingEnabled': false };
    expect(await recordError({ source: 'worker', error: new Error('x') })).toBe(false);
    expect(sql).toHaveLength(0);
    overrides = { 'errors.messageMaxCharacters': 100 };
    await recordError({ source: 'worker', error: new Error('word '.repeat(100)) });
    expect(sql[0]!.values.find(value => typeof value === 'string' && value.startsWith('word word'))).toHaveLength(100);
  });
  it('never throws, even when the database or configuration fails', async () => {
    mocks.prisma.$executeRaw.mockRejectedValueOnce(new Error('down'));
    await expect(recordError({ source: 'server', error: new Error('x') })).resolves.toBe(false);
    mocks.batch.mockRejectedValueOnce(new Error('config down'));
    await expect(loadErrorsPolicy()).resolves.toMatchObject({ 'errors.recordingEnabled': true });
  });
  it('prunes old groups at most once per interval', async () => {
    await recordError({ source: 'server', error: new Error('a') });
    await recordError({ source: 'server', error: new Error('b') });
    expect(sql.filter(call => call.text.includes('DELETE FROM error_events'))).toHaveLength(1);
  });
  it('records Next request errors with the route, never headers', async () => {
    await reportRequestError(new Error('x'), { path: '/a?b=1', method: 'GET' }, { routePath: '/publishing/[id]' });
    expect(sql[0]!.values).toContain('/publishing/[id]');
  });
});

describe('browser error reports', () => {
  const person = { userId: 'user-a' };
  it('records a valid report as a browser error', async () => {
    await expect(reportClientError(person, { name: 'TypeError', message: 'bad', path: '/home' })).resolves.toEqual({ recorded: true });
    expect(sql[0]!.values).toContain('browser');
  });
  it('rejects unknown fields and oversize text', async () => {
    await expect(reportClientError(person, { message: 'x', extra: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(reportClientError(person, { message: 'x'.repeat(5000) })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('ignores reports beyond the per-person window and keeps people apart', async () => {
    overrides = { 'errors.clientReportsPerWindow': 2 };
    const now = 1_000_000;
    expect((await reportClientError(person, { message: 'a' }, now)).recorded).toBe(true);
    expect((await reportClientError(person, { message: 'b' }, now + 1)).recorded).toBe(true);
    await expect(reportClientError(person, { message: 'c' }, now + 2)).resolves.toEqual({ recorded: false, reason: 'rate_limited' });
    expect((await reportClientError({ userId: 'user-b' }, { message: 'c' }, now + 2)).recorded).toBe(true);
    expect((await reportClientError(person, { message: 'd' }, now + 700_000)).recorded).toBe(true);
  });
  it('does nothing while Root has browser reports off, and refuses anonymous callers', async () => {
    overrides = { 'errors.clientReportsEnabled': false };
    await expect(reportClientError(person, { message: 'a' })).resolves.toEqual({ recorded: false, reason: 'disabled' });
    await expect(reportClientError({ userId: '' }, { message: 'a' })).rejects.toMatchObject({ code: 'unauthorized' });
    expect(sql).toHaveLength(0);
  });
});
