import { OperationError } from '@/lib/operation-error';
import { REPORT_FREQUENCIES, REPORT_RANGE_KEYS, REPORT_SECTION_IDS, REPORT_SUPPORTED_SECTIONS, type ReportActor } from './contracts';
import { listReportRuns, runReportNow } from './generation/runs';
import { reportCapabilities } from './generation/registry';
import { listReportSchedules, manageReportSchedule } from './server/schedules';
import { listReportTemplates, manageReportTemplate } from './server/templates';

export const analyticsReportTools = new Set<string>(['list_report_templates', 'manage_report_template', 'list_report_schedules', 'manage_report_schedule', 'list_report_runs', 'generate_report']);
export const analyticsReportWriteTools = new Set<string>(['manage_report_template', 'manage_report_schedule', 'generate_report']);
/** Tools that exist only while report generation is registered; the host lists them through `analyticsReportAvailableToolDefinitions`. */
export const analyticsReportGenerationTools = new Set<string>(['list_report_runs', 'generate_report']);
const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$' };
const page = { type: 'object', properties: { page: { type: 'integer', minimum: 1 } }, additionalProperties: false };
export const analyticsReportToolDefinitions = [
  { name: 'list_report_templates', description: 'List saved report templates (sections and period) for the workspace.', inputSchema: page },
  { name: 'manage_report_template', description: 'Create, update or delete a report template. Confirmations: CREATE REPORT TEMPLATE <name>, UPDATE REPORT TEMPLATE <id>, DELETE REPORT TEMPLATE <id>. Deleting detaches schedules that used it. Templates are workspace-wide and unavailable to keys limited to selected channels. New choices may use only: ' + REPORT_SUPPORTED_SECTIONS.join(', ') + ' (aiRecap only while AI assist is on and configured; it is labelled AI-generated and counts toward the workspace AI allowance); an existing template keeps the other stored sections it already has.', inputSchema: { type: 'object', required: ['action', 'confirmation'], properties: { action: { type: 'string', enum: ['create', 'update', 'delete'] }, id, name: { type: 'string' }, sections: { type: 'array', items: { type: 'string', enum: [...REPORT_SECTION_IDS] } }, rangeKey: { type: 'string', enum: [...REPORT_RANGE_KEYS] }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_report_schedules', description: 'List scheduled report definitions within your channel scope. Recipient addresses are shown only to people (and keys) that can manage schedules. A key limited to selected channels cannot attach or change templates.', inputSchema: page },
  { name: 'manage_report_schedule', description: 'Create, update or delete a weekly or monthly report schedule definition. Confirmations: CREATE REPORT SCHEDULE <channelId> <frequency>, UPDATE REPORT SCHEDULE <id>, DELETE REPORT SCHEDULE <id>. Saving a schedule does not send anything immediately.', inputSchema: { type: 'object', required: ['action', 'confirmation'], properties: { action: { type: 'string', enum: ['create', 'update', 'delete'] }, id, channelId: id, frequency: { type: 'string', enum: [...REPORT_FREQUENCIES] }, recipients: { type: 'array', items: { type: 'string' } }, templateId: { anyOf: [id, { type: 'null' }] }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_report_runs', description: 'List report run history (status, period, row count, per-recipient delivery status) within your channel scope.', inputSchema: page },
  { name: 'generate_report', description: 'Prepare a report as CSV, JSON and printable HTML for download (the result carries csv, json and html strings; older retained runs may lack json). The responseTime section includes separate stored comment and conversation answer shares, median/slowest first responses and resolution times, member first-reply counts and calendar/business-hours medians split by source, period-start context, historical resolution/reopening event counts and calendar/business-hours resolution cycles split by source with stored-history coverage; absent history is excluded and unset business hours never become zero. All renderings share the same row and byte bounds and truncation marking. Nothing is emailed; the run is recorded as Prepared, never Sent, and works without email delivery. Two forms. (1) A schedule\'s most recent complete period: scheduleId, confirmation "GENERATE REPORT <scheduleId>". (2) One channel over explicit inclusive UTC dates: channelId, start and end (YYYY-MM-DD, within the Analytics range limit), optional templateId (null = default sections), confirmation "GENERATE CHANNEL REPORT <channelId>". requestId is a fresh UUID; repeating the same requestId with the same input returns the already prepared result (while still retained and authorised) instead of regenerating, and a different input with that id is refused. Returned rows are bounded by this key\'s result ceiling.', inputSchema: { type: 'object', required: ['requestId', 'confirmation'], properties: { scheduleId: id, channelId: id, templateId: { anyOf: [id, { type: 'null' }] }, start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, end: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, requestId: { type: 'string', format: 'uuid' }, confirmation: { type: 'string' } }, oneOf: [{ required: ['scheduleId'] }, { required: ['channelId', 'start', 'end'] }], additionalProperties: false } },
] as const;
/** Definitions to list now: generation tools appear only when generation is registered and its history exists. */
export async function analyticsReportAvailableToolDefinitions() {
  const capability = await reportCapabilities();
  return analyticsReportToolDefinitions.filter(tool => capability.generate || !analyticsReportGenerationTools.has(tool.name));
}
/** The host passes the key's ceilings in `actor` (channels, result size, feature grants, key id); the services intersect them with current authority. */
export async function executeAnalyticsReportTool(actor: ReportActor, name: string, args: Record<string, unknown>) {
  if (name === 'list_report_templates') return listReportTemplates(actor, args);
  if (name === 'manage_report_template') return manageReportTemplate(actor, args);
  if (name === 'list_report_schedules') return listReportSchedules(actor, args);
  if (name === 'manage_report_schedule') return manageReportSchedule(actor, args);
  if (name === 'list_report_runs' && (await reportCapabilities()).generate) return listReportRuns(actor, args);
  if (name === 'generate_report') return runReportNow(actor, args);
  throw new OperationError('invalid_request', 'Unknown report action.');
}
