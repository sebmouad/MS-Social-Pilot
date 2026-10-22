import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), targets: vi.fn(), posts: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), feature: vi.fn(), module: vi.fn(), allowed: vi.fn(), purge: vi.fn(), config: vi.fn(), connections: vi.fn(), viewer: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: m.query, $executeRaw: m.execute, $transaction: m.transaction, target: { findMany: m.targets }, post: { findMany: m.posts } } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: m.entitlements, canUseFeature: m.feature, canUseModule: m.module, entitledPlatformIds: () => ['example'] }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: m.allowed }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: m.permissions }));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: m.purge }));
vi.mock('@/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: m.connections }));
vi.mock('@/server/context', () => ({ requireViewer: m.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://app.test' }));
import { copy } from '../copy';
import { CALENDAR_EXTRAS_CONFIG, policyDefaults } from '../config';
import { authorize, checkTargets } from '../server/access';
import { calendarOptions, changeCalendarEntry, listCalendarEntries, seasonalRules } from '../server/service';
import { renderCalendarFeed, tokenHash } from '../server/subscriptions';
import { buildCalendar, foldLine } from '../server/ics';
import { adjustDaySlots, keyDateOn } from '../server/seasons';
import { executeCalendarTool, CALENDAR_EXTRAS_MCP } from '../mcp';
import { calendarCollectionHttp } from '../server/http';
import { schemas } from '../server/validation';
import { matchesKeywords } from '../server/trends';
import type { Actor, Area, Season } from '../contracts';
const actor: Actor = { userId: 'u1', workspaceId: 'w1' };
const filters = { from: '2026-10-01', to: '2026-12-31', offset: 0 };
const date = { title: 'Winter launch', date: '2026-11-10', yearly: false, targetIds: ['t1'] };
let role = 'owner', member = true, suspended = false, scope: string[] | null = null;
let customQuery: ((sql: string, values: unknown[]) => unknown) | undefined;
function sqlOf(input: unknown) { return Array.isArray(input) ? input.join('?') : (input as { sql?: string }).sql ?? ''; }
function valuesOf(args: unknown[]) { return Array.isArray(args[0]) ? args.slice(1) : (args[0] as { values?: unknown[] }).values ?? []; }
beforeEach(() => {
 vi.clearAllMocks(); role = 'owner'; member = true; suspended = false; scope = null; customQuery = undefined;
 m.config.mockImplementation(async (key: string) => key === 'calendarExtras.policy' ? structuredClone(policyDefaults) : key === 'calendarExtras.customerCopy' ? copy : 'https://app.test');
 m.entitlements.mockImplementation(async () => member ? { workspaceId: 'w1' } : null);
 m.permissions.mockImplementation(async () => ({ pageScope: scope === null ? { all: true } : { all: false, ids: scope } }));
 m.feature.mockReturnValue(true); m.module.mockReturnValue(true); m.allowed.mockReturnValue(true); m.connections.mockResolvedValue({ workspaceId: 'w1' });
 m.targets.mockResolvedValue([{ id: 't1', name: 'Studio journal' }]); m.posts.mockResolvedValue([]); m.execute.mockResolvedValue(1);
 m.query.mockImplementation(async (...args: unknown[]) => {
  const sql = sqlOf(args[0]), values = valuesOf(args);
  const custom = customQuery?.(sql, values); if (custom !== undefined) return custom;
  if (sql.includes('FROM memberships')) return member ? [{ id: 'm1', role, suspendedAt: suspended ? new Date() : null, timezone: 'UTC' }] : [];
  if (sql.includes('FROM chart_notes')) return [];
  if (sql.includes('FROM key_dates') && sql.includes('FOR UPDATE')) return [{ targetIds: ['t1'] }];
  if (sql.includes('FROM seasonal_modes') && sql.includes('FOR UPDATE')) return [{ targetIds: ['t1'] }];
  if (sql.includes('FROM workspaces') && sql.includes('suspendedAt')) return [{ suspendedAt: null }];
  return [];
 });
 m.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: m.query, $executeRaw: m.execute }));
 m.viewer.mockResolvedValue({ user: { id: 'u1' }, workspaceId: 'w1' });
});
describe('service authorization and scope', () => {
 it.each(['owner', 'admin', 'editor', 'contributor', 'viewer'])('%s reads with current tenant authorization', async value => { role = value; await listCalendarEntries(actor, 'dates', filters); expect(m.entitlements).toHaveBeenCalledWith('u1', 'w1', { allowInstallationInspection: false }); });
 it.each(['dates', 'seasons', 'feeds', 'notes', 'trends'] as const)('viewer cannot mutate %s', async area => { role = 'viewer'; await expect(changeCalendarEntry(actor, area, {})).rejects.toMatchObject({ code: 'forbidden' }); expect(m.execute).not.toHaveBeenCalled(); });
 it('members cannot change workspace seasons; editors can add scoped chart notes', async () => {
  role = 'editor'; await expect(changeCalendarEntry(actor, 'seasons', {})).rejects.toMatchObject({ code: 'forbidden' });
  const receipt = await changeCalendarEntry(actor, 'notes', { operation: 'create', data: { label: 'Campaign began', day: '2026-11-10', color: 'blue', targetId: 't1' }, confirmation: 'CREATE CALENDAR NOTES w1' });
  expect(receipt.confirmed).toBe(true);
 });
 it.each(['dates', 'seasons', 'feeds', 'notes', 'trends'] as const)('denies cross-workspace %s before reads/writes', async area => {
  m.entitlements.mockResolvedValue({ workspaceId: 'foreign' });
  await expect(listCalendarEntries(actor, area, filters)).rejects.toMatchObject({ code: 'forbidden' });
  expect(m.execute).not.toHaveBeenCalled();
 });
 it('denies absent membership, disabled plan and suspended writes', async () => {
  member = false; await expect(listCalendarEntries(actor, 'dates', filters)).rejects.toMatchObject({ code: 'unauthorized' });
  member = true; m.module.mockReturnValue(false); await expect(listCalendarEntries(actor, 'dates', filters)).rejects.toMatchObject({ code: 'forbidden' });
  m.module.mockReturnValue(true); suspended = true; await expect(changeCalendarEntry(actor, 'dates', {})).rejects.toMatchObject({ code: 'forbidden' });
 });
 it('intersects independent key ceilings and refuses foreign/global targets for a limited actor', async () => {
  scope = ['t1', 't2'];
  const access = await authorize({ ...actor, allowedTargetIds: ['t1', 'outside'], permissionCeiling: { pageScope: { all: false, ids: ['t1'] } } as never }, 'dates', 'read', copy.en);
  expect(access.scope).toEqual(['t1']); expect(() => checkTargets([], access, copy.en)).toThrow(); expect(() => checkTargets(['foreign'], access, copy.en)).toThrow();
  expect(m.targets.mock.calls.at(-1)?.[0].where.id.in).toEqual(['t1']);
 });
 it('refuses write feature ceiling even for an owner', async () => {
  const ceiling = { pageScope: { all: true } };
  m.allowed.mockImplementation((p: unknown) => p !== ceiling);
  await expect(changeCalendarEntry({ ...actor, permissionCeiling: ceiling as never }, 'dates', {})).rejects.toMatchObject({ code: 'forbidden' });
 });
});
describe('confirmed writes and shared entry points', () => {
 it('requires exact consent and never logs user text or tokens', async () => {
  const input = { operation: 'create', data: date, confirmation: 'wrong' };
  await expect(changeCalendarEntry(actor, 'dates', input)).rejects.toMatchObject({ code: 'invalid_request' }); expect(m.execute).not.toHaveBeenCalled();
  const r = await changeCalendarEntry({ ...actor, apiKeyId: 'key1' }, 'dates', { ...input, confirmation: 'CREATE CALENDAR DATES w1' });
  expect(r.confirmed).toBe(true);
  const log = m.execute.mock.calls.find(c => sqlOf(c[0]).includes('activity_logs'))!;
  const text = JSON.stringify(valuesOf(log)); expect(text).toContain('key1'); expect(text).not.toContain('Winter launch');
 });
 it('rechecks authority inside the transaction and fails a write if the audit cannot be saved', async () => {
  m.transaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => { role = 'viewer'; return fn({ $queryRaw: m.query, $executeRaw: m.execute }); });
  await expect(changeCalendarEntry(actor, 'dates', { operation: 'create', data: date, confirmation: 'CREATE CALENDAR DATES w1' })).rejects.toMatchObject({ code: 'forbidden' });
  expect(m.execute).not.toHaveBeenCalled();
  role = 'owner'; m.execute.mockImplementation(async (...args) => sqlOf(args[0]).includes('activity_logs') ? 0 : 1);
  await expect(changeCalendarEntry(actor, 'dates', { operation: 'create', data: date, confirmation: 'CREATE CALENDAR DATES w1' })).rejects.toMatchObject({ code: 'unavailable' });
 });
 it('uses the same create and invalid-confirmation behavior through HTTP and MCP', async () => {
  const input = { operation: 'create', data: date, confirmation: 'CREATE CALENDAR DATES w1' };
  const request = (body: unknown) => new Request('https://app.test/api/key-dates', { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await calendarCollectionHttp('dates')(request(input))).status).toBe(200);
  expect(await executeCalendarTool(actor, 'change_calendar_dates', input)).toMatchObject({ confirmed: true });
  const bad = { ...input, confirmation: 'wrong' };
  expect((await calendarCollectionHttp('dates')(request(bad))).status).toBe(400);
  await expect(executeCalendarTool(actor, 'change_calendar_dates', bad)).rejects.toMatchObject({ code: 'invalid_request' });
 });
 it('denies cross-origin requests and applies runtime title and result ceilings', async () => {
  const response = await calendarCollectionHttp('dates')(new Request('https://app.test/api/key-dates', { method: 'POST', headers: { origin: 'https://other.test' } }));
  expect(response.status).toBe(403); expect(m.viewer).not.toHaveBeenCalled();
  m.config.mockImplementation(async key => key === 'calendarExtras.policy' ? { ...policyDefaults, maxTitle: 3, pageSize: 2 } : copy);
  await expect(changeCalendarEntry(actor, 'dates', { operation: 'create', data: date, confirmation: 'CREATE CALENDAR DATES w1' })).rejects.toMatchObject({ code: 'invalid_request' });
  customQuery = sql => sql.includes('FROM key_dates') ? [{ id: 'a' }, { id: 'b' }] : undefined;
  const page = await listCalendarEntries(actor, 'dates', filters, 1); expect(page.limit).toBe(1); expect(page.hasMore).toBe(true); expect(page.items).toHaveLength(1);
 });
 it('uses French safe service errors from the Root catalog', async () => { role = 'viewer'; await expect(changeCalendarEntry({ ...actor, locale: 'fr' }, 'dates', {})).rejects.toThrow(copy.fr.denied); });
 it('installs a reviewed scope policy and self-locked writes for every advertised tool', () => { const group = CALENDAR_EXTRAS_MCP[0]; expect(group.tools).toHaveLength(15); expect([...group.selfLockedWrites!]).toHaveLength(5); expect(group.scope.workspaceTools).toHaveLength(15); });
});
describe('legacy storage, calendar rules and date validation', () => {
 it('accepts leap days but refuses impossible dates and reversed seasons', () => {
  const s = schemas(policyDefaults); expect(s.dates.safeParse({ ...date, date: '2028-02-29' }).success).toBe(true); expect(s.dates.safeParse({ ...date, date: '2026-02-30' }).success).toBe(false);
  expect(s.seasons.safeParse({ name: 'Winter', startsOn: '2026-12-01', endsOn: '2026-11-01', targetIds: [], rule: 'pause', shiftMinutes: 0, extraTimes: [] }).success).toBe(false);
  expect(keyDateOn({ date: '2020-02-29', yearly: true }, '2028-02-29')).toBe(true);
 });
 it('composes seasons, deduplicates times and drops shifts crossing midnight', () => {
  const base: Season = { id: 's', name: 'Season', startsOn: '2026-01-01', endsOn: '2026-12-31', targetIds: ['t1'], rule: 'more', shiftMinutes: 0, extraTimes: ['09:00', '13:00'] };
  const slots = [{ hour: 9, minute: 0 }, { hour: 11, minute: 0 }];
  expect(adjustDaySlots(slots, [base, { ...base, rule: 'fewer' }, { ...base, rule: 'shift', shiftMinutes: 60 }], ['t1'], '2026-11-01')).toEqual([{ hour: 10, minute: 0 }, { hour: 14, minute: 0 }]);
  expect(adjustDaySlots(slots, [{ ...base, rule: 'pause' }], ['t1'], '2026-11-01')).toEqual([]);
  expect(adjustDaySlots(slots, [{ ...base, rule: 'shift', shiftMinutes: -720 }], ['t1'], '2026-11-01')).toEqual([]);
 });
 it('validates every Root default and refuses an inconsistent policy', () => {
  for (const entry of CALENDAR_EXTRAS_CONFIG) expect(entry.schema.safeParse(entry.defaultValue).success).toBe(true);
  expect(CALENDAR_EXTRAS_CONFIG[0].schema.safeParse({ ...policyDefaults, defaultRangeDays: 200, maxRangeDays: 100 }).success).toBe(false);
 });
 it('does not silently truncate seasonal scheduling rules', async () => {
  m.config.mockImplementation(async key => key === 'calendarExtras.policy' ? { ...policyDefaults, pageSize: 1, maxRows: 1 } : copy);
  customQuery = sql => sql.includes('FROM seasonal_modes') ? [{ id: 's1' }, { id: 's2' }] : undefined;
  await expect(seasonalRules(actor, filters.from, filters.to)).rejects.toMatchObject({ code: 'invalid_request' });
 });
 it('keeps case-insensitive stored topic keywords and no-keyword behavior', () => { expect(matchesKeywords({ title: 'Cuisine française', newsTitle: null }, ['FRANÇAISE'])).toBe(true); expect(matchesKeywords({ title: 'News', newsTitle: null }, [])).toBe(true); });
});
describe('private ICS subscriptions', () => {
 const token = 'a'.repeat(43);
 const feed = { id: 'f1', name: 'Studio schedule', userId: 'u1', workspaceId: 'w1', pageIds: ['t1'], groupId: null };
 it('keeps legacy SHA-256 token compatibility and hashes new secrets, shown only once', async () => {
  expect(tokenHash('test')).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
  const result = await changeCalendarEntry(actor, 'feeds', { operation: 'create', data: { name: 'Studio', targetIds: ['t1'], groupId: null }, confirmation: 'CREATE CALENDAR FEEDS w1' });
  expect(result.url).toMatch(/^https:\/\/app.test\/api\/calendar-feed\/[A-Za-z0-9_-]+$/);
  const rawToken = result.url!.split('/').at(-1)!;
  const inserts = JSON.stringify(m.execute.mock.calls.map(valuesOf)); expect(inserts).not.toContain(rawToken); expect(inserts).toContain(tokenHash(rawToken));
 });
 it('rechecks creator membership and excludes all mixed hidden destinations', async () => {
  customQuery = sql => sql.includes('FROM calendar_feeds') ? [feed] : undefined;
  expect(await renderCalendarFeed(token)).toContain('BEGIN:VCALENDAR');
  const where = m.posts.mock.calls[0][0].where; expect(JSON.stringify(where)).toContain('every'); expect(JSON.stringify(where)).toContain('w1');
  member = false; expect(await renderCalendarFeed(token)).toBe(null);
 });
 it('invalid and revoked tokens return no calendar; revocation during a read wins', async () => {
  expect(await renderCalendarFeed('bad')).toBe(null); expect(await renderCalendarFeed(token)).toBe(null);
  customQuery = sql => sql.includes('FROM calendar_feeds') ? [feed] : undefined; m.execute.mockResolvedValue(0);
  expect(await renderCalendarFeed(token)).toBe(null);
 });
 it('does not let a restricted key create an all-channel feed from an empty selection', async () => {
  scope = []; m.targets.mockResolvedValue([]);
  await expect(changeCalendarEntry({ ...actor, allowedTargetIds: [] }, 'feeds', { operation: 'create', data: { name: 'Private', targetIds: [] }, confirmation: 'CREATE CALENDAR FEEDS w1' })).rejects.toMatchObject({ code: 'forbidden' });
 });
 it('revocation is scoped to both workspace and creator', async () => {
  await changeCalendarEntry(actor, 'feeds', { operation: 'delete', id: 'f1', confirmation: 'DELETE CALENDAR FEEDS f1' });
  const sql = m.execute.mock.calls[0]; expect(sqlOf(sql[0])).toContain('"userId"'); expect(valuesOf(sql)).toContain('w1'); expect(valuesOf(sql)).toContain('u1');
 });
 it('escapes content injection and folds Unicode by octets', () => {
  const now = new Date('2026-11-01T10:00:00Z');
  const output = buildCalendar('Studio\rBEGIN:VEVENT', [{ uid: 'post@app.test', start: now, updated: now, minutes: 15, summary: 'Crème, thé; café\\\n'.repeat(20), description: 'hello\r\nEND:VEVENT', url: 'https://app.test/publishing/posts' }], now);
  expect(output.split('BEGIN:VEVENT')).toHaveLength(3); expect(output).toContain('\\nEND');
  for (const line of output.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  expect(foldLine('é'.repeat(100)).replace(/\r\n /g, '')).toBe('é'.repeat(100));
 });
});

describe('record ownership and personal channel groups', () => {
 it.each(['dates', 'seasons', 'notes'] as const)('refuses foreign %s update/delete without audit', async area => {
  customQuery = sql => sql.includes('FOR UPDATE') ? [] : undefined;
  await expect(changeCalendarEntry(actor, area, { operation: 'delete', id: 'foreign', confirmation: `DELETE CALENDAR ${area.toUpperCase()} foreign` })).rejects.toMatchObject({ code: 'not_found' });
  expect(m.execute).not.toHaveBeenCalled();
 });
 it('does not allow a chart note on a channel outside the current selection', async () => {
  await expect(changeCalendarEntry(actor, 'notes', { operation: 'create', data: { label: 'Campaign', day: '2026-11-10', color: 'blue', targetId: 'foreign' }, confirmation: 'CREATE CALENDAR NOTES w1' })).rejects.toMatchObject({ code: 'not_found' });
 });
 it('refuses foreign organizational channel groups and never confuses them with platform Groups', async () => {
  await expect(changeCalendarEntry(actor, 'feeds', { operation: 'create', data: { name: 'Group', targetIds: [], groupId: 'foreign' }, confirmation: 'CREATE CALENDAR FEEDS w1' })).rejects.toMatchObject({ code: 'not_found' });
  expect(m.execute).not.toHaveBeenCalled();
 });
 it('creates a group feed with a bounded snapshot of currently authorized group channels', async () => {
  customQuery = sql => sql.includes('FROM page_groups') ? [{ id: 'group1' }] : sql.includes('FROM page_group_targets') ? [{ targetId: 't1' }] : undefined;
  const result = await changeCalendarEntry({ ...actor, allowedTargetIds: ['t1'] }, 'feeds', { operation: 'create', data: { name: 'Studio group', targetIds: [], groupId: 'group1' }, confirmation: 'CREATE CALENDAR FEEDS w1' });
  expect(result.url).toBeTruthy();
  const insert = m.execute.mock.calls.find(c => sqlOf(c[0]).includes('INSERT INTO calendar_feeds'))!;
  expect(JSON.stringify(valuesOf(insert))).toContain('t1');
 });
 it('denies expired or independently missing feature entitlement and key scope', async () => {
  m.feature.mockReturnValue(false);
  await expect(calendarOptions(actor, 'dates')).rejects.toMatchObject({ code: 'forbidden' });
 });
 it('refuses partial options when a key ceiling cannot fit the current channel directory', async () => {
  await expect(calendarOptions(actor, 'dates', 0)).rejects.toMatchObject({ code: 'invalid_request' });
 });
});
it('scopes holiday/trend countries to selected channels and discloses stored coverage', async () => {
 customQuery = sql => sql.includes('"trendKeywords" AS keywords') ? [{ countries: ['FR'], keywords: ['Cuisine'] }]
  : sql.includes('"audienceCountries" AS countries FROM targets') ? [{ countries: [] }]
  : sql.includes('FROM public_holidays') ? [{ country: 'FR', date: '2026-11-11', name: 'Armistice', localName: 'Armistice' }]
  : sql.includes('FROM trending_topics') ? [{ id: 'trend', country: 'FR', title: 'Cuisine du jour', newsTitle: null, fetchedAt: new Date() }, { id: 'other', country: 'FR', title: 'Sports', newsTitle: null, fetchedAt: new Date() }]
  : sql.includes('FROM holiday_years') ? [{ country: 'FR', year: 2026, count: 1, fetchedAt: new Date() }]
  : undefined;
 const result = await listCalendarEntries(actor, 'trends', filters);
 expect('countries' in result && result.countries).toEqual(['FR']); expect(result.items).toHaveLength(1);
 if ('holidays' in result) expect(result.holidays).toHaveLength(1);
 const query = m.query.mock.calls.find(c => sqlOf(c[0]).includes('FROM trending_topics'))!;
 expect(sqlOf(query[0])).toContain('"fetchedAt" >='); expect(JSON.stringify(valuesOf(query))).toContain('FR');
});
it('ignores malformed legacy extra times before applying shifts', () => {
 const season: Season = { id: 's', name: 'Legacy season', startsOn: '2026-01-01', endsOn: '2026-12-31', targetIds: ['t1'], rule: 'more', shiftMinutes: 0, extraTimes: ['25:00', '09:00', 'bad'] };
 expect(adjustDaySlots([], [season, { ...season, rule: 'shift', shiftMinutes: -720 }], ['t1'], '2026-11-01')).toEqual([]);
});
