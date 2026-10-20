import type { MetricView } from '@/modules/analytics/server/aggregate';
import { readAnalyticsSnapshot } from '../../server/read';
import { REPORT_SECTION_IDS, REPORT_SUPPORTED_SECTIONS, type ReportActor, type ReportGenerationPort, type ReportGenerationRequest, type ReportGenerationResult, type ReportOutput, type ReportSectionId } from '../contracts';
import { authorizeReport, resultCeiling, usableChannelIds } from '../server/access';
import { prisma } from '@/server/data';
import { platformAnalytics } from '@/server/platforms/registry';
import type { DestinationMeasures, PostPerformance } from '@/server/platforms/host';
import { channelGoalProgress } from '../../goals/server/goals';
import type { GoalMonth, GoalProgress } from '../../goals/contracts';
import { describeBusinessHours, formatDuration, readResponseTime, type ResponseTimeSummary } from './response-time';

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
export const RECAP_LABEL = 'AI-generated summary of the figures in this report. It may contain mistakes; check it against the figures.';
export const RECAP_UNAVAILABLE = 'The AI recap is unavailable for this run. The figures below are unaffected.';
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
export function renderReport(snapshot: Snapshot, input: { channelName: string; sections: ReportSectionId[]; generatedAt: Date; responseTime?: ResponseTimeSummary | null; topPosts?: PostPerformance[] | null; destination?: DestinationSummary | null; goals?: { month: GoalMonth; goals: GoalProgress[] } | null; recap?: RecapState | null }, bounds: ReportBounds): ReportOutput {
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
    ? `Business hours (${describeBusinessHours(response.businessHours)}): median first response ${formatDuration(response.businessMedianMs)}, counting only time inside business hours. Calendar time: median first response ${formatDuration(response.medianMs)}.`
    : `Calendar time: median first response ${formatDuration(response.medianMs)}. Business hours are not set for this workspace, so no business-hours figure is shown.`) : '';
  const responseLine = response ? `${responseBasis} ${response.answered} answered, ${response.unanswered} waiting at period end. From stored Inbox messages${response.partial ? '; only the earliest messages were read' : ''}.` : '';
  const memberLine = (m: { name: string; answered: number; medianMs: number | null }) => `${clamp(m.name, 80)}: ${m.answered} answered, median first response ${formatDuration(m.medianMs)}`;
  const memberLines = response?.members ? [...response.members.map(memberLine), ...(response.membersOmitted ? [`${response.membersOmitted} more not listed`] : [])] : [];
  const resolveLine = response?.resolve ? `Resolve time: median ${formatDuration(response.resolve.medianMs)} from the first visitor message to resolved; ${response.resolve.resolved} resolved, ${response.resolve.unresolved} not resolved (not counted as zero).` : '';
  const recap = included.includes('aiRecap') ? input.recap ?? null : null;
  const recapText = recap ? (recap.state === 'ready' ? recap.text : RECAP_UNAVAILABLE) : '';
  const topPosts = included.includes('topPosts') ? input.topPosts ?? [] : null;
  const destination = included.includes('destinations') ? input.destination ?? null : null;
  const destinationNote = destination ? `Stored values summed over ${destination.posts} published post${destination.posts === 1 ? '' : 's'}; a measure no post has stored is Not available, not zero.` : '';
  const linkClicksText = destination ? (destination.linkClicks === null ? 'Not available' : String(destination.linkClicks)) : '';
  const measureText = (m: DestinationMeasures['measures'][number]) => m.value === null ? 'Not available' : `${m.value}${m.measuredPosts < (destination?.posts ?? 0) ? ` (stored for ${m.measuredPosts} of ${destination?.posts} posts)` : ''}`;
  const postTitle = (p: PostPerformance) => clamp(p.text || '(no text)', 120);
  const goals = included.includes('goals') ? input.goals ?? { month: { month: '', start: '', end: '', timeZone: '' }, goals: [] } : null;
  const goalText = (g: GoalProgress) => `${g.label}: ${g.actual === null ? 'No data' : g.actual} of ${g.target} (${g.percent}%, ${g.paceLabel})`;
  const audienceAsOf = audience ? audience.entries.map(e => e.asOf).filter((d): d is Date => d instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0] : undefined;

  // CSV: long form, one row per summary/point/resource, cut at the row and byte limits.
  const header = ['record_type', 'metric_key', 'metric', 'source', 'resource', 'date', 'value', 'unit', 'coverage', 'aggregation'];
  const rows: unknown[][] = [];
  if (recap) rows.push(['ai_recap', 'ai_recap', 'AI recap (AI-generated)', 'AI-generated', '', '', recap.state === 'ready' ? recap.text : '', '', '', recap.state === 'ready' ? RECAP_LABEL : RECAP_UNAVAILABLE]);
  if (audience) for (const e of audience.entries) rows.push(['audience', e.metric, e.metricLabel, e.sourceLabel, e.name, e.asOf, e.value, 'people', `${audience.covered} of ${audience.selected} channels`, 'Latest value per channel; not unique people']);
  if (response) {
    rows.push(['response_time', 'median_first_response_minutes', 'Median first response (calendar time)', 'Inbox', '', '', response.medianMs === null ? '' : Math.round(response.medianMs / 60_000), 'minutes', response.partial ? 'partial' : '', 'Median wait until the channel replied; calendar time']);
    rows.push(['response_time', 'median_first_response_business_minutes', 'Median first response (business hours)', 'Inbox', '', '', response.businessHours && response.businessMedianMs !== null ? Math.round(response.businessMedianMs / 60_000) : '', 'minutes', response.businessHours ? (response.partial ? 'partial' : '') : 'not set', response.businessHours ? `Median wait counting only business hours: ${describeBusinessHours(response.businessHours)}` : 'Business hours are not set for this workspace; no figure']);
    rows.push(['response_time', 'answered_waits', 'Answered waits', 'Inbox', '', '', response.answered, 'waits', '', 'Count in period']);
    rows.push(['response_time', 'unanswered_waits', 'Waiting at period end', 'Inbox', '', '', response.unanswered, 'waits', '', 'Count at period end']);
    for (const m of response.members ?? []) rows.push(['response_time', 'member_first_response_minutes', 'Median first response by member', 'Inbox', clamp(m.name, 80), '', m.medianMs === null ? '' : Math.round(m.medianMs / 60_000), 'minutes', `${m.answered} answered`, m.memberId === null ? 'Replies sent outside the app; calendar time' : 'Replies sent through this app; calendar time']);
    if (response.resolve) {
      rows.push(['response_time', 'median_resolve_minutes', 'Median resolve time', 'Inbox', '', '', response.resolve.medianMs === null ? '' : Math.round(response.resolve.medianMs / 60_000), 'minutes', `${response.resolve.resolved} resolved`, 'First visitor message in the period to resolved; calendar time; unresolved conversations excluded, not zero']);
      rows.push(['response_time', 'unresolved_conversations', 'Not resolved', 'Inbox', '', '', response.resolve.unresolved, 'conversations', '', 'Conversations with a visitor message in the period and no valid resolved time']);
    }
  }
  if (goals) for (const g of goals.goals) rows.push(['goal', g.metric, g.label, 'Goals', '', goals.month.start, g.actual ?? '', 'target ' + g.target, `${g.percent}%`, `${g.paceLabel}; month ${goals.month.start} to ${goals.month.end} (${goals.month.timeZone})`]);
  if (included.includes('destinations')) {
    if (destination) {
      rows.push(['destination', 'posts_published', 'Posts published', 'Published posts', destination.name, '', destination.posts, 'posts', '', `Channel type ${destination.type}; count in period`]);
      for (const m of destination.measures) rows.push(['destination_measure', m.key, m.label, 'Stored post insights', destination.name, '', m.value ?? '', 'count', `${m.measuredPosts} of ${destination.posts} posts`, 'Sum of stored per-post values; missing is not zero']);
      rows.push(['destination_measure', 'link_clicks_lifetime', 'Link clicks (lifetime)', 'Short links', destination.name, '', destination.linkClicks ?? '', 'clicks', '', `Lifetime clicks, not clicks in the period; posts that also went to other channels (${destination.sharedPosts}) are not counted`]);
    } else rows.push(['destination', 'unavailable', 'Destination summary', '', '', '', '', '', '', 'Not available']);
  }
  if (topPosts) topPosts.forEach((p, i) => {
    rows.push(['top_post', `rank_${i + 1}`, postTitle(p), p.rankLabel, p.url ?? '', p.publishedAt, p.rankValue ?? '', p.rankLabel.toLowerCase(), '', 'Stored per-post measures; missing is not zero']);
    for (const m of p.measures) rows.push(['top_post_measure', m.key, m.label, p.rankLabel, postTitle(p), p.publishedAt, m.value ?? '', '', '', `Rank ${i + 1}`]);
  });
  if (included.includes('published')) for (const [k, v] of Object.entries(snapshot.publishing)) rows.push(['publishing', k, k, '', '', '', v, 'posts', '', 'Count in period']);
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
  const title = `Analytics report: ${channelName}, ${period.start} to ${period.end}`;
  const audienceHtml = audience ? `<h2>Audience</h2><p>${esc(audience.covered)} of ${esc(audience.selected)} selected channels have audience data${audienceAsOf ? `, as of ${asOf(audienceAsOf)}` : ''}. This sum is not unique people across networks.</p><p><strong>${audience.covered ? esc(audience.total) : 'Not available'}</strong></p>` : '';
  const htmlOf = (count: number, marked: boolean) => {
    const shown = metrics.slice(0, count);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#111}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #bbb;padding:.35rem .5rem;text-align:left}small{color:#555}@media print{body{margin:0}}</style></head><body>`
      + `<h1>${esc(title)}</h1><p><small>Generated ${esc(input.generatedAt.toISOString())}. Values come from stored analytics; "Not available" means no data, not zero.</small></p>`
      + (recap ? `<h2>AI recap</h2><p><strong>AI-generated.</strong> <small>${esc(RECAP_LABEL)}</small></p><p>${esc(recapText)}</p>` : '')
      + (included.includes('published') ? `<h2>Published posts</h2><p>Published ${esc(snapshot.publishing.published)}, scheduled ${esc(snapshot.publishing.scheduled)}, failed ${esc(snapshot.publishing.failed)}.</p>` : '')
      + (response ? `<h2>Response time</h2><p>${esc(responseLine)}</p>${memberLines.length ? `<ul>${memberLines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${resolveLine ? `<p>${esc(resolveLine)}</p>` : ''}` : '')
      + (goals ? `<h2>Goals</h2>${goals.goals.length ? `<p><small>Month ${esc(goals.month.start)} to ${esc(goals.month.end)} (${esc(goals.month.timeZone)}), up to generation for the current month.</small></p><table><thead><tr><th>Goal</th><th>Target</th><th>This month</th><th>Progress</th><th>Pace</th></tr></thead><tbody>${goals.goals.map(g => `<tr><td>${esc(g.label)}</td><td>${esc(g.target)}</td><td>${g.actual === null ? 'No data' : esc(g.actual)}</td><td>${esc(g.percent)}%</td><td>${esc(g.paceLabel)}</td></tr>`).join('')}</tbody></table>` : '<p>No goals are set for this channel.</p>'}` : '')
      + (included.includes('destinations') ? `<h2>Destinations</h2>${destination ? `<p><small>${esc(destinationNote)}</small></p><table><thead><tr><th>Destination</th><th>Type</th><th>Posts</th>${destination.measures.map(m => `<th>${esc(m.label)}</th>`).join('')}<th>Link clicks (lifetime)</th></tr></thead><tbody><tr><td>${esc(destination.name)}</td><td>${esc(destination.type)}</td><td>${esc(destination.posts)}</td>${destination.measures.map(m => `<td>${esc(measureText(m))}</td>`).join('')}<td>${esc(linkClicksText)}</td></tr></tbody></table><p><small>Link clicks are lifetime totals for posts that went only to this channel${destination.sharedPosts ? `; ${esc(destination.sharedPosts)} shared post${destination.sharedPosts === 1 ? ' is' : 's are'} not counted` : ''}.</small></p>` : '<p>Destination summary not available.</p>'}` : '')
      + (topPosts ? `<h2>Top posts</h2>${topPosts.length ? `<table><thead><tr><th>#</th><th>Post</th><th>Published</th><th>${esc(topPosts[0]!.rankLabel)}</th>${topPosts[0]!.measures.map(m => `<th>${esc(m.label)}</th>`).join('')}</tr></thead><tbody>${topPosts.map((p, i) => `<tr><td>${i + 1}</td><td>${p.url ? `<a href="${esc(p.url)}">${esc(postTitle(p))}</a>` : esc(postTitle(p))}</td><td>${asOf(p.publishedAt)}</td><td>${p.rankValue === null ? 'Not available' : esc(p.rankValue)}</td>${p.measures.map(m => `<td>${m.value === null ? 'Not available' : esc(m.value)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p>No published posts with stored measures in this period.</p>'}` : '')
      + audienceHtml
      + (metrics.length ? `<h2>Metrics</h2><table><thead><tr><th>Metric</th><th>Source</th><th>Value</th><th>Basis</th><th>Coverage</th><th>As of</th></tr></thead><tbody>${shown.map(m => `<tr><td>${esc(m.label)}</td><td>${esc(m.sourceLabel)}</td><td>${esc(valueText(m))}</td><td>${esc([m.aggregationLabel, m.aggregationNote].filter(Boolean).join('. '))}</td><td>${esc(coverageText(m))}</td><td>${asOf(m.latestAt)}</td></tr>`).join('')}</tbody></table>` : '')
      + (marked ? `<p><strong>This report was shortened to fit its size limit.</strong></p>` : '')
      + (notIncluded.length ? `<p><small>Not included: ${esc(notIncluded.join(', '))} (not available in this report yet).</small></p>` : '') + '</body></html>';
  };
  const metricCap = Math.min(metrics.length, bounds.maxRows);
  const htmlCount = fit(metricCap, bounds.maxBytes, c => htmlOf(c, true));
  let htmlTruncated = htmlCount < metrics.length;
  let html = htmlOf(htmlCount, htmlTruncated);
  if (bytes(html) > bounds.maxBytes) { // the fixed parts alone do not fit
    html = cutBytes(`<!doctype html><html lang="en"><body><p>${esc(clamp(title, 80))}</p><p><strong>This report was shortened to fit its size limit.</strong></p></body></html>`, bounds.maxBytes);
    htmlTruncated = true;
  }
  const baseLines = [title, '', ...(recap ? [`AI recap (AI-generated; ${RECAP_LABEL})`, recapText, ''] : []), ...(included.includes('published') ? [`Published ${snapshot.publishing.published}, scheduled ${snapshot.publishing.scheduled}, failed ${snapshot.publishing.failed}.`] : []),
    ...(response ? [`Response time: ${responseLine}`, ...memberLines.map(l => `  ${l}`), ...(resolveLine ? [resolveLine] : [])] : []),
    ...(goals ? [`Goals (month ${goals.month.start} to ${goals.month.end}):`, ...(goals.goals.length ? goals.goals.map(goalText) : ['No goals are set for this channel.'])] : []),
    ...(included.includes('destinations') ? ['Destinations:', ...(destination ? [`${clamp(destination.name, 200)} (${destination.type}): ${destination.posts} posts; ${destination.measures.map(m => `${m.label} ${measureText(m)}`).join('; ')}; link clicks (lifetime) ${linkClicksText}`] : ['Destination summary not available.'])] : []),
    ...(topPosts ? ['Top posts:', ...(topPosts.length ? topPosts.map((p, i) => `${i + 1}. ${postTitle(p)} (${asOf(p.publishedAt)}): ${p.rankLabel} ${p.rankValue ?? 'Not available'}`) : ['No published posts with stored measures in this period.'])] : []),
    ...(audience ? [`Audience: ${audience.covered ? audience.total : 'Not available'} (${audience.covered} of ${audience.selected} channels${audienceAsOf ? `; as of ${asOf(audienceAsOf)}` : ''}; not unique people)`] : [])];
  const metricLines = metrics.map(m => `${clamp(m.label, 200)} (${clamp(m.sourceLabel, 200)}): ${valueText(m)}; ${coverageText(m)}; as of ${asOf(m.latestAt)}`);
  const tail = (cut: boolean) => [...(cut ? ['Shortened to fit the size limit.'] : []), ...(notIncluded.length ? [`Not included: ${notIncluded.join(', ')}`] : [])];
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
  if (wanted.has('responseTime') && input.responseTime) lines.push(`Median first response ${input.responseTime.businessHours ? `${formatDuration(input.responseTime.businessMedianMs)} in business hours, ${formatDuration(input.responseTime.medianMs)} in calendar time` : `${formatDuration(input.responseTime.medianMs)} in calendar time (no business hours set)`}; ${input.responseTime.answered} answered, ${input.responseTime.unanswered} waiting.`);
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
        const readActor = { userId: actor.userId, workspaceId: actor.workspaceId, allowedAdAccountIds: actor.allowedAdAccountIds, adAccountTargetScope: actor.adAccountTargetScope };
        const snapshot = await readAnalyticsSnapshot(readActor, { start: request.period.start, end: request.period.end, compare: 'none', filter: '1', channel: request.channelId, adFilter: '1' }, { feature: 'analytics/reports', allowedChannelIds: [request.channelId] });
        if (snapshot.selected.channelIds.length !== 1 || snapshot.selected.channelIds[0] !== request.channelId) return { ok: false, reason: 'channel_unavailable' };
        const channel = snapshot.options.channels.find(c => c.id === request.channelId);
        const base = await deps.bounds();
        const ceiling = resultCeiling(actor);
        const bounds = { maxRows: ceiling === undefined ? base.maxRows : Math.min(base.maxRows, ceiling), maxBytes: base.maxBytes };
        const responseTime = request.sections.includes('responseTime') ? await readResponseTime(actor.workspaceId, request.channelId, request.period) : null;
        const topPosts = request.sections.includes('topPosts') ? await readTopPosts(actor.workspaceId, request.channelId, request.period) : null;
        const destination = request.sections.includes('destinations') ? await readDestination(actor.workspaceId, request.channelId, request.period) : null;
        const goals = request.sections.includes('goals') ? await channelGoalProgress(actor.workspaceId, request.channelId, request.period.end, deps.now?.() ?? new Date()) : null;
        const recap = request.sections.includes('aiRecap') ? await makeRecap(deps.recap ?? defaultRecap, actor, channel?.name ?? 'Channel', snapshot, { sections: request.sections, responseTime, topPosts, destination, goals }) : null;
        return { ok: true, output: renderReport(snapshot, { channelName: channel?.name ?? 'Channel', sections: request.sections, responseTime, topPosts, destination, goals, recap, generatedAt: deps.now?.() ?? new Date() }, bounds) };
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
async function makeRecap(write: RecapWriter, actor: ReportActor, channelName: string, snapshot: Snapshot, parts: Parameters<typeof recapFacts>[1]): Promise<RecapState | null> {
  const facts = recapFacts(snapshot, parts);
  if (!facts) return { state: 'unavailable' };
  try {
    const out = await write({ userId: actor.userId, workspaceId: actor.workspaceId, permissionCeiling: actor.permissionCeiling }, { facts, subject: `${factText(channelName).slice(0, 100)}, ${snapshot.period.start} to ${snapshot.period.end}`, language: 'English' });
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
    spread AS (SELECT m."postId", (SELECT COUNT(DISTINCT pt2."targetId") FROM post_targets pt2 WHERE pt2."postId" = m."postId" AND pt2.status = 'published' AND pt2."publishedAt" >= ${from} AND pt2."publishedAt" < ${to}) AS destinations FROM mine m)
    SELECT (SELECT COUNT(*) FROM mine) AS posts,
      (SELECT COUNT(*) FROM spread WHERE destinations > 1) AS shared,
      (SELECT COALESCE(SUM(sl."clickCount"), 0) FROM short_links sl JOIN spread s ON s."postId" = sl."postId" WHERE sl."workspaceId" = ${workspaceId} AND s.destinations = 1) AS clicks`;
  const count = counts[0];
  const analytics = await platformAnalytics(target.provider);
  const measured = analytics?.destinationMeasures ? await analytics.destinationMeasures({ workspaceId, targetId: channelId, from, to }) : { measures: [] };
  return { name: clamp(target.name, 200), type: target.type, posts: Number(count?.posts ?? 0), sharedPosts: Number(count?.shared ?? 0), linkClicks: count ? Number(count.clicks ?? 0) : null, measures: measured.measures };
}
