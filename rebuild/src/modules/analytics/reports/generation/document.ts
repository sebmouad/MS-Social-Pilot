import type { MetricView } from '@/modules/analytics/server/aggregate';
import { readAnalyticsSnapshot } from '../../server/read';
import { REPORT_SECTION_IDS, REPORT_SUPPORTED_SECTIONS, type ReportGenerationPort, type ReportGenerationRequest, type ReportGenerationResult, type ReportOutput, type ReportSectionId } from '../contracts';
import { authorizeReport, resultCeiling, usableChannelIds } from '../server/access';
import { prisma } from '@/server/data';
import { platformAnalytics } from '@/server/platforms/registry';
import type { PostPerformance } from '@/server/platforms/host';
import { formatDuration, readResponseTime, type ResponseTimeSummary } from './response-time';

export type ReportBounds = { maxRows: number; maxBytes: number };

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
export function renderReport(snapshot: Snapshot, input: { channelName: string; sections: ReportSectionId[]; generatedAt: Date; responseTime?: ResponseTimeSummary | null; topPosts?: PostPerformance[] | null }, bounds: ReportBounds): ReportOutput {
  const wanted = new Set(input.sections);
  const included = REPORT_SECTION_IDS.filter(s => wanted.has(s) && (REPORT_SUPPORTED_SECTIONS as readonly string[]).includes(s));
  const notIncluded = REPORT_SECTION_IDS.filter(s => wanted.has(s) && !included.includes(s));
  const period = { start: snapshot.period.start, end: snapshot.period.end };
  const channelName = clamp(input.channelName, 200);
  const metrics = included.includes('analysis') ? snapshot.allMetrics.filter(m => m.resourceKind === 'channel') : [];
  const audience = included.includes('audience') ? snapshot.audience : null;
  const response = included.includes('responseTime') ? input.responseTime ?? null : null;
  const responseLine = response ? `Median first response ${formatDuration(response.medianMs)}; ${response.answered} answered, ${response.unanswered} waiting at period end. Calendar time, from stored Inbox messages${response.partial ? '; only the earliest messages were read' : ''}.` : '';
  const topPosts = included.includes('topPosts') ? input.topPosts ?? [] : null;
  const postTitle = (p: PostPerformance) => clamp(p.text || '(no text)', 120);
  const audienceAsOf = audience ? audience.entries.map(e => e.asOf).filter((d): d is Date => d instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0] : undefined;

  // CSV: long form, one row per summary/point/resource, cut at the row and byte limits.
  const header = ['record_type', 'metric_key', 'metric', 'source', 'resource', 'date', 'value', 'unit', 'coverage', 'aggregation'];
  const rows: unknown[][] = [];
  if (audience) for (const e of audience.entries) rows.push(['audience', e.metric, e.metricLabel, e.sourceLabel, e.name, e.asOf, e.value, 'people', `${audience.covered} of ${audience.selected} channels`, 'Latest value per channel; not unique people']);
  if (response) {
    rows.push(['response_time', 'median_first_response_minutes', 'Median first response', 'Inbox', '', '', response.medianMs === null ? '' : Math.round(response.medianMs / 60_000), 'minutes', response.partial ? 'partial' : '', 'Median wait until the channel replied; calendar time']);
    rows.push(['response_time', 'answered_waits', 'Answered waits', 'Inbox', '', '', response.answered, 'waits', '', 'Count in period']);
    rows.push(['response_time', 'unanswered_waits', 'Waiting at period end', 'Inbox', '', '', response.unanswered, 'waits', '', 'Count at period end']);
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

  // Printable HTML and plain text show the summary tier only (one row per metric).
  const title = `Analytics report: ${channelName}, ${period.start} to ${period.end}`;
  const audienceHtml = audience ? `<h2>Audience</h2><p>${esc(audience.covered)} of ${esc(audience.selected)} selected channels have audience data${audienceAsOf ? `, as of ${asOf(audienceAsOf)}` : ''}. This sum is not unique people across networks.</p><p><strong>${audience.covered ? esc(audience.total) : 'Not available'}</strong></p>` : '';
  const htmlOf = (count: number, marked: boolean) => {
    const shown = metrics.slice(0, count);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#111}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #bbb;padding:.35rem .5rem;text-align:left}small{color:#555}@media print{body{margin:0}}</style></head><body>`
      + `<h1>${esc(title)}</h1><p><small>Generated ${esc(input.generatedAt.toISOString())}. Values come from stored analytics; "Not available" means no data, not zero.</small></p>`
      + (included.includes('published') ? `<h2>Published posts</h2><p>Published ${esc(snapshot.publishing.published)}, scheduled ${esc(snapshot.publishing.scheduled)}, failed ${esc(snapshot.publishing.failed)}.</p>` : '')
      + (response ? `<h2>Response time</h2><p>${esc(responseLine)}</p>` : '')
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
  const baseLines = [title, '', ...(included.includes('published') ? [`Published ${snapshot.publishing.published}, scheduled ${snapshot.publishing.scheduled}, failed ${snapshot.publishing.failed}.`] : []),
    ...(response ? [`Response time: ${responseLine}`] : []),
    ...(topPosts ? ['Top posts:', ...(topPosts.length ? topPosts.map((p, i) => `${i + 1}. ${postTitle(p)} (${asOf(p.publishedAt)}): ${p.rankLabel} ${p.rankValue ?? 'Not available'}`) : ['No published posts with stored measures in this period.'])] : []),
    ...(audience ? [`Audience: ${audience.covered ? audience.total : 'Not available'} (${audience.covered} of ${audience.selected} channels${audienceAsOf ? `; as of ${asOf(audienceAsOf)}` : ''}; not unique people)`] : [])];
  const metricLines = metrics.map(m => `${clamp(m.label, 200)} (${clamp(m.sourceLabel, 200)}): ${valueText(m)}; ${coverageText(m)}; as of ${asOf(m.latestAt)}`);
  const tail = (cut: boolean) => [...(cut ? ['Shortened to fit the size limit.'] : []), ...(notIncluded.length ? [`Not included: ${notIncluded.join(', ')}`] : [])];
  const textOf = (count: number, cut: boolean) => [...baseLines, ...metricLines.slice(0, count), ...tail(cut)].join('\n');
  const textCount = fit(metricCap, bounds.maxBytes, c => textOf(c, true));
  let textTruncated = textCount < metricLines.length;
  let text = textOf(textCount, textTruncated);
  if (bytes(text) > bounds.maxBytes) { text = cutBytes(text, bounds.maxBytes); textTruncated = true; }
  return { channelName, period, generatedAt: input.generatedAt.toISOString(), sections: included, notIncluded, csv, html, text, rowCount: csvRows, bytes: bytes(csv), htmlBytes: bytes(html), textBytes: bytes(text), truncated: csvTruncated || htmlTruncated || textTruncated || csv !== csvRaw };
}

/**
 * The module's report builder; a host registers it. It re-checks the actor's current authority (including key ceilings and
 * the channel's connection/platform state) and reads only through the shared scoped Analytics reader, one channel at a time.
 * The actor's result ceiling bounds the generated rows themselves, not just list pages.
 */
export function createReportGenerator(deps: { bounds: () => Promise<ReportBounds>; now?: () => Date }): ReportGenerationPort {
  return {
    async generate(request: ReportGenerationRequest): Promise<ReportGenerationResult> {
      try {
        const { actor } = request;
        if (!request.sections.some(s => (REPORT_SUPPORTED_SECTIONS as readonly string[]).includes(s))) return { ok: false, reason: 'no_supported_sections' };
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
        return { ok: true, output: renderReport(snapshot, { channelName: channel?.name ?? 'Channel', sections: request.sections, responseTime, topPosts, generatedAt: deps.now?.() ?? new Date() }, bounds) };
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
        return { ok: false, reason: code === 'unauthorized' || code === 'forbidden' ? 'access_unavailable' : 'generation_failed' };
      }
    },
  };
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
