import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/server/data', () => ({ prisma: {} }));
import { policyDefaults } from '@/modules/calendar-extras/config';
import { copy as calendarCopy } from '@/modules/calendar-extras/copy';
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'calendarExtras.policy' ? policyDefaults : key === 'calendarExtras.customerCopy' ? calendarCopy : undefined }));
import { allocateQueueTime } from '@/modules/publishing/collaboration/server/executors';
const now = new Date('2026-10-20T00:00:00Z');
const good = [{ dayOfWeek: 3, hour: 10, minute: 0 }];
const rows = [{ targetId: null, dayOfWeek: 2, hour: 8, minute: 0 }];
const raw = vi.fn();
const tx = { $queryRaw: raw } as unknown as Parameters<typeof allocateQueueTime>[0];
beforeEach(() => { raw.mockReset(); raw.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('queue_slots') ? rows : []); });
it('prefers evidence-based times while keeping ordinary timetable allocation as the default', async () => {
  expect(await allocateQueueTime(tx, 'w', 'UTC', ['a'], now, 7, good)).toEqual(new Date('2026-10-21T10:00:00Z'));
  expect(await allocateQueueTime(tx, 'w', 'UTC', ['a'], now, 7)).toEqual(new Date('2026-10-20T08:00:00Z'));
});
it('skips occupied preferred times and falls back when none fit the horizon', async () => {
  raw.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('queue_slots') ? rows : [{ scheduledAt: new Date('2026-10-21T10:00:00Z') }]);
  expect(await allocateQueueTime(tx, 'w', 'UTC', ['a'], now, 2, good)).toEqual(new Date('2026-10-20T08:00:00Z'));
});
it('sorts ranked hours chronologically and keeps queries tenant/resource-scoped', async () => {
  expect(await allocateQueueTime(tx, 'w', 'UTC', ['a'], now, 7, [...good, { ...good[0]!, hour: 8 }])).toEqual(new Date('2026-10-21T08:00:00Z'));
  for (const [sql, ...values] of raw.mock.calls) {
    expect((sql as TemplateStringsArray).join('')).toContain('"workspaceId"');
    expect(values).toContain('w');
    // The seasonal-rule read is workspace-scoped; channel narrowing happens per day in memory.
    if (!(sql as TemplateStringsArray).join('').includes('seasonal_modes')) expect(values).toContainEqual(['a']);
  }
});
