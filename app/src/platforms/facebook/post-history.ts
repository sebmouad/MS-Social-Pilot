import { z } from 'zod';
import type { FacebookConfig } from './config';
import { facebookHistoryPolicySchema } from './config';
import { facebookAppSecretProof, graphObjectUrl } from './protocol';

export type HistoryProgress = { after: string | null; since: string; until: string; complete: boolean };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown): number | null => (typeof v === 'number' || typeof v === 'string' && v.trim()) && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
const aliases: Record<string, string> = { post_impressions: 'impressions', post_impressions_unique: 'reach', post_engaged_users: 'engagement', post_clicks: 'clicks', post_video_views: 'video_views', post_video_view_time: 'video_watch_time' };
/** Posts enriched concurrently per feed page; serial reads never fit the provider window on active Pages. */
const HISTORY_POST_LANES = 4;

/** Bounded parallel map that preserves input order; the first rejection wins. */
async function mapPool<T, R>(items: readonly T[], lanes: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(lanes, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]!);
    }
  }));
  return results;
}

/** True when the reactions metric already yielded authoritative per-type values. */
function validReactionMetric(insights: Record<string, unknown>): boolean {
  const categories = Object.entries(obj(insights.post_reactions_by_type_total));
  return categories.length > 0 && categories.every(([, value]) => number(value) !== null);
}

function hasVideo(post: Record<string, unknown>): boolean {
  const attachments = (value: unknown): boolean => {
    const data = obj(value).data;
    return Array.isArray(data) && data.some(raw => {
      const item = obj(raw);
      return item.media_type === 'video' || item.type === 'video_inline' || item.type === 'video_autoplay' || attachments(item.subattachments);
    });
  };
  return post.status_type === 'added_video' || attachments(post.attachments);
}

/** Keep observations separate: edge visibility and insights can disagree at the same fetch. */
function resolveReactions(insights: Record<string, unknown>, post: Record<string, unknown>, edges: Record<string, number>, complete: boolean, observedAt: Date) {
  const categories = Object.entries(obj(insights.post_reactions_by_type_total));
  const validInsights = validReactionMetric(insights);
  const insightTotal = validInsights ? categories.reduce((sum, [, value]) => sum + number(value)!, 0) : null;
  const summaryTotal = number(obj(obj(post.reactions).summary).total_count);
  const edgeTotal = complete ? Object.values(edges).reduce((sum, value) => sum + value, 0) : null;
  const source = insightTotal !== null ? 'insights' : summaryTotal !== null ? 'summary' : edgeTotal !== null ? 'edges' : 'unknown';
  const total = insightTotal ?? summaryTotal ?? edgeTotal;
  if (total !== null) insights.reactions = total;
  // Never mix individual reaction types from different observations into a total.
  const selected = validInsights ? categories : source === 'edges' ? Object.entries(edges) : [];
  for (const [type, value] of selected) insights[`reactions_${type.toLowerCase()}`] = number(value);
  const totals = [insightTotal, summaryTotal, edgeTotal].filter(value => value !== null);
  insights.reactionProvenance = {
    source, metric: validInsights ? 'post_reactions_by_type_total' : null,
    insightTotal, summaryTotal, edgeTotal, edgeTypes: edges, edgesComplete: complete,
    conflict: new Set(totals).size > 1, observedAt: observedAt.toISOString(),
  };
}

/** Cursor-only continuation: never persist or follow a provider URL containing credentials. */
export function createFacebookPostHistory(config: FacebookConfig, policyInput: z.input<typeof facebookHistoryPolicySchema>, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const policy = facebookHistoryPolicySchema.parse(policyInput);
  /** `timeWindow`: insights page by time windows (previous/next links without cursors); there is nothing to continue for lifetime values. */
  async function page(path: string, token: string, params: Record<string, string>, options: { timeWindow?: boolean } = {}) {
    signal?.throwIfAborted();
    const url = graphObjectUrl(config, path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set('access_token', token);
    if (config.appSecretProofEnabled) {
      if (!config.appSecret) throw new Error('History signing unavailable.');
      url.searchParams.set('appsecret_proof', facebookAppSecretProof(token, config.appSecret));
    }
    const timeout = AbortSignal.timeout(config.requestTimeoutMs);
    let response: Response;
    try { response = await fetcher(url, { redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout }); }
    catch { signal?.throwIfAborted(); throw new Error('History transport failed.'); }
    const data = obj(await response.json().catch(() => null));
    if (!response.ok || data.error || !Array.isArray(data.data)) {
      const error = obj(data.error);
      throw new Error(`History collection rejected (HTTP ${response.status}${error.code !== undefined ? `, code ${String(error.code)}` : ''}${error.error_subcode !== undefined ? `/${String(error.error_subcode)}` : ''}${typeof error.type === 'string' ? `, ${error.type}` : ''}): ${typeof error.message === 'string' ? error.message.slice(0, 300) : 'no provider message'}`);
    }
    signal?.throwIfAborted();
    const paging = obj(data.paging); const after = obj(paging.cursors).after;
    if (options.timeWindow) return { rows: data.data as unknown[], after: null };
    if (paging.next && (typeof after !== 'string' || !after)) throw new Error('History continuation missing.');
    return { rows: data.data as unknown[], after: paging.next ? after as string : null };
  }
  return { async collect(token: string, pageId: string, now: Date, saved?: HistoryProgress | null) {
    // Finish a stable bounded interval before restarting at the newest posts.
    const progress: HistoryProgress = saved && !saved.complete ? { ...saved } : { after: null, since: new Date(now.getTime() - policy.lookbackDays * 86400000).toISOString(), until: now.toISOString(), complete: false };
    const posts: Array<{ remoteId: string; message: string | null; permalink: string | null; statusType: string | null; pictureUrl: string | null; createdTime: Date; insights: Record<string, unknown> }> = [];
    const failures: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < policy.pageBudget; i++) {
      const identity = progress.after ?? '';
      if (seen.has(identity)) throw new Error('Repeated history cursor.');
      seen.add(identity);
      const batch = await page(`${encodeURIComponent(pageId)}/${policy.edge}`, token, { fields: [...new Set(['id', 'created_time', ...(policy.edge === 'feed' ? ['from'] : []), ...policy.fields])].join(','), limit: String(config.pageSize), since: String(Math.floor(Date.parse(progress.since) / 1000)), until: String(Math.floor(Date.parse(progress.until) / 1000)), ...(progress.after ? { after: progress.after } : {}) });
      const due: Array<{ post: Record<string, unknown>; createdTime: Date }> = [];
      for (const raw of batch.rows) {
        const post = obj(raw); const createdTime = new Date(String(post.created_time));
        if (typeof post.id !== 'string' || !Number.isFinite(createdTime.getTime())) throw new Error('Invalid history post identity.');
        if (createdTime.getTime() < Date.parse(progress.since) || createdTime.getTime() > Date.parse(progress.until)) continue;
        // A feed can include visitor posts. Missing authorship is unknown, never Page-owned.
        if (policy.edge === 'feed' && obj(post.from).id !== pageId) continue;
        due.push({ post, createdTime });
      }
      const enriched = await mapPool(due, HISTORY_POST_LANES, async ({ post, createdTime }) => {
        const insights: Record<string, unknown> = {};
        const postFailures: string[] = [];
        for (const [key, value] of [['shares', obj(post.shares).count], ['comments', obj(obj(post.comments).summary).total_count]] as const) { const n = number(value); if (n !== null) insights[key] = n; }
        // Eligibility is based on provider metadata, never a speculative call on every photo/text post.
        const eligible = [...new Set(policy.metrics)].filter(metric => !metric.startsWith('post_video_') || hasVideo(post));
        const applyRows = (rows: unknown[], wanted: Set<string>) => {
          for (const rawMetric of rows) {
            const item = obj(rawMetric);
            if (typeof item.name !== 'string' || !wanted.has(item.name)) continue;
            const values = Array.isArray(item.values) ? item.values : [];
            const value = obj(values.at(-1)).value ?? obj(item.total_value).value;
            if (value !== undefined) insights[aliases[item.name] ?? item.name] = number(value) ?? value;
          }
        };
        const readMetric = async (metric: string) => {
          const data = await page(`${encodeURIComponent(post.id as string)}/insights`, token, { metric, period: 'lifetime', limit: String(config.pageSize) }, { timeWindow: true });
          // Insights always return time-window paging links (previous/next) even for one lifetime value; they are not a continuation of this metric.
          applyRows(data.rows, new Set([metric]));
        };
        if (eligible.length) {
          try {
            const data = await page(`${encodeURIComponent(post.id as string)}/insights`, token, { metric: eligible.join(','), period: 'lifetime', limit: String(config.pageSize) }, { timeWindow: true });
            applyRows(data.rows, new Set(eligible));
          } catch {
            signal?.throwIfAborted();
            // One refused metric poisons the batch; retry individually so surviving metrics still persist.
            for (const metric of eligible) {
              try { await readMetric(metric); }
              // Keep Graph's reason with the metric so Root › Errors says why it was refused, not only which.
              catch (error) { signal?.throwIfAborted(); failures.push(`${metric} (${error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 160) : 'refused'})`); postFailures.push(metric); }
            }
          }
        }
        const edgeReactions: Record<string, number> = {};
        let reactionsComplete = false;
        // The reactions metric already wins over edges; only fan out to the
        // reaction edges when it (and therefore the fast path) came back empty.
        // Skipped edges stay unknown (null), never zero, in the provenance.
        if (!validReactionMetric(insights)) {
          reactionsComplete = policy.reactionTypes.length > 0;
          for (const type of new Set(policy.reactionTypes)) {
            try {
              let after: string | null = null; let total = 0; let complete = false; const cursors = new Set<string>();
              for (let j = 0; j < config.maxPages; j++) {
                const key = after ?? ''; if (cursors.has(key)) throw new Error('Repeated reaction cursor.'); cursors.add(key);
                const data = await page(`${encodeURIComponent(post.id as string)}/reactions`, token, { type, fields: 'id', limit: String(config.pageSize), ...(after ? { after } : {}) });
                total += data.rows.length; after = data.after; if (!after) { complete = true; break; }
              }
              if (!complete) throw new Error('Reaction budget exceeded.');
              edgeReactions[type.toLowerCase()] = total;
            } catch { signal?.throwIfAborted(); reactionsComplete = false; failures.push(`reactions_${type}`); postFailures.push(`reactions_${type}`); }
          }
        }
        resolveReactions(insights, post, edgeReactions, reactionsComplete, now);
        insights.collectionFailures = [...new Set(postFailures)];
        const text = (key: string) => typeof post[key] === 'string' ? post[key] as string : null;
        return { remoteId: post.id as string, message: text('message'), permalink: text('permalink_url'), statusType: text('status_type'), pictureUrl: text('full_picture'), createdTime, insights };
      });
      for (const entry of enriched) posts.push(entry);
      progress.after = batch.after; progress.complete = !batch.after;
      if (progress.complete) break;
    }
    return { posts, progress, failures: [...new Set(failures)] };
  } };
}
