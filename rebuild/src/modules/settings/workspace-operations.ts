import { z } from 'zod';

/**
 * Workspace operations settings ported from the legacy workspace settings page
 * (legacy `src/lib/validation.ts` workspace schema and `src/lib/links.ts`).
 * Values live in the existing `workspaces` columns, so legacy values carry over
 * without a migration. Bounds below are the legacy domain validation rules,
 * not operational tuning.
 */
export const WORKSPACE_OPERATION_BOUNDS = {
  utmPart: 100, utmCampaign: 200, spamGapMinutes: 720, undoSendSeconds: 60,
  aiTone: 50, aiBrandVoice: 2000, aiAvoidWords: 1000,
} as const;

const optionalText = (max: number) => z.string().trim().max(max).transform(value => value || null);

const operationsShape = z.object({
  weekStartsOn: z.number().int().min(0).max(6),
  businessDays: z.array(z.number().int().min(0).max(6)).max(7).transform(days => [...new Set(days)].sort((a, b) => a - b)),
  businessStart: z.number().int().min(0).max(23),
  businessEnd: z.number().int().min(1).max(24),
  bestTimeMode: z.enum(['suggest', 'apply']),
  utmSource: optionalText(WORKSPACE_OPERATION_BOUNDS.utmPart),
  utmMedium: optionalText(WORKSPACE_OPERATION_BOUNDS.utmPart),
  utmCampaignTemplate: optionalText(WORKSPACE_OPERATION_BOUNDS.utmCampaign),
  shortenerEnabled: z.boolean(),
  spamGapMinutes: z.number().int().min(0).max(WORKSPACE_OPERATION_BOUNDS.spamGapMinutes),
  undoSendSeconds: z.number().int().min(0).max(WORKSPACE_OPERATION_BOUNDS.undoSendSeconds),
  aiEnabled: z.boolean(),
  aiTone: optionalText(WORKSPACE_OPERATION_BOUNDS.aiTone),
  aiBrandVoice: optionalText(WORKSPACE_OPERATION_BOUNDS.aiBrandVoice),
  aiAvoidWords: optionalText(WORKSPACE_OPERATION_BOUNDS.aiAvoidWords),
  watchNegativeComments: z.boolean(),
}).strict();
export const workspaceOperationsValueSchema = operationsShape.refine(value => value.businessEnd > value.businessStart, { message: 'Business hours must end after they start.', path: ['businessEnd'] });

export type WorkspaceOperations = z.output<typeof workspaceOperationsValueSchema>;
export const workspaceOperationsInputSchema = z.object({ settings: z.unknown(), confirmation: z.string().max(400) }).strict();
export const workspaceOperationsConfirmation = (workspaceId: string) => `UPDATE WORKSPACE OPERATIONS ${workspaceId}`;

export const WORKSPACE_OPERATIONS_DEFAULTS: WorkspaceOperations = {
  weekStartsOn: 1, businessDays: [], businessStart: 9, businessEnd: 18, bestTimeMode: 'suggest',
  utmSource: null, utmMedium: null, utmCampaignTemplate: null, shortenerEnabled: false,
  spamGapMinutes: 20, undoSendSeconds: 30, aiEnabled: true, aiTone: null, aiBrandVoice: null, aiAvoidWords: null, watchNegativeComments: false,
};

/** Normalizes a stored legacy row; anything out of range falls back to the legacy default. */
export function normalizeWorkspaceOperations(row: Record<string, unknown>): WorkspaceOperations {
  const out = { ...WORKSPACE_OPERATIONS_DEFAULTS } as Record<string, unknown>;
  const shape = operationsShape.shape as Record<string, z.ZodTypeAny>;
  for (const key of Object.keys(WORKSPACE_OPERATIONS_DEFAULTS)) {
    const raw = row[key] === null && WORKSPACE_OPERATIONS_DEFAULTS[key as keyof WorkspaceOperations] === null ? '' : row[key];
    const parsed = shape[key].safeParse(raw);
    if (parsed.success) out[key] = parsed.data;
  }
  if ((out.businessEnd as number) <= (out.businessStart as number)) { out.businessStart = WORKSPACE_OPERATIONS_DEFAULTS.businessStart; out.businessEnd = WORKSPACE_OPERATIONS_DEFAULTS.businessEnd; }
  return out as WorkspaceOperations;
}

/** Inbox response-time window: every hour when no day is selected (legacy rule). */
export function isWithinBusinessHours(settings: Pick<WorkspaceOperations, 'businessDays' | 'businessStart' | 'businessEnd'>, day: number, hour: number) {
  if (!settings.businessDays.length) return true;
  return settings.businessDays.includes(day) && hour >= settings.businessStart && hour < settings.businessEnd;
}

/** Legacy undo-send: zero publishes during the request. */
export const undoSendDelayMs = (settings: Pick<WorkspaceOperations, 'undoSendSeconds'>) => settings.undoSendSeconds * 1000;

/** Legacy spacing guard: zero turns the warning off; three or more destinations of one network closer than the gap warn. */
export function spacingWarning(settings: Pick<WorkspaceOperations, 'spamGapMinutes'>, scheduledTimes: Date[]) {
  if (!settings.spamGapMinutes || scheduledTimes.length < 3) return false;
  const sorted = scheduledTimes.map(time => time.getTime()).sort((a, b) => a - b);
  return sorted.some((time, index) => index > 0 && time - sorted[index - 1] < settings.spamGapMinutes * 60_000);
}

/**
 * One post sends to every selected destination at once, so three or more
 * destinations of the same installed platform fall inside any non-zero gap.
 * Grouping uses the neutral platform id only; no provider rules.
 */
export function crowdedDestinationPlatforms(spamGapMinutes: number, platforms: ReadonlyArray<string | null>) {
  if (!spamGapMinutes) return [];
  const counts = new Map<string, number>();
  for (const platform of platforms) if (platform) counts.set(platform, (counts.get(platform) ?? 0) + 1);
  return [...counts].filter(([, count]) => count >= 3).map(([platform]) => platform);
}

export type UtmSettings = Pick<WorkspaceOperations, 'utmSource' | 'utmMedium' | 'utmCampaignTemplate'>;
const slugPart = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** Supports {date}, {month}, {year} and {target} (legacy template tokens). */
export function renderUtmCampaign(template: string, context: { targetName?: string; date?: Date } = {}) {
  const date = context.date ?? new Date(); const pad = (value: number) => String(value).padStart(2, '0');
  return template.replace(/\{date\}/g, `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`)
    .replace(/\{month\}/g, `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`)
    .replace(/\{year\}/g, String(date.getUTCFullYear())).replace(/\{target\}/g, slugPart(context.targetName ?? '')).trim();
}
/** Appends UTM parameters without overwriting tags the URL already carries; malformed URLs are returned unchanged. */
export function applyUtm(rawUrl: string, settings: UtmSettings, context: { targetName?: string; date?: Date } = {}) {
  let url: URL; try { url = new URL(rawUrl); } catch { return rawUrl; }
  const campaign = settings.utmCampaignTemplate ? renderUtmCampaign(settings.utmCampaignTemplate, context) : null;
  for (const [key, value] of [['utm_source', settings.utmSource], ['utm_medium', settings.utmMedium], ['utm_campaign', campaign]] as const) if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
  return url.toString();
}
export function extractUrls(text: string) { return (text.match(/https?:\/\/[^\s<>"')]+/g) ?? []).map(url => url.replace(/[.,;:!?]+$/, '')); }
/** Tags every link in a caption; returns the original text when no UTM value is configured. */
export function prepareCaptionLinks(text: string, settings: UtmSettings, context: { targetName?: string; date?: Date } = {}) {
  if (!settings.utmSource && !settings.utmMedium && !settings.utmCampaignTemplate) return text;
  return [...new Set(extractUrls(text))].reduce((out, url) => out.split(url).join(applyUtm(url, settings, context)), text);
}

/** Avoid-word list for AI prompts: comma separated, trimmed, deduplicated. */
export const aiAvoidWordList = (value: string | null) => [...new Set((value ?? '').split(',').map(word => word.trim()).filter(Boolean))];

export const workspaceOperationsModuleMetadata = {
  id: 'settings/workspace-operations', permissions: ['settings/workspace'], authority: 'active workspace owner or admin',
  persistedFields: ['weekStartsOn', 'businessDays', 'businessStart', 'businessEnd', 'bestTimeMode', 'utmSource', 'utmMedium', 'utmCampaignTemplate', 'shortenerEnabled', 'spamGapMinutes', 'undoSendSeconds', 'aiEnabled', 'aiTone', 'aiBrandVoice', 'aiAvoidWords', 'watchNegativeComments'].map(field => `workspaces.${field}`),
  auditAction: 'workspace.operations_updated',
} as const;
