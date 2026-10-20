import { z } from 'zod';
import type { FacebookConfig } from './config';
import { facebookHistoryPolicySchema } from './config';
import { facebookAppSecretProof, graphObjectUrl } from './protocol';

export type HistoryProgress = { after: string | null; since: string; until: string; complete: boolean };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown): number | null => (typeof v === 'number' || typeof v === 'string' && v.trim()) && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
const aliases: Record<string, string> = { post_impressions: 'impressions', post_impressions_unique: 'reach', post_engaged_users: 'engagement', post_clicks: 'clicks', post_video_views: 'video_views', post_video_view_time: 'video_watch_time' };

/** Cursor-only continuation: never persist or follow a provider URL containing credentials. */
export function createFacebookPostHistory(config: FacebookConfig, policyInput: z.input<typeof facebookHistoryPolicySchema>, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const policy = facebookHistoryPolicySchema.parse(policyInput);
  async function page(path: string, token: string, params: Record<string, string>) {
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
    if (!response.ok || data.error || !Array.isArray(data.data)) throw new Error('History collection rejected.');
    signal?.throwIfAborted();
    const paging = obj(data.paging); const after = obj(paging.cursors).after;
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
      const batch = await page(`${encodeURIComponent(pageId)}/${policy.edge}`, token, { fields: [...new Set(['id', 'created_time', ...policy.fields])].join(','), limit: String(config.pageSize), since: String(Date.parse(progress.since) / 1000), until: String(Date.parse(progress.until) / 1000), ...(progress.after ? { after: progress.after } : {}) });
      for (const raw of batch.rows) {
        const post = obj(raw); const createdTime = new Date(String(post.created_time));
        if (typeof post.id !== 'string' || !Number.isFinite(createdTime.getTime())) throw new Error('Invalid history post identity.');
        if (createdTime.getTime() < Date.parse(progress.since) || createdTime.getTime() > Date.parse(progress.until)) continue;
        const insights: Record<string, unknown> = {};
        const postFailures: string[] = [];
        for (const [key, value] of [['shares', obj(post.shares).count], ['comments', obj(obj(post.comments).summary).total_count]] as const) { const n = number(value); if (n !== null) insights[key] = n; }
        for (const metric of new Set(policy.metrics)) {
          try {
            const data = await page(`${encodeURIComponent(post.id)}/insights`, token, { metric, period: 'lifetime', limit: String(config.pageSize) });
            if (data.after) throw new Error('Unexpected metric continuation.');
            for (const rawMetric of data.rows) { const item = obj(rawMetric); if (item.name !== metric) continue; const values = Array.isArray(item.values) ? item.values : []; const value = obj(values.at(-1)).value ?? obj(item.total_value).value; if (value !== undefined) insights[aliases[metric] ?? metric] = number(value) ?? value; }
          } catch { signal?.throwIfAborted(); failures.push(metric); postFailures.push(metric); }
        }
        let reactionTotal = 0; let reactionsComplete = policy.reactionTypes.length > 0;
        for (const type of new Set(policy.reactionTypes)) {
          try {
            let after: string | null = null; let total = 0; let complete = false; const cursors = new Set<string>();
            for (let j = 0; j < config.maxPages; j++) {
              const key = after ?? ''; if (cursors.has(key)) throw new Error('Repeated reaction cursor.'); cursors.add(key);
              const data = await page(`${encodeURIComponent(post.id)}/reactions`, token, { type, fields: 'id', limit: String(config.pageSize), ...(after ? { after } : {}) });
              total += data.rows.length; after = data.after; if (!after) { complete = true; break; }
            }
            if (!complete) throw new Error('Reaction budget exceeded.');
            insights[`reactions_${type.toLowerCase()}`] = total; reactionTotal += total;
          } catch { signal?.throwIfAborted(); reactionsComplete = false; failures.push(`reactions_${type}`); postFailures.push(`reactions_${type}`); }
        }
        if (reactionsComplete) insights.reactions = reactionTotal;
        insights.collectionFailures = [...new Set(postFailures)];
        const text = (key: string) => typeof post[key] === 'string' ? post[key] as string : null;
        posts.push({ remoteId: post.id, message: text('message'), permalink: text('permalink_url'), statusType: text('status_type'), pictureUrl: text('full_picture'), createdTime, insights });
      }
      progress.after = batch.after; progress.complete = !batch.after;
      if (progress.complete) break;
    }
    return { posts, progress, failures: [...new Set(failures)] };
  } };
}
