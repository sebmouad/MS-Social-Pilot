import { z } from 'zod';
import type { ScopedPermissions } from '@/server/permissions';
import type { AnalyticsAdCeiling } from '../server/types';

/** Report parts and range presets are stored in the shared legacy tables; keep the identifiers stable. */
export const REPORT_SECTION_IDS = ['analysis', 'goals', 'responseTime', 'audience', 'published', 'destinations', 'topPosts', 'aiRecap'] as const;
export const REPORT_RANGE_KEYS = ['today', 'yesterday', '7d', '30d', '90d', 'thisMonth', 'lastMonth', 'thisYear', 'all'] as const;
export const REPORT_FREQUENCIES = ['weekly', 'monthly'] as const;
export type ReportSectionId = (typeof REPORT_SECTION_IDS)[number];
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const confirmationText = z.string().max(500);

export const reportConfirmation = {
  createTemplate: (name: string) => `CREATE REPORT TEMPLATE ${name}`,
  updateTemplate: (templateId: string) => `UPDATE REPORT TEMPLATE ${templateId}`,
  deleteTemplate: (templateId: string) => `DELETE REPORT TEMPLATE ${templateId}`,
  createSchedule: (channelId: string, frequency: string) => `CREATE REPORT SCHEDULE ${channelId} ${frequency}`,
  updateSchedule: (scheduleId: string) => `UPDATE REPORT SCHEDULE ${scheduleId}`,
  deleteSchedule: (scheduleId: string) => `DELETE REPORT SCHEDULE ${scheduleId}`,
};

const sections = z.array(z.enum(REPORT_SECTION_IDS)).min(1).max(REPORT_SECTION_IDS.length)
  .refine(list => new Set(list).size === list.length, 'Choose each report section once.');
const name = z.string().trim().min(1);
export const recipientSchema = z.string().trim().toLowerCase().email().max(254);

export const templateActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name, sections, rangeKey: z.enum(REPORT_RANGE_KEYS).default('30d'), confirmation: confirmationText }).strict(),
  z.object({ action: z.literal('update'), id, name, sections, rangeKey: z.enum(REPORT_RANGE_KEYS), confirmation: confirmationText }).strict(),
  z.object({ action: z.literal('delete'), id, confirmation: confirmationText }).strict(),
]);
export const scheduleActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), channelId: id, frequency: z.enum(REPORT_FREQUENCIES), recipients: z.array(recipientSchema).min(1), templateId: id.nullable().default(null), confirmation: confirmationText }).strict(),
  z.object({ action: z.literal('update'), id, frequency: z.enum(REPORT_FREQUENCIES), recipients: z.array(recipientSchema).min(1), templateId: id.nullable(), confirmation: confirmationText }).strict(),
  z.object({ action: z.literal('delete'), id, confirmation: confirmationText }).strict(),
]);
export const listSchema = z.object({ page: z.number().int().min(1).max(10000).default(1) }).strict();

export type TemplateAction = z.infer<typeof templateActionSchema>;
export type ScheduleAction = z.infer<typeof scheduleActionSchema>;
/**
 * Caller identity plus independent ceilings. Every ceiling only narrows current authority and none is read as
 * "everything" when empty: `allowedChannelIds: []` means no channel; `maxResultItems` caps one page of any list.
 * `permissionCeiling` is the key's own feature grant; `apiKeyId` is recorded in audits (never the secret).
 * `resourceRestricted` marks a SELECTED-RESOURCE key, which cannot read or change workspace-wide templates. Sessions and
 * all-resource keys (even with channel limits inherited from membership) are not restricted. When the host omits the flag,
 * a key (`apiKeyId`) that carries `allowedChannelIds` is treated as restricted; a session never is.
 */
export type ReportActor = {
  userId: string; workspaceId: string; allowedChannelIds?: readonly string[]; maxResultItems?: number;
  permissionCeiling?: ScopedPermissions; apiKeyId?: string; resourceRestricted?: boolean;
} & AnalyticsAdCeiling;

export type ReportTemplateView = { id: string; name: string; sections: ReportSectionId[]; rangeKey: (typeof REPORT_RANGE_KEYS)[number]; createdAt: Date; scheduleCount: number };
export type ReportScheduleView = {
  id: string; channelId: string; channelName: string | null; templateId: string | null; templateName: string | null; frequency: ReportFrequency;
  recipientCount: number; recipients: string[]; nextRunAt: Date; lastRunAt: Date | null; lastOutcome: 'never' | 'generated' | 'failed'; createdAt: Date;
  /** Added: false while the channel is disconnected, deselected, disabled or its platform is unavailable. Such a schedule stays manageable but never generates or sends. */
  channelAvailable: boolean;
};

/** Sections the shared Analytics readers can honestly supply today; other stored section ids are listed as not included in a report. */
export const REPORT_SUPPORTED_SECTIONS = ['analysis', 'goals', 'responseTime', 'audience', 'published', 'destinations', 'topPosts', 'aiRecap'] as const;
/**
 * Sections that also depend on a runtime service. `aiRecap` can be named and enabled in Root, but customers are offered it
 * (and new templates may add it) only while AI assist is on and configured for them; a stored choice is otherwise listed as not included.
 */
export const REPORT_AI_SECTIONS = ['aiRecap'] as const;

export type ReportPeriod = { start: string; end: string };
export type ReportGenerationRequest = {
  /** Authority for reading data: its current membership, entitlement and channel scope apply. */
  actor: ReportActor; channelId: string; sections: ReportSectionId[]; period: ReportPeriod;
};
export type ReportOutput = {
  channelName: string; period: ReportPeriod; generatedAt: string; sections: ReportSectionId[]; notIncluded: ReportSectionId[];
  csv: string; html: string; text: string; /** Machine-readable rendering of the same rows, within the same bounds. */ json?: string; rowCount: number; bytes: number; truncated: boolean;
  /** Added: UTF-8 sizes of the other renderings. Every rendering is within Root's byte bound. */
  htmlBytes: number; textBytes: number; jsonBytes?: number;
};
export type ReportGenerationResult = { ok: true; output: ReportOutput } | { ok: false; reason: string };
/** Host-registered report builder. Without one, schedules and run-now are not offered. */
export interface ReportGenerationPort { generate(request: ReportGenerationRequest): Promise<ReportGenerationResult> }

/** `idempotencyKey` names one run+recipient for the host's records. SMTP itself is not idempotent: the module never calls `send` twice for one recipient. */
export type ReportMailInput = { to: string; subject: string; text: string; html: string; idempotencyKey: string; workspaceId: string };
/** Host-registered mail delivery. 'uncertain' means the outcome is unknown and must never be retried blindly. */
export interface ReportMailPort {
  send(input: ReportMailInput): Promise<{ status: 'sent' | 'failed' | 'unavailable' | 'uncertain' }>;
  /** Optional readiness probe (transport configured). When present and false, scheduled reports are neither offered nor sent. */
  ready?(): Promise<boolean>;
}
/** Host gate for the workspace owner's current plan/access. Required for scheduled sends; absence or a throw means no send. */
export type ReportEligibility = (workspaceId: string, channelId: string) => Promise<boolean>;

export type ReportRunStatus = 'claimed' | 'generating' | 'delivering' | 'completed' | 'partial' | 'failed' | 'uncertain' | 'skipped';
/** 'pending' is persisted before delivery starts, 'attempting' before the mail port is called, 'skipped' when authority changed first. */
export type ReportRecipientOutcome = { index: number; mask: string; status: 'pending' | 'attempting' | 'sent' | 'failed' | 'unavailable' | 'uncertain' | 'skipped' };
/** Customer-facing result: a manual run is only ever Prepared (a download); only a scheduled run can be Sent. */
export type ReportRunOutcome = 'in_progress' | 'prepared' | 'sent' | 'partially_sent' | 'not_sent' | 'uncertain' | 'skipped' | 'failed';
export type ReportRunView = {
  id: string; scheduleId: string | null; channelId: string; kind: 'scheduled' | 'manual'; status: ReportRunStatus; periodStart: string; periodEnd: string;
  startedAt: Date; finishedAt: Date | null; rowCount: number | null; truncated: boolean; failureReason: string | null; deliveries: ReportRecipientOutcome[];
  /** Added: distinguishes manual Prepared from scheduled Sent. */
  outcome: ReportRunOutcome;
};

export const reportRunConfirmation = (scheduleId: string) => `GENERATE REPORT ${scheduleId}`;
export const reportChannelRunConfirmation = (channelId: string) => `GENERATE CHANNEL REPORT ${channelId}`;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const requestId = z.string().uuid();
/** Either a schedule's latest complete period, or one channel over explicit inclusive UTC dates with an optional template. Both are downloads. */
export const reportRunScheduleSchema = z.object({ scheduleId: id, requestId, confirmation: confirmationText }).strict();
export const reportRunChannelSchema = z.object({ channelId: id, templateId: id.nullable().default(null), start: day, end: day, requestId, confirmation: confirmationText }).strict();
export const reportRunSchema = z.union([reportRunScheduleSchema, reportRunChannelSchema]);

/** What a prepared manual report keeps for replay: the downloadable renderings only, never the plain-text email body. */
export type ReportStoredOutput = Pick<ReportOutput, 'channelName' | 'period' | 'generatedAt' | 'sections' | 'notIncluded' | 'csv' | 'html' | 'rowCount' | 'truncated'> & { json?: string };

export const REPORT_SEND_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
