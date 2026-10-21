import { documentText, reportDocumentCopyDefaults, type ReportDocumentCopy } from './copy';
import { responseTimeCopyDefaults, type ResponseTimeCopy } from './response-copy';
import { loadReportDocumentCopy } from './copy-server';
import type { MetricView } from '@/modules/analytics/server/aggregate';
import { readAnalyticsSnapshot } from '../../server/read';
import { REPORT_SECTION_IDS, REPORT_SUPPORTED_SECTIONS, type ReportActor, type ReportGenerationPort, type ReportGenerationRequest, type ReportGenerationResult, type ReportOutput, type ReportSectionId } from '../contracts';
import { authorizeReport, resultCeiling, usableChannelIds } from '../server/access';
import { prisma } from '@/server/data';
import { platformAnalytics } from '@/server/platforms/registry';
import type { DestinationMeasures, PostPerformance } from '@/server/platforms/host';
import { channelGoalProgress } from '../../goals/server/goals';
import type { GoalMonth, GoalProgress } from '../../goals/contracts';
import { describeBusinessHours as responseHours, formatDuration as responseDuration, readResponseTime, type ResponseTimeSummary } from './response-time';

/** One channel's per-destination summary: neutral counts plus the platform module's stored measures (null = not stored). */
export type DestinationSummary = {
  name: string; type: string; posts: number;
  /** Lifetime clicks on short links of posts that went only to this channel in the period; null when unknown. */
  linkClicks: number | null;
  /** Posts that also reached other destinations, whose shared short-link clicks cannot be split honestly. */
  sharedPosts: number;
  measures: DestinationMeasures['measures'];
};

export type ReportBounds = { maxRows: number; maxBytes: number };

/** The AI recap of one run: `ready` carries generated text; `unavailable` means it could not be produced this run (rate limit or provider failure). */
export type RecapState = { state: 'ready'; text: string } | { state: 'unavailable' };
export const RECAP_LABEL = reportDocumentCopyDefaults.en["AI-generated summary of the figures in this report. It may contain mistakes; check it against the figures."];
export const RECAP_UNAVAILABLE = reportDocumentCopyDefaults.en["The AI recap is unavailable for this run. The figures below are unaffected."];
/** Recap writer. Receives only compact report figures; the default is the AI module's authorized `summarize`. */
export type RecapWriter = (actor: { userId: string; workspaceId: string; permissionCeiling?: ReportActor['permissionCeiling'] }, request: { facts: string; subject: string; language: string }) => Promise<{ text: string }>;
const defaultRecap: RecapWriter = async (actor, request) => (await import('@/modules/ai/server/ai')).summarize(actor, request, { feature: 'analytics/reports' });

const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
/** Longest prefix within `max` UTF-8 bytes that never ends inside a character. */
export function cutBytes(text: string, max: number): string {
  if (bytes(text) <= max) return text;
  let cut = Buffer.from(text, 'utf8').subarray(0, Math.max(0, max)).toString('utf8');
  while (cut.endsWith('�')) cut = cut.slice(0, -1);
  return cut;
}
/** Names are clamped by character so one oversized stored value cannot make even the fixed parts of a report too large. Line breaks (including U+2028/U+2029) become spaces. */
const clamp = (text: string, max: number) => { const chars = [...text.replace(/[\r\n\u2028\u2029]+/g, ' ')]; return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join(''); };

const csvCell = (value: unknown): string => {
  let text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
  // Stored provider text must never run as a spreadsheet formula (leading space/control characters included).
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const coverageText = (m: Pick<MetricView, 'coverage' | 'available'>) => `${m.coverage} of ${m.available} channels`;
const valueText = (m: MetricView) => m.total === null ? 'Not available' : (m.displayTotal ?? String(m.total));
const asOf = (date: Date | null | undefined) => date ? date.toISOString().slice(0, 10) : 'unknown';

/** Largest prefix length of `rows` (0..n) whose rendering fits `maxBytes`. */
function fit(n: number, maxBytes: number, render: (count: number) => string): number {
  let lo = 0; let hi = n;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (bytes(render(mid)) <= maxBytes) lo = mid; else hi = mid - 1; }
  return lo;
}

type Snapshot = Awaited<ReturnType<typeof readAnalyticsSnapshot>>;
/**
 * Pure rendering of a report from one scoped Analytics snapshot. Values keep the snapshot's aggregation labels, coverage and
 * as-of times; a metric without data is "Not available", never zero. Every rendering is bounded in rows and UTF-8 bytes, and
 * anything cut is marked; when even the fixed parts exceed the bound a minimal notice is returned instead of an overflowing page.
 */
export function renderReport(snapshot: Snapshot, input: { channelName: string; sections: ReportSectionId[]; generatedAt: Date; responseTime?: ResponseTimeSummary | null; topPosts?: PostPerformance[] | null; destination?: DestinationSummary | null; goals?: { month: GoalMonth; goals: GoalProgress[] } | null; recap?: RecapState | null }, bounds: ReportBounds, copy: ReportDocumentCopy = reportDocumentCopyDefaults.en, locale: 'en' | 'fr' = 'en', responseCopy: ResponseTimeCopy = responseTimeCopyDefaults): ReportOutput {
  const t = documentText(copy);
  const formatDuration = (ms: number | null) => responseDuration(ms, responseCopy, locale);
  const describeBusinessHours = (hours: Parameters<typeof responseHours>[0]) => responseHours(hours, responseCopy, locale);
  const RECAP_LABEL = t("AI-generated summary of the figures in this report. It may contain mistakes; check it against the figures.");
  const RECAP_UNAVAILABLE = t("The AI recap is unavailable for this run. The figures below are unaffected.");
  const coverageText = (m: Pick<MetricView, 'coverage' | 'available'>) => t("{v0} of {v1} channels", { v0: m.coverage, v1: m.available });
  const valueText = (m: MetricView) => m.total === null ? t("Not available") : (m.displayTotal ?? String(m.total));
  const asOf = (date: Date | null | undefined) => date ? date.toISOString().slice(0, 10) : t("unknown");
  const wanted = new Set(input.sections);
  // The recap is included only when the run produced it or recorded that it could not; otherwise (AI off or not permitted) it is not included.
  const included = REPORT_SECTION_IDS.filter(s => wanted.has(s) && (REPORT_SUPPORTED_SECTIONS as readonly string[]).includes(s) && (s !== 'aiRecap' || Boolean(input.recap)));
  const notIncluded = REPORT_SECTION_IDS.filter(s => wanted.has(s) && !included.includes(s));
  const period = { start: snapshot.period.start, end: snapshot.period.end };
  const channelName = clamp(input.channelName, 200);
  const metrics = included.includes('analysis') ? snapshot.allMetrics.filter(m => m.resourceKind === 'channel') : [];
  const audience = included.includes('audience') ? snapshot.audience : null;
  const response = included.includes('responseTime') ? input.responseTime ?? null : null;
  const responseBasis = response ? (response.businessHours
    ? t("Business hours ({v0}): median first response {v1}, counting only time inside business hours. Calendar time: median first response {v2}.", { v0: describeBusinessHours(response.businessHours), v1: formatDuration(response.businessMedianMs), v2: formatDuration(response.medianMs) })
    : t("Calendar time: median first response {v0}. Business hours are not set for this workspace, so no business-hours figure is shown.", { v0: formatDuration(response.medianMs) })) : '';
  const responseLine = response ? t("{v0} {v1} answered, {v2} waiting at period end. From stored Inbox messages{v3}.", { v0: responseBasis, v1: response.answered, v2: response.unanswered, v3: response.partial ? t("; only the earliest messages were read") : '' }) : '';
  const memberLine = (m: { name: string; answered: number; medianMs: number | null }) => t("{v0}: {v1} answered, median first response {v2}", { v0: clamp(m.name, 80), v1: m.answered, v2: formatDuration(m.medianMs) });
  const memberLines = response?.members ? [...response.members.flatMap(m => [memberLine(m), ...(m.businessMedianMs !== undefined ? [t("{v0}: median first response within business hours {v1}.", { v0: clamp(m.name, 80), v1: formatDuration(m.businessMedianMs) })] : [])]), ...(response.membersOmitted ? [t("{v0} more not listed", { v0: response.membersOmitted })] : [])] : [];
  const resolveLine = response?.resolve ? t("Resolve time: median {v0} from the first visitor message to resolved; {v1} resolved, {v2} not resolved (not counted as zero).", { v0: formatDuration(response.resolve.medianMs), v1: response.resolve.resolved, v2: response.resolve.unresolved }) : '';
  const responseDetails = response ? [
    t("Stored comments and conversation messages; unavailable history is not included."),
    t("Waits are counted only when their original visitor run starts in the report period."),
    ...(response.coverage ? [
      t("Stored history only; completeness on the connected platform is unknown."),
      t("Incomplete threads or post discussions excluded at the read limit: {v0}.", { v0: response.coverage.incompleteGroupsExcluded }),
      t("History read: {v0} messages, {v1} comments, {v2} workflow events.", { v0: response.coverage.messagesRead, v1: response.coverage.commentsRead, v2: response.coverage.eventsRead }),
      t("{v0} items use current saved state because earlier workflow events are unavailable.", { v0: response.coverage.snapshotFallbackItems }),
      ...(response.coverage.eventsTruncated ? [t("Workflow history reached its read limit; resolution times are unavailable.")] : []),
    ] : []),
    ...(response.history ? [t("Historical resolution cycles: {v0} measured; median {v1} calendar time, {v2} within business hours.", { v0: response.history.measuredCycles, v1: formatDuration(response.history.medianMs), v2: formatDuration(response.history.businessMedianMs) }), t("Only recorded resolution cycles with a visitor start in the period; reopening alone creates no duration."), t("Workflow events in period: {v0} resolutions, {v1} reopenings.", { v0: response.history.resolved, v1: response.history.reopened })] : []),
    t("Slowest first response: {v0} calendar time; {v1} within business hours.", { v0: formatDuration(response.slowestMs ?? null), v1: formatDuration(response.businessSlowestMs ?? null) }),
    t("Resolve time within business hours: median {v0}.", { v0: formatDuration(response.resolve?.businessMedianMs ?? null) }),
    ...(response.comments ? [t("Comment waits: {v0} answered, {v1} waiting at period end.", { v0: response.comments.answered, v1: response.comments.unanswered })] : []),
  ] : [];
  const sourceSummaries = response ? [
    { prefix: 'comment', label: t("Comments"), summary: response.comments },
    { prefix: 'conversation', label: t("Conversations"), summary: response.conversations },
  ] : [];
  for (const { label, summary: r } of sourceSummaries) if (r && r.total !== undefined) {
    responseDetails.push(
      t("{v0}: {v1} waits, {v2} answered, {v3} waiting; answered share {v4}.", { v0: label, v1: r.total, v2: r.answered, v3: r.unanswered, v4: r.answeredPercent == null ? t("Not available") : `${r.answeredPercent}%` }),
      t("{v0}: median first response {v1} calendar time, {v2} within business hours; slowest {v3} calendar time, {v4} within business hours.", { v0: label, v1: formatDuration(r.medianMs ?? null), v2: formatDuration(r.businessMedianMs ?? null), v3: formatDuration(r.slowestMs ?? null), v4: formatDuration(r.businessSlowestMs ?? null) }),
      t("{v0}: median resolution {v1} calendar time, {v2} within business hours; {v3} resolved, {v4} unresolved.", { v0: label, v1: formatDuration(r.resolve?.medianMs ?? null), v2: formatDuration(r.resolve?.businessMedianMs ?? null), v3: r.resolve?.resolved ?? 0, v4: r.resolve?.unresolved ?? 0 }),
    );
    if (r.history) responseDetails.push(
      t("{v0}: {v1} recorded resolution cycles; median {v2} calendar time, {v3} within business hours.", { v0: label, v1: r.history.measuredCycles, v2: formatDuration(r.history.medianMs), v3: formatDuration(r.history.businessMedianMs) }),
      t("{v0}: {v1} resolution events, {v2} reopening events. Events may concern waits absent from stored visitor history.", { v0: label, v1: r.history.resolved, v2: r.history.reopened }),
    );
    for (const member of r.members ?? []) responseDetails.push(t("{v0} — {v1}: {v2} first replies; median {v3} calendar time, {v4} within business hours.", { v0: label, v1: member.name, v2: member.answered, v3: formatDuration(member.medianMs), v4: formatDuration(member.businessMedianMs ?? null) }));
    if (r.membersOmitted) responseDetails.push(t("{v0}: {v1} more responding members not listed.", { v0: label, v1: r.membersOmitted }));
  }
  if (response?.memberOutcomes) responseDetails.push(t("Resolution is attributed to the first responder of the last visitor run before saved resolution, not to the person who marked it resolved. Unanswered runs are excluded."));
  const outcomeSources = response ? [
    { prefix: '', label: t("Inbox"), outcomes: response.memberOutcomes },
    ...sourceSummaries.map(({ prefix, label, summary }) => ({ prefix: `${prefix}_`, label, outcomes: summary?.memberOutcomes })),
  ] : [];
  for (const { label, outcomes } of outcomeSources) for (const member of outcomes ?? []) responseDetails.push(t("{v0} — {v1}: slowest first response {v2} calendar time, {v3} within business hours; {v4} answered waits resolved, {v5} not resolved; median resolution {v6} calendar time, {v7} within business hours.", { v0: label, v1: member.name, v2: formatDuration(member.slowestMs), v3: formatDuration(member.businessSlowestMs), v4: member.resolved, v5: member.unresolved, v6: formatDuration(member.medianResolveMs), v7: formatDuration(member.businessMedianResolveMs) }));
  const recap = included.includes('aiRecap') ? input.recap ?? null : null;
  const recapText = recap ? (recap.state === 'ready' ? recap.text : RECAP_UNAVAILABLE) : '';
  const topPosts = included.includes('topPosts') ? input.topPosts ?? [] : null;
  const destination = included.includes('destinations') ? input.destination ?? null : null;
  const destinationNote = destination ? t("Stored values summed over {v0} published post{v1}; a measure no post has stored is Not available, not zero.", { v0: destination.posts, v1: destination.posts === 1 ? '' : 's' }) : '';
  const linkClicksText = destination ? (destination.linkClicks === null ? t("Not available") : String(destination.linkClicks)) : '';
  const measureText = (m: DestinationMeasures['measures'][number]) => m.value === null ? t("Not available") : `${m.value}${m.measuredPosts < (destination?.posts ?? 0) ? t(" (stored for {v0} of {v1} posts)", { v0: m.measuredPosts, v1: destination?.posts ?? 0 }) : ''}`;
  const postTitle = (p: PostPerformance) => clamp(p.text || t("(no text)"), 120);
  const goals = included.includes('goals') ? input.goals ?? { month: { month: '', start: '', end: '', timeZone: '' }, goals: [] } : null;
  const goalText = (g: GoalProgress) => t("{v0}: {v1} of {v2} ({v3}%, {v4})", { v0: g.label, v1: g.actual === null ? t("No data") : g.actual, v2: g.target, v3: g.percent, v4: g.paceLabel });
  const audienceAsOf = audience ? audience.entries.map(e => e.asOf).filter((d): d is Date => d instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0] : undefined;

  // CSV: long form, one row per summary/point/resource, cut at the row and byte limits.
  const header = ['record_type', 'metric_key', 'metric', 'source', 'resource', 'date', 'value', 'unit', 'coverage', 'aggregation'];
  const rows: unknown[][] = [];
  if (recap) rows.push(['ai_recap', 'ai_recap', t("AI recap (AI-generated)"), t("AI-generated"), '', '', recap.state === 'ready' ? recap.text : '', '', '', recap.state === 'ready' ? RECAP_LABEL : RECAP_UNAVAILABLE]);
  if (audience) for (const e of audience.entries) rows.push(['audience', e.metric, e.metricLabel, e.sourceLabel, e.name, e.asOf, e.value, 'people', t("{v0} of {v1} channels", { v0: audience.covered, v1: audience.selected }), t("Latest value per channel; not unique people")]);
  if (response) {
    if (response.coverage) {
      rows.push(['response_time', 'incomplete_groups_excluded', t("History coverage"), t("Inbox"), '', '', response.coverage.incompleteGroupsExcluded, 'groups', response.partial ? 'partial' : '', t("Incomplete threads or post discussions excluded at the read limit: {v0}.", { v0: response.coverage.incompleteGroupsExcluded })]);
      rows.push(['response_time', 'stored_messages_read', t("Stored messages read"), t("Inbox"), '', '', response.coverage.messagesRead, 'records', response.coverage.messagesTruncated ? 'partial' : 'stored_only', t("Waits are counted only when their original visitor run starts in the report period.")]);
      rows.push(['response_time', 'stored_comments_read', t("Stored comments read"), t("Inbox"), '', '', response.coverage.commentsRead, 'records', response.coverage.commentsTruncated ? 'partial' : 'stored_only', t("Stored history only; completeness on the connected platform is unknown.")]);
      rows.push(['response_time', 'workflow_events_read', t("Workflow events read"), t("Inbox"), '', '', response.coverage.eventsRead, 'events', response.coverage.eventsTruncated ? 'partial' : '', t("Count at period end")]);
      rows.push(['response_time', 'history_coverage', t("History coverage"), t("Inbox"), '', '', '', '', response.partial ? 'partial' : 'stored_only', t("Stored history only; completeness on the connected platform is unknown.")]);
      rows.push(['response_time', 'snapshot_fallback_items', t("Saved-state fallback items"), t("Inbox"), '', '', response.coverage.snapshotFallbackItems, 'items', response.coverage.eventsTruncated ? 'partial' : '', t("{v0} items use current saved state because earlier workflow events are unavailable.", { v0: response.coverage.snapshotFallbackItems })]);
    }
    if (response.history) {
      rows.push(['response_time', 'historical_resolve_minutes', t("Historical resolution cycles"), t("Inbox"), '', '', response.history.medianMs === null ? '' : Math.round(response.history.medianMs / 60_000), 'minutes', response.partial ? 'partial' : '', t("Only recorded resolution cycles with a visitor start in the period; reopening alone creates no duration.")]);
      rows.push(['response_time', 'historical_resolve_business_minutes', t("Median resolve time (business hours)"), t("Inbox"), '', '', response.history.businessMedianMs === null ? '' : Math.round(response.history.businessMedianMs / 60_000), 'minutes', response.partial ? 'partial' : '', t("Only recorded resolution cycles with a visitor start in the period; reopening alone creates no duration.")]);
      rows.push(['response_time', 'resolution_events', t("Resolution events"), t("Inbox"), '', '', response.history.resolved, 'events', response.partial ? 'partial' : '', t("Count in period")]);
      rows.push(['response_time', 'reopening_events', t("Reopening events"), t("Inbox"), '', '', response.history.reopened, 'events', response.partial ? 'partial' : '', t("Count in period")]);
    }
    rows.push(['response_time', 'median_first_response_minutes', t("Median first response (calendar time)"), t("Inbox"), '', '', response.medianMs === null ? '' : Math.round(response.medianMs / 60_000), 'minutes', response.partial ? 'partial' : '', t("Median wait until the channel replied; calendar time")]);
    rows.push(['response_time', 'median_first_response_business_minutes', t("Median first response (business hours)"), t("Inbox"), '', '', response.businessHours && response.businessMedianMs !== null ? Math.round(response.businessMedianMs / 60_000) : '', 'minutes', response.businessHours ? (response.partial ? 'partial' : '') : t("not set"), response.businessHours ? t("Median wait counting only business hours: {v0}", { v0: describeBusinessHours(response.businessHours) }) : t("Business hours are not set for this workspace; no figure")]);
    rows.push(['response_time', 'slowest_first_response_minutes', t("Slowest first response (calendar time)"), t("Inbox"), '', '', response.slowestMs == null ? '' : Math.round(response.slowestMs / 60_000), 'minutes', response.partial ? 'partial' : '', t("Maximum observed answered wait; calendar time")]);
    rows.push(['response_time', 'slowest_first_response_business_minutes', t("Slowest first response (business hours)"), t("Inbox"), '', '', response.businessSlowestMs == null ? '' : Math.round(response.businessSlowestMs / 60_000), 'minutes', response.businessHours ? (response.partial ? 'partial' : '') : t("not set"), t("Maximum observed answered wait within business hours")]);
    rows.push(['response_time', 'median_resolve_business_minutes', t("Median resolve time (business hours)"), t("Inbox"), '', '', response.resolve?.businessMedianMs == null ? '' : Math.round(response.resolve.businessMedianMs / 60_000), 'minutes', response.businessHours ? (response.partial ? 'partial' : '') : t("not set"), t("Resolution waits within configured business hours; unresolved waits excluded, not zero")]);
    if (response.comments && response.comments.total === undefined) {
      rows.push(['response_time', 'comment_answered_waits', t("Comment waits answered"), t("Inbox"), '', '', response.comments.answered, 'waits', response.partial ? 'partial' : '', t("Count in period")]);
      rows.push(['response_time', 'comment_unanswered_waits', t("Comment waits unanswered"), t("Inbox"), '', '', response.comments.unanswered, 'waits', response.partial ? 'partial' : '', t("Count at period end")]);
    }
    for (const { prefix, label, summary: r } of sourceSummaries) if (r && r.total !== undefined) {
      const coverage = response.partial ? 'partial' : 'stored_only';
      const add = (key: string, metric: string, value: number | null | undefined, unit: string, note: string) => rows.push(['response_time', `${prefix}_${key}`, metric, t("Inbox"), label, '', value ?? '', unit, coverage, note]);
      add('total_waits', t("Total visitor waits"), r.total, 'waits', t("Count in period"));
      add('answered_percent', t("Answered share"), r.answeredPercent, 'percent', t("Answered waits divided by all visitor waits; unavailable when there are no waits."));
      add('answered_waits', t("Answered waits"), r.answered, 'waits', t("Count in period"));
      add('unanswered_waits', t("Waiting at period end"), r.unanswered, 'waits', t("Count at period end"));
      const minutes = (value: number | null | undefined) => value == null ? null : value / 60_000;
      add('median_first_response_minutes', t("Median first response (calendar time)"), minutes(r.medianMs), 'minutes', t("Median wait until the channel replied; calendar time"));
      add('median_first_response_business_minutes', t("Median first response (business hours)"), minutes(r.businessMedianMs), 'minutes', response.businessHours ? describeBusinessHours(response.businessHours) : t("not set"));
      add('slowest_first_response_minutes', t("Slowest first response (calendar time)"), minutes(r.slowestMs), 'minutes', t("Maximum observed answered wait; calendar time"));
      add('slowest_first_response_business_minutes', t("Slowest first response (business hours)"), minutes(r.businessSlowestMs), 'minutes', response.businessHours ? describeBusinessHours(response.businessHours) : t("not set"));
      add('median_resolve_minutes', t("Median resolve time"), minutes(r.resolve?.medianMs), 'minutes', t("Count at period end"));
      add('median_resolve_business_minutes', t("Median resolve time (business hours)"), minutes(r.resolve?.businessMedianMs), 'minutes', response.businessHours ? describeBusinessHours(response.businessHours) : t("not set"));
      add('resolved_waits', t("Resolved"), r.resolve?.resolved, 'waits', t("Count at period end"));
      add('unresolved_waits', t("Not resolved"), r.resolve?.unresolved, 'waits', t("Count at period end"));
      if (r.history) {
        const note = t("Only recorded resolution cycles with a visitor start in the period; reopening alone creates no duration.");
        add('historical_resolution_cycles', t("Historical resolution cycles"), r.history.measuredCycles, 'cycles', note);
        add('historical_resolve_minutes', t("Historical resolution cycles"), minutes(r.history.medianMs), 'minutes', note);
        add('historical_resolve_business_minutes', t("Median resolve time (business hours)"), minutes(r.history.businessMedianMs), 'minutes', response.businessHours ? note : t("not set"));
        add('resolution_events', t("Resolution events"), r.history.resolved, 'events', t("Recorded actions in period; visitor history may be unavailable. Counts are not resolution cycles."));
        add('reopening_events', t("Reopening events"), r.history.reopened, 'events', t("Recorded actions in period; visitor history may be unavailable. Counts are not resolution cycles."));
      }
      for (const member of r.members ?? []) {
        const addMember = (key: string, metric: string, value: number | null | undefined, unit: string, note: string) => rows.push(['response_time', `${prefix}_member_${key}`, metric, label, member.name, '', value ?? '', unit, coverage, note]);
        addMember('answered_waits', t("Answered waits"), member.answered, 'waits', t("Count in period"));
        addMember('first_response_minutes', t("Median first response by member"), minutes(member.medianMs), 'minutes', t("Median wait until the channel replied; calendar time"));
        addMember('first_response_business_minutes', t("Median first response by member (business hours)"), minutes(member.businessMedianMs), 'minutes', response.businessHours ? describeBusinessHours(response.businessHours) : t("not set"));
      }
      if (r.membersOmitted !== undefined) add('members_omitted', t("Responding members not listed"), r.membersOmitted, 'members', t("Configured member row limit applies independently to each source."));
    }
    for (const m of response.members ?? []) if (m.businessMedianMs !== undefined) rows.push(['response_time', 'member_first_response_business_minutes', t("Median first response by member (business hours)"), t("Inbox"), clamp(m.name, 80), '', m.businessMedianMs === null ? '' : m.businessMedianMs / 60_000, 'minutes', response.businessHours ? (response.partial ? 'partial' : 'stored_only') : t("not set"), t("First replies attributed to the responding member; configured workspace business hours only.")]);
    for (const { prefix, label, outcomes } of outcomeSources) for (const member of outcomes ?? []) {
      const note = t("Resolution is attributed to the first responder of the last visitor run before saved resolution, not to the person who marked it resolved. Unanswered runs are excluded.");
      const add = (key: string, metric: string, value: number | null, unit: string, business = false) => rows.push(['response_time', `${prefix}member_${key}`, metric, label, member.name, '', value ?? '', unit, business && !response.businessHours ? t("not set") : response.partial ? 'partial' : 'stored_only', note]);
      add('slowest_first_response_minutes', t("Member slowest first response (calendar time)"), member.slowestMs === null ? null : member.slowestMs / 60_000, 'minutes');
      add('slowest_first_response_business_minutes', t("Member slowest first response (business hours)"), member.businessSlowestMs === null ? null : member.businessSlowestMs / 60_000, 'minutes', true);
      add('resolved_waits', t("Member answered waits resolved"), member.resolved, 'waits');
      add('unresolved_waits', t("Member answered waits not resolved"), member.unresolved, 'waits');
      add('median_resolve_minutes', t("Member median resolution (calendar time)"), member.medianResolveMs === null ? null : member.medianResolveMs / 60_000, 'minutes');
      add('median_resolve_business_minutes', t("Member median resolution (business hours)"), member.businessMedianResolveMs === null ? null : member.businessMedianResolveMs / 60_000, 'minutes', true);
    }
    rows.push(['response_time', 'answered_waits', t("Answered waits"), t("Inbox"), '', '', response.answered, 'waits', response.partial ? 'partial' : '', t("Count in period")]);
    rows.push(['response_time', 'unanswered_waits', t("Waiting at period end"), t("Inbox"), '', '', response.unanswered, 'waits', response.partial ? 'partial' : '', t("Count at period end")]);
    for (const m of response.members ?? []) rows.push(['response_time', 'member_first_response_minutes', t("Median first response by member"), t("Inbox"), clamp(m.name, 80), '', m.medianMs === null ? '' : Math.round(m.medianMs / 60_000), 'minutes', t("{v0} answered", { v0: m.answered }), m.memberId === null ? t("Replies sent outside the app; calendar time") : t("Replies sent through this app; calendar time")]);
    if (response.resolve) {
      rows.push(['response_time', 'median_resolve_minutes', t("Median resolve time"), t("Inbox"), '', '', response.resolve.medianMs === null ? '' : Math.round(response.resolve.medianMs / 60_000), 'minutes', t("{v0} resolved", { v0: response.resolve.resolved }), t("First visitor message in the period to resolved; calendar time; unresolved conversations excluded, not zero")]);
      rows.push(['response_time', 'unresolved_conversations', t("Not resolved"), t("Inbox"), '', '', response.resolve.unresolved, 'waits', response.partial ? 'partial' : '', t("Conversations with a visitor message in the period and no valid resolved time")]);
    }
  }
  if (goals) for (const g of goals.goals) rows.push(['goal', g.metric, g.label, t("Goals"), '', goals.month.start, g.actual ?? '', 'target ' + g.target, `${g.percent}%`, t("{v0}; month {v1} to {v2} ({v3})", { v0: g.paceLabel, v1: goals.month.start, v2: goals.month.end, v3: goals.month.timeZone })]);
  if (included.includes('destinations')) {
    if (destination) {
      rows.push(['destination', 'posts_published', t("Posts published"), t("Published posts"), destination.name, '', destination.posts, 'posts', '', t("Channel type {v0}; count in period", { v0: destination.type })]);
      for (const m of destination.measures) rows.push(['destination_measure', m.key, m.label, t("Stored post insights"), destination.name, '', m.value ?? '', 'count', t("{v0} of {v1} posts", { v0: m.measuredPosts, v1: destination.posts }), t("Sum of stored per-post values; missing is not zero")]);
      rows.push(['destination_measure', 'link_clicks_lifetime', t("Link clicks (lifetime)"), t("Short links"), destination.name, '', destination.linkClicks ?? '', 'clicks', '', t("Lifetime clicks, not clicks in the period; destination-attributed links plus unambiguous legacy links only ({v0} shared posts)", { v0: destination.sharedPosts })]);
    } else rows.push(['destination', 'unavailable', t("Destination summary"), '', '', '', '', '', '', t("Not available")]);
  }
  if (topPosts) topPosts.forEach((p, i) => {
    rows.push(['top_post', `rank_${i + 1}`, postTitle(p), p.rankLabel, p.url ?? '', p.publishedAt, p.rankValue ?? '', p.rankLabel.toLowerCase(), '', t("Stored per-post measures; missing is not zero")]);
    for (const m of p.measures) rows.push(['top_post_measure', m.key, m.label, p.rankLabel, postTitle(p), p.publishedAt, m.value ?? '', '', '', t("Rank {v0}", { v0: i + 1 })]);
  });
  if (included.includes('published')) for (const [k, v] of Object.entries(snapshot.publishing)) rows.push(['publishing', k, k, '', '', '', v, 'posts', '', t("Count in period")]);
  for (const m of metrics) {
    const agg = [m.aggregationLabel, m.aggregationNote].filter(Boolean).join('. ');
    rows.push(['summary', m.key, m.label, m.sourceLabel, '', m.latestAt, m.total === null ? '' : (m.displayTotal ?? m.total), m.unit, coverageText(m), agg]);
    for (const p of m.points) rows.push(['point', m.key, m.label, m.sourceLabel, '', p.date, p.value, m.unit, coverageText(m), agg]);
    for (const r of m.rows) rows.push(['resource_or_category', m.key, m.label, m.sourceLabel, r.label, r.asOf, r.value, m.unit, coverageText(m), agg]);
  }
  const line = (row: unknown[]) => row.map(csvCell).join(',');
  const csvOf = (count: number, marked: boolean) => [line(header), ...rows.slice(0, count).map(line), ...(marked ? [line(['truncated', 'true'])] : [])].join('\r\n') + '\r\n';
  const rowCap = Math.min(rows.length, bounds.maxRows);
  const csvRows = fit(rowCap, bounds.maxBytes, c => csvOf(c, true));
  const csvTruncated = csvRows < rows.length;
  // The header plus the marker alone may exceed a tiny bound: cut at a character boundary rather than overflow.
  const csvRaw = csvOf(csvRows, csvTruncated);
  const csv = cutBytes(csvRaw, bounds.maxBytes);

  // JSON: the same rows as records (empty cell = null), cut at the same row and byte limits; a cut never yields invalid JSON.
  const records = (count: number) => rows.slice(0, count).map(row => Object.fromEntries(header.map((key, i) => [key, row[i] === '' || row[i] === undefined ? null : row[i]])));
  const jsonOf = (count: number, marked: boolean) => JSON.stringify({ channel: channelName, period, generatedAt: input.generatedAt.toISOString(), sections: included, notIncluded, truncated: marked, columns: header, records: records(count) }) + '\n';
  const jsonRows = fit(rowCap, bounds.maxBytes, c => jsonOf(c, true));
  let jsonTruncated = jsonRows < rows.length;
  let json = jsonOf(jsonRows, jsonTruncated);
  if (bytes(json) > bounds.maxBytes) { json = '{"truncated":true}\n'; jsonTruncated = true; if (bytes(json) > bounds.maxBytes) json = ''; }

  // Printable HTML and plain text show the summary tier only (one row per metric).
  const title = t("Analytics report: {v0}, {v1} to {v2}", { v0: channelName, v1: period.start, v2: period.end });
  const audienceHtml = audience ? `<h2>${esc(t("Audience"))}</h2><p>${esc(t("{v0} of {v1} selected channels have audience data{v2}. This sum is not unique people across networks.", { v0: audience.covered, v1: audience.selected, v2: audienceAsOf ? t(", as of {v0}", { v0: asOf(audienceAsOf) }) : '' }))}</p><p><strong>${audience.covered ? esc(audience.total) : esc(t("Not available"))}</strong></p>` : '';
  const htmlOf = (count: number, marked: boolean) => {
    const shown = metrics.slice(0, count);
    return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#111}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #bbb;padding:.35rem .5rem;text-align:left}small{color:#555}@media print{body{margin:0}}</style></head><body>`
      + `<h1>${esc(title)}</h1><p><small>${esc(t('Generated {v0}. Values come from stored analytics; "Not available" means no data, not zero.', { v0: input.generatedAt.toISOString() }))}</small></p>`
      + (recap ? `<h2>${esc(t("AI recap"))}</h2><p><strong>${esc(t("AI-generated."))}</strong> <small>${esc(RECAP_LABEL)}</small></p><p>${esc(recapText)}</p>` : '')
      + (included.includes('published') ? `<h2>${esc(t("Published posts"))}</h2><p>${esc(t("Published {v0}, scheduled {v1}, failed {v2}.", { v0: snapshot.publishing.published, v1: snapshot.publishing.scheduled, v2: snapshot.publishing.failed }))}</p>` : '')
      + (response ? `<h2>${esc(t("Response time"))}</h2><p>${esc(responseLine)}</p>${responseDetails.map(line => `<p>${esc(line)}</p>`).join('')}${memberLines.length ? `<ul>${memberLines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${resolveLine ? `<p>${esc(resolveLine)}</p>` : ''}` : '')
      + (goals ? `<h2>${esc(t("Goals"))}</h2>${goals.goals.length ? `<p><small>${esc(t("Month {v0} to {v1} ({v2}), up to generation for the current month.", { v0: goals.month.start, v1: goals.month.end, v2: goals.month.timeZone }))}</small></p><table><thead><tr><th>${esc(t("Goal"))}</th><th>${esc(t("Target"))}</th><th>${esc(t("This month"))}</th><th>${esc(t("Progress"))}</th><th>${esc(t("Pace"))}</th></tr></thead><tbody>${goals.goals.map(g => `<tr><td>${esc(g.label)}</td><td>${esc(g.target)}</td><td>${g.actual === null ? esc(t("No data")) : esc(g.actual)}</td><td>${esc(g.percent)}%</td><td>${esc(g.paceLabel)}</td></tr>`).join('')}</tbody></table>` : `<p>${esc(t("No goals are set for this channel."))}</p>`}` : '')
      + (included.includes('destinations') ? `<h2>${esc(t("Destinations"))}</h2>${destination ? `<p><small>${esc(destinationNote)}</small></p><table><thead><tr><th>${esc(t("Destination"))}</th><th>${esc(t("Type"))}</th><th>${esc(t("Posts"))}</th>${destination.measures.map(m => `<th>${esc(m.label)}</th>`).join('')}<th>${esc(t("Link clicks (lifetime)"))}</th></tr></thead><tbody><tr><td>${esc(destination.name)}</td><td>${esc(destination.type)}</td><td>${esc(destination.posts)}</td>${destination.measures.map(m => `<td>${esc(measureText(m))}</td>`).join('')}<td>${esc(linkClicksText)}</td></tr></tbody></table><p><small>${esc(t("Link clicks are lifetime totals for links attributed to this channel. Legacy links without a destination count only when the post has a single published destination."))}</small></p>` : `<p>${esc(t("Destination summary not available."))}</p>`}` : '')
      + (topPosts ? `<h2>${esc(t("Top posts"))}</h2>${topPosts.length ? `<table><thead><tr><th>#</th><th>${esc(t("Post"))}</th><th>${esc(t("Published"))}</th><th>${esc(topPosts[0]!.rankLabel)}</th>${topPosts[0]!.measures.map(m => `<th>${esc(m.label)}</th>`).join('')}</tr></thead><tbody>${topPosts.map((p, i) => `<tr><td>${i + 1}</td><td>${p.url ? `<a href="${esc(p.url)}">${esc(postTitle(p))}</a>` : esc(postTitle(p))}</td><td>${esc(asOf(p.publishedAt))}</td><td>${p.rankValue === null ? esc(t("Not available")) : esc(p.rankValue)}</td>${p.measures.map(m => `<td>${m.value === null ? esc(t("Not available")) : esc(m.value)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : `<p>${esc(t("No published posts with stored measures in this period."))}</p>`}` : '')
      + audienceHtml
      + (metrics.length ? `<h2>${esc(t("Metrics"))}</h2><table><thead><tr><th>${esc(t("Metric"))}</th><th>${esc(t("Source"))}</th><th>${esc(t("Value"))}</th><th>${esc(t("Basis"))}</th><th>${esc(t("Coverage"))}</th><th>${esc(t("As of"))}</th></tr></thead><tbody>${shown.map(m => `<tr><td>${esc(m.label)}</td><td>${esc(m.sourceLabel)}</td><td>${esc(valueText(m))}</td><td>${esc([m.aggregationLabel, m.aggregationNote].filter(Boolean).join('. '))}</td><td>${esc(coverageText(m))}</td><td>${esc(asOf(m.latestAt))}</td></tr>`).join('')}</tbody></table>` : '')
      + (marked ? `<p><strong>${esc(t("This report was shortened to fit its size limit."))}</strong></p>` : '')
      + (notIncluded.length ? `<p><small>${esc(t("Not included: {v0} (not available in this report yet).", { v0: notIncluded.join(', ') }))}</small></p>` : '') + '</body></html>';
  };
  const metricCap = Math.min(metrics.length, bounds.maxRows);
  const htmlCount = fit(metricCap, bounds.maxBytes, c => htmlOf(c, true));
  let htmlTruncated = htmlCount < metrics.length;
  let html = htmlOf(htmlCount, htmlTruncated);
  if (bytes(html) > bounds.maxBytes) { // the fixed parts alone do not fit
    html = cutBytes(`<!doctype html><html lang="${locale}"><body><p>${esc(clamp(title, 80))}</p><p><strong>${esc(t("This report was shortened to fit its size limit."))}</strong></p></body></html>`, bounds.maxBytes);
    htmlTruncated = true;
  }
  const baseLines = [title, '', ...(recap ? [t("AI recap (AI-generated; {v0})", { v0: RECAP_LABEL }), recapText, ''] : []), ...(included.includes('published') ? [t("Published {v0}, scheduled {v1}, failed {v2}.", { v0: snapshot.publishing.published, v1: snapshot.publishing.scheduled, v2: snapshot.publishing.failed })] : []),
    ...(response ? [t("Response time: {v0}", { v0: responseLine }), ...responseDetails, ...memberLines.map(l => `  ${l}`), ...(resolveLine ? [resolveLine] : [])] : []),
    ...(goals ? [t("Goals (month {v0} to {v1}):", { v0: goals.month.start, v1: goals.month.end }), ...(goals.goals.length ? goals.goals.map(goalText) : [t("No goals are set for this channel.")])] : []),
    ...(included.includes('destinations') ? [t("Destinations:"), ...(destination ? [t("{v0} ({v1}): {v2} posts; {v3}; link clicks (lifetime) {v4}", { v0: clamp(destination.name, 200), v1: destination.type, v2: destination.posts, v3: destination.measures.map(m => `${m.label} ${measureText(m)}`).join('; '), v4: linkClicksText })] : [t("Destination summary not available.")])] : []),
    ...(topPosts ? [t("Top posts:"), ...(topPosts.length ? topPosts.map((p, i) => `${i + 1}. ${postTitle(p)} (${asOf(p.publishedAt)}): ${p.rankLabel} ${p.rankValue ?? t("Not available")}`) : [t("No published posts with stored measures in this period.")])] : []),
    ...(audience ? [t("Audience: {v0} ({v1} of {v2} channels{v3}; not unique people)", { v0: audience.covered ? audience.total : t("Not available"), v1: audience.covered, v2: audience.selected, v3: audienceAsOf ? t("; as of {v0}", { v0: asOf(audienceAsOf) }) : '' })] : [])];
  const metricLines = metrics.map(m => t("{v0} ({v1}): {v2}; {v3}; as of {v4}", { v0: clamp(m.label, 200), v1: clamp(m.sourceLabel, 200), v2: valueText(m), v3: coverageText(m), v4: asOf(m.latestAt) }));
  const tail = (cut: boolean) => [...(cut ? [t("Shortened to fit the size limit.")] : []), ...(notIncluded.length ? [t("Not included: {v0}", { v0: notIncluded.join(', ') })] : [])];
  const textOf = (count: number, cut: boolean) => [...baseLines, ...metricLines.slice(0, count), ...tail(cut)].join('\n');
  const textCount = fit(metricCap, bounds.maxBytes, c => textOf(c, true));
  let textTruncated = textCount < metricLines.length;
  let text = textOf(textCount, textTruncated);
  if (bytes(text) > bounds.maxBytes) { text = cutBytes(text, bounds.maxBytes); textTruncated = true; }
  return { channelName, period, generatedAt: input.generatedAt.toISOString(), sections: included, notIncluded, csv, html, text, json, rowCount: csvRows, bytes: bytes(csv), htmlBytes: bytes(html), textBytes: bytes(text), jsonBytes: bytes(json), truncated: csvTruncated || htmlTruncated || textTruncated || jsonTruncated || csv !== csvRaw };
}

const RECAP_FACT_CHARS = 4000;
const factText = (text: unknown) => String(text ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
/**
 * Compact, bounded figures for the AI recap: only what the other chosen sections already compute and the actor is already
 * authorized to read. No post text, URLs, message text or recipients are included; missing data is stated as such, never zero.
 * Returns '' when no other section supplies a figure.
 */
export function recapFacts(snapshot: Snapshot, input: { sections: ReportSectionId[]; responseTime?: ResponseTimeSummary | null; topPosts?: PostPerformance[] | null; destination?: DestinationSummary | null; goals?: { month: GoalMonth; goals: GoalProgress[] } | null }): string {
  const wanted = new Set(input.sections);
  const lines: string[] = [];
  if (wanted.has('published')) lines.push(`Posts: published ${snapshot.publishing.published}, scheduled ${snapshot.publishing.scheduled}, failed ${snapshot.publishing.failed}.`);
  if (wanted.has('audience') && snapshot.audience) lines.push(`Audience: ${snapshot.audience.covered ? snapshot.audience.total : 'Not available'} (${snapshot.audience.covered} of ${snapshot.audience.selected} channels; not unique people).`);
  if (wanted.has('responseTime') && input.responseTime) lines.push(`Median first response ${input.responseTime.businessHours ? `${responseDuration(input.responseTime.businessMedianMs)} in business hours, ${responseDuration(input.responseTime.medianMs)} in calendar time` : `${responseDuration(input.responseTime.medianMs)} in calendar time (no business hours set)`}; ${input.responseTime.answered} answered, ${input.responseTime.unanswered} waiting.`);
  if (wanted.has('goals') && input.goals?.goals.length) for (const g of input.goals.goals.slice(0, 20)) lines.push(`Goal ${factText(g.label)}: ${g.actual === null ? 'No data' : g.actual} of ${g.target} (${g.percent}%, ${factText(g.paceLabel)}).`);
  const d = wanted.has('destinations') ? input.destination : null;
  if (d) lines.push(`Destination: ${d.posts} posts published; ${d.measures.map(m => `${factText(m.label)} ${m.value ?? 'Not available'}`).join('; ')}.`);
  if (wanted.has('topPosts') && input.topPosts?.length) lines.push(`Top posts: ${input.topPosts.length} ranked by ${factText(input.topPosts[0]!.rankLabel)}; best has ${input.topPosts[0]!.rankValue ?? 'Not available'}.`);
  // Longest, least essential lines last so a cut never drops the compact figures.
  if (wanted.has('analysis')) for (const m of snapshot.allMetrics.filter(x => x.resourceKind === 'channel').slice(0, 25)) {
    const first = m.points.length ? m.points[0]!.value : null; const last = m.points.length ? m.points[m.points.length - 1]!.value : null;
    lines.push(`${factText(m.label).slice(0, 80)}: ${valueText(m)} (${coverageText(m)})${m.total !== null && first !== null && last !== null && m.points.length > 1 ? `; first day ${first}, last day ${last}` : ''}.`);
  }
  const text = lines.join('\n');
  return text.length > RECAP_FACT_CHARS ? text.slice(0, RECAP_FACT_CHARS) : text;
}

/**
 * The module's report builder; a host registers it. It re-checks the actor's current authority (including key ceilings and
 * the channel's connection/platform state) and reads only through the shared scoped Analytics reader, one channel at a time.
 * The actor's result ceiling bounds the generated rows themselves, not just list pages.
 */
export function createReportGenerator(deps: { bounds: () => Promise<ReportBounds>; now?: () => Date; recap?: RecapWriter }): ReportGenerationPort {
  return {
    async generate(request: ReportGenerationRequest): Promise<ReportGenerationResult> {
      try {
        const { actor } = request;
        if (!request.sections.some(s => s !== 'aiRecap' && (REPORT_SUPPORTED_SECTIONS as readonly string[]).includes(s))) return { ok: false, reason: 'no_supported_sections' };
        const auth = await authorizeReport(actor, 'read');
        if (auth.scope !== null && !auth.scope.includes(request.channelId)) return { ok: false, reason: 'channel_unavailable' };
        if (!(await usableChannelIds(prisma, actor.workspaceId, auth.providers, [request.channelId])).length) return { ok: false, reason: 'channel_unavailable' };
        const documentCopy = await loadReportDocumentCopy();
        const readActor = { userId: actor.userId, workspaceId: actor.workspaceId, allowedAdAccountIds: actor.allowedAdAccountIds, adAccountTargetScope: actor.adAccountTargetScope };
        const snapshot = await readAnalyticsSnapshot(readActor, { start: request.period.start, end: request.period.end, compare: 'none', filter: '1', channel: request.channelId, adFilter: '1' }, { feature: 'analytics/reports', allowedChannelIds: [request.channelId] });
        if (snapshot.selected.channelIds.length !== 1 || snapshot.selected.channelIds[0] !== request.channelId) return { ok: false, reason: 'channel_unavailable' };
        const channel = snapshot.options.channels.find(c => c.id === request.channelId);
        const base = await deps.bounds();
        const ceiling = resultCeiling(actor);
        const bounds = { maxRows: ceiling === undefined ? base.maxRows : Math.min(base.maxRows, ceiling), maxBytes: base.maxBytes };
        const responseTime = request.sections.includes('responseTime') ? await readResponseTime(actor.workspaceId, request.channelId, request.period, documentCopy.locale) : null;
        const topPosts = request.sections.includes('topPosts') ? await readTopPosts(actor.workspaceId, request.channelId, request.period) : null;
        const destination = request.sections.includes('destinations') ? await readDestination(actor.workspaceId, request.channelId, request.period) : null;
        const goals = request.sections.includes('goals') ? await channelGoalProgress(actor.workspaceId, request.channelId, request.period.end, deps.now?.() ?? new Date(), documentCopy.locale) : null;
        const recap = request.sections.includes('aiRecap') ? await makeRecap(deps.recap ?? defaultRecap, actor, channel?.name ?? documentText(documentCopy.copy)('Channel'), snapshot, { sections: request.sections, responseTime, topPosts, destination, goals }, documentCopy.locale) : null;
        return { ok: true, output: renderReport(snapshot, { channelName: channel?.name ?? documentText(documentCopy.copy)('Channel'), sections: request.sections, responseTime, topPosts, destination, goals, recap, generatedAt: deps.now?.() ?? new Date() }, bounds, documentCopy.copy, documentCopy.locale, documentCopy.responseCopy) };
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
        return { ok: false, reason: code === 'unauthorized' || code === 'forbidden' ? 'access_unavailable' : 'generation_failed' };
      }
    },
  };
}

/**
 * Ask for the recap under the run's own actor (the schedule owner for scheduled runs; the AI module re-authorizes and applies the
 * shared workspace limit). AI off or no AI access: null, so the section is listed as not included. Rate limit, provider failure or
 * an unusable answer: the report still succeeds and the section says the recap is unavailable. Nothing is invented.
 */
async function makeRecap(write: RecapWriter, actor: ReportActor, channelName: string, snapshot: Snapshot, parts: Parameters<typeof recapFacts>[1], locale: 'en' | 'fr'): Promise<RecapState | null> {
  const facts = recapFacts(snapshot, parts);
  if (!facts) return { state: 'unavailable' };
  try {
    const out = await write({ userId: actor.userId, workspaceId: actor.workspaceId, permissionCeiling: actor.permissionCeiling }, { facts, subject: `${factText(channelName).slice(0, 100)}, ${snapshot.period.start} to ${snapshot.period.end}`, language: locale === 'fr' ? 'French' : 'English' });
    const text = typeof out?.text === 'string' ? out.text.trim() : '';
    return text ? { state: 'ready', text } : { state: 'unavailable' };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
    return code === 'unavailable' || code === 'forbidden' || code === 'unauthorized' ? null : { state: 'unavailable' };
  }
}

/** Ten best posts by the channel's own module ranking; a module without the hook yields an empty, honest section. */
export const TOP_POSTS_LIMIT = 10;
async function readTopPosts(workspaceId: string, channelId: string, period: { start: string; end: string }): Promise<PostPerformance[]> {
  const rows = await prisma.$queryRaw<Array<{ provider: string }>>`SELECT a.provider FROM targets t JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId" WHERE t.id = ${channelId} AND t."workspaceId" = ${workspaceId} LIMIT 1`;
  const provider = rows[0]?.provider;
  const analytics = provider ? await platformAnalytics(provider) : null;
  if (!analytics?.postPerformance) return [];
  const from = new Date(`${period.start}T00:00:00.000Z`);
  const to = new Date(new Date(`${period.end}T00:00:00.000Z`).getTime() + 86_400_000);
  return analytics.postPerformance({ workspaceId, targetId: channelId, from, to, limit: TOP_POSTS_LIMIT });
}

/** Per-destination summary for one channel: neutral counts from stored publications and short links, platform measures through the module hook (stored data only). */
async function readDestination(workspaceId: string, channelId: string, period: { start: string; end: string }): Promise<DestinationSummary | null> {
  const from = new Date(`${period.start}T00:00:00.000Z`);
  const to = new Date(new Date(`${period.end}T00:00:00.000Z`).getTime() + 86_400_000);
  const rows = await prisma.$queryRaw<Array<{ name: string; type: string; provider: string }>>`SELECT t.name, t.type, a.provider FROM targets t JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId" WHERE t.id = ${channelId} AND t."workspaceId" = ${workspaceId} LIMIT 1`;
  const target = rows[0];
  if (!target) return null;
  const counts = await prisma.$queryRaw<Array<{ posts: number | bigint; shared: number | bigint; clicks: number | bigint | null }>>`
    WITH mine AS (SELECT DISTINCT pt."postId" FROM post_targets pt JOIN posts p ON p.id = pt."postId" WHERE pt."targetId" = ${channelId} AND p."workspaceId" = ${workspaceId} AND pt.status = 'published' AND pt."publishedAt" >= ${from} AND pt."publishedAt" < ${to}),
    spread AS (SELECT m."postId", (SELECT COUNT(DISTINCT pt2."targetId") FROM post_targets pt2 WHERE pt2."postId" = m."postId" AND pt2.status = 'published') AS destinations FROM mine m)
    SELECT (SELECT COUNT(*) FROM mine) AS posts,
      (SELECT COUNT(*) FROM spread WHERE destinations > 1) AS shared,
      (SELECT SUM(sl."clickCount") FROM short_links sl JOIN spread s ON s."postId" = sl."postId" WHERE sl."workspaceId" = ${workspaceId} AND (sl."targetId" = ${channelId} OR (sl."targetId" IS NULL AND s.destinations = 1))) AS clicks`;
  const count = counts[0];
  const analytics = await platformAnalytics(target.provider);
  const measured = analytics?.destinationMeasures ? await analytics.destinationMeasures({ workspaceId, targetId: channelId, from, to }) : { measures: [] };
  return { name: clamp(target.name, 200), type: target.type, posts: Number(count?.posts ?? 0), sharedPosts: Number(count?.shared ?? 0), linkClicks: count?.clicks == null ? null : Number(count.clicks), measures: measured.measures };
}
