import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), create: vi.fn(), workspace: vi.fn(), target: vi.fn(), update: vi.fn(), send: vi.fn(), webhook: vi.fn(), enabled: vi.fn(() => true) }));
vi.mock('../src/lib/prisma', () => ({ prisma: { reportSchedule: { findMany: mocks.findMany, update: mocks.update, create: mocks.create }, workspace: { findUniqueOrThrow: mocks.workspace }, target: { findFirst: mocks.target } } }));
vi.mock('../src/lib/ai', () => ({ aiAvailable: () => false }));
vi.mock('../src/lib/reports', () => ({ buildReport: vi.fn(async () => ({})) }));
vi.mock('../src/lib/email/send', () => ({ sendEmail: mocks.send, emailEnabled: mocks.enabled }));
vi.mock('../src/lib/email/templates', () => ({ scheduledReportEmail: () => ({ subject: 'Report', text: '', html: '' }) }));
vi.mock('../src/lib/webhooks', () => ({ emitWebhook: mocks.webhook }));
import { createReportSchedule, sendDueReports } from '../src/lib/report-schedules';

const now = new Date('2026-10-05T08:00:00Z');
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.findMany.mockResolvedValue([{ id: 'schedule', workspaceId: 'workspace', targetId: 'page', frequency: 'weekly', recipients: ['a@example.test', 'b@example.test'], nextRunAt: now, workspace: { name: 'Client', timezone: 'UTC', weekStartsOn: 1, defaultLocale: 'en', aiEnabled: false } }]);
  mocks.target.mockResolvedValue({ id: 'page', name: 'Page' });
  mocks.workspace.mockResolvedValue({ timezone: 'UTC', weekStartsOn: 1 });
  mocks.create.mockResolvedValue({ id: 'schedule' });
});
it.each(['skipped', 'failed'] as const)('records %s recipients as unsuccessful and advances without a success webhook', async (status) => {
  mocks.send.mockResolvedValueOnce({ status: 'sent' }).mockResolvedValueOnce({ status, error: 'Delivery unavailable' });
  expect(await sendDueReports(now)).toEqual({ sent: 0, failed: 1 });
  expect(mocks.webhook).not.toHaveBeenCalled();
  expect(mocks.update.mock.calls[0]![0].data.lastError).toContain('Delivery unavailable');
  expect(mocks.update.mock.calls[0]![0].data.nextRunAt.getTime()).toBeGreaterThan(now.getTime());
});
it('does not count an all-skipped run as sent', async () => {
  mocks.send.mockResolvedValue({ status: 'skipped', error: 'No provider' });
  expect(await sendDueReports(now)).toEqual({ sent: 0, failed: 1 });
  expect(mocks.webhook).not.toHaveBeenCalled();
});
it('retains the success contract for all-sent recipients', async () => {
  mocks.send.mockResolvedValue({ status: 'sent' });
  expect(await sendDueReports(now)).toEqual({ sent: 1, failed: 0 });
  expect(mocks.webhook).toHaveBeenCalledOnce();
  expect(mocks.update.mock.calls[0]![0].data.lastError).toBeNull();
});
it('refuses schedule creation when email is unavailable before touching data', async () => {
  mocks.enabled.mockReturnValue(false);
  await expect(createReportSchedule('workspace', { targetId: 'page', frequency: 'weekly', recipients: ['a@example.test'] })).rejects.toMatchObject({ key: 'errors.reportEmailUnavailable', status: 503 });
});

it('records unavailable delivery when the provider is disabled after schedule creation', async () => {
  await createReportSchedule('workspace', { targetId: 'page', frequency: 'weekly', recipients: ['a@example.test'] });
  expect(mocks.create).toHaveBeenCalledOnce();
  mocks.enabled.mockReturnValue(false);
  mocks.send.mockImplementation(async () => mocks.enabled() ? { status: 'sent' } : { status: 'skipped', error: 'Provider unavailable' });
  expect(await sendDueReports(now)).toEqual({ sent: 0, failed: 1 });
  expect(mocks.update.mock.calls[0]![0].data.lastError).toContain('0/2 emails sent');
  expect(mocks.webhook).not.toHaveBeenCalled();
});
