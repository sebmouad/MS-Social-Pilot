import type { z } from 'zod';
import type { FacebookConfig } from './config';
import { facebookAdBreakdownsSchema, facebookContentInsightsSchema, facebookInsightPeriodsSchema, validateFacebookConfig } from './config';
import { facebookAppSecretProof, graphObjectUrl } from './protocol';
import type { FacebookPageInsightObservations } from './publishing';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const numeric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const DAY_ONLY_PAGE_METRICS = new Set(['page_follows', 'page_fans']);
type Policy = { periods: z.infer<typeof facebookInsightPeriodsSchema>; content: z.infer<typeof facebookContentInsightsSchema> };

/** Read-only analytics transport. Never follows provider URLs with credentials to another origin. */
export function createFacebookDataCollector(config: FacebookConfig, policy: Policy, fetchImpl: typeof fetch = fetch, signal?: AbortSignal) {
  validateFacebookConfig(config);
  const periods = facebookInsightPeriodsSchema.parse(policy.periods);
  const content = facebookContentInsightsSchema.parse(policy.content);
  async function rows(path: string, token: string, params: Record<string, string>, lifetimeSnapshot = false): Promise<unknown[]> {
    const first = graphObjectUrl(config, path);
    for (const [key, value] of Object.entries(params)) first.searchParams.set(key, value);
    first.searchParams.set('limit', String(config.pageSize));
    let next: URL | null = first;
    const seen = new Set<string>(); const values: unknown[] = [];
    for (let page = 0; next && page < config.maxPages; page++) {
      signal?.throwIfAborted();
      if (next.origin !== first.origin || next.username || next.password || next.hash || next.pathname !== first.pathname) throw new Error('Invalid analytics pagination endpoint.');
      next.searchParams.delete('access_token'); next.searchParams.delete('appsecret_proof');
      const identity = next.toString();
      if (seen.has(identity)) throw new Error('Repeated analytics pagination cursor.');
      seen.add(identity);
      next.searchParams.set('access_token', token);
      if (config.appSecretProofEnabled) {
        if (!config.appSecret) throw new Error('Analytics signing is unavailable.');
        next.searchParams.set('appsecret_proof', facebookAppSecretProof(token, config.appSecret));
      }
      const timeout = AbortSignal.timeout(config.requestTimeoutMs);
      let response: Response;
      try { response = await fetchImpl(next, { redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout }); }
      catch { signal?.throwIfAborted(); throw new Error('Analytics transport failed.'); }
      signal?.throwIfAborted();
      const payload = object(await response.json().catch(() => null));
      signal?.throwIfAborted();
      // Provider messages can contain request URLs/tokens. Keep failures content-free.
      if (!response.ok || payload.error || !Array.isArray(payload.data)) throw new Error('Analytics request was rejected or returned an invalid collection.');
      values.push(...payload.data);
      // Lifetime insight links describe other time windows, not more objects in this snapshot.
      // Discovery and Ads still require complete cursor pagination.
      if (lifetimeSnapshot) return values;
      const link = object(payload.paging).next;
      next = typeof link === 'string' && link ? new URL(link) : null;
    }
    if (next) throw new Error('Analytics pagination exceeded the configured limit.');
    return values;
  }
  return {
    async collectAdHierarchy(token: string, accountId: string, since: Date, until: Date, policy: { levels: Array<'campaign' | 'adset' | 'ad'>; actionBreakdowns: string[] }): Promise<Array<Record<string, unknown>>> {
      const result: Array<Record<string, unknown>> = [];
      for (const level of new Set(policy.levels)) {
        const data = await rows(`${encodeURIComponent(accountId)}/insights`, token, {
          fields: [...new Set([...config.adInsightFields, 'account_id', 'account_name', 'campaign_id', 'campaign_name', ...(level !== 'campaign' ? ['adset_id', 'adset_name'] : []), ...(level === 'ad' ? ['ad_id', 'ad_name'] : []), 'actions', 'action_values', 'date_start', 'date_stop'])].join(','),
          level, time_increment: '1', ...(policy.actionBreakdowns.length ? { action_breakdowns: policy.actionBreakdowns.join(',') } : {}),
          time_range: JSON.stringify({ since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) }),
        });
        result.push(...data.map(raw => ({ ...object(raw), report_level: level })));
      }
      return result;
    },
    async collectAdBreakdowns(token: string, accountId: string, since: Date, until: Date, combinations: z.infer<typeof facebookAdBreakdownsSchema>, baseline: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
      const snapshots = new Map<string, Array<{ dimensions: string[]; rows: unknown[] }>>();
      // Read every configured combination independently. Refuse a partial Ads sync
      // on rejection rather than marking missing dimensions as a complete refresh.
      const uniqueCombinations = new Map(facebookAdBreakdownsSchema.parse(combinations).map(dimensions => {
        const canonical = [...new Set(dimensions)].sort(); return [JSON.stringify(canonical), canonical] as const;
      }));
      for (const dimensions of uniqueCombinations.values()) {
        const data = await rows(`${encodeURIComponent(accountId)}/insights`, token, {
          fields: [...new Set([...config.adInsightFields, 'date_start', 'date_stop'])].join(','),
          level: 'account', time_increment: '1', breakdowns: dimensions.join(','),
          time_range: JSON.stringify({ since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) }),
        });
        const days = new Map<string, unknown[]>();
        for (const raw of data) {
          const item = object(raw);
          if (typeof item.date_start !== 'string') continue;
          const day = days.get(item.date_start) ?? []; day.push(item); days.set(item.date_start, day);
        }
        for (const [date, values] of days) {
          const day = snapshots.get(date) ?? []; day.push({ dimensions, rows: values }); snapshots.set(date, day);
        }
      }
      return baseline.map(row => ({ ...row, delivery_breakdowns: snapshots.get(String(row.date_start)) ?? [] }));
    },
    async getPageInsightObservations(token: string, pageId: string, since?: Date, until?: Date): Promise<FacebookPageInsightObservations> {
      const result: FacebookPageInsightObservations = [];
      const failures: Array<{ metric: string; message: string }> = [];
      const range: Record<string, string> = {};
      if (since) range.since = String(Math.floor(since.getTime() / 1000));
      if (until) range.until = String(Math.floor(until.getTime() / 1000));
      async function collect(id: string, edge: string, metrics: readonly string[], requestedPeriods: readonly string[], prefix = '') {
        for (const metric of new Set(metrics)) for (const period of new Set(requestedPeriods)) {
          // Follower totals are running counts Facebook only reports per day; week/28-day requests always fail.
          if (!prefix && period !== 'day' && DAY_ONLY_PAGE_METRICS.has(metric)) continue;
          signal?.throwIfAborted();
          try {
            const data = await rows(`${encodeURIComponent(id)}/${edge}`, token, { ...range, metric, period }, period === 'lifetime');
            for (const raw of data) {
              const item = object(raw);
              // A provider cannot inject another metric into this request's identity.
              if (item.name !== metric) continue;
              const responsePeriod = typeof item.period === 'string' && item.period ? item.period : period;
              const points = Array.isArray(item.values) ? item.values : [];
              const total = object(item.total_value);
              // total_value has no point timestamp: explicitly use the requested range end,
              // never the current wall clock or an invented day bucket.
              const normalized = [...points, ...(Object.hasOwn(total, 'value') && until ? [{ value: total.value, end_time: until.toISOString() }] : [])];
              for (const rawPoint of normalized) {
                const point = object(rawPoint);
                // Lifetime values often omit end_time. The explicit requested end is a
                // snapshot anchor, not evidence of when each view/reaction occurred.
                const endTime = typeof point.end_time === 'string' ? new Date(point.end_time) : responsePeriod === 'lifetime' ? until : null;
                if (!endTime || !Number.isFinite(endTime.getTime()) || !Object.hasOwn(point, 'value')) continue;
                result.push({ metric: `${prefix}${metric}`, period: points.includes(rawPoint) || responsePeriod === 'lifetime' ? responsePeriod : `total_over_range:${since?.toISOString() ?? "unspecified"}`, endTime, value: point.value, numeric: numeric(point.value) });
              }
              // Retain total_value breakdowns independently from its numeric value.
              if (until && Array.isArray(total.breakdowns)) {
                const categories: Record<string, unknown> = {};
                for (const rawBreakdown of total.breakdowns) {
                  const breakdown = object(rawBreakdown);
                  if (!Array.isArray(breakdown.results)) continue;
                  for (const rawResult of breakdown.results) {
                    const entry = object(rawResult);
                    if (!Array.isArray(entry.dimension_values)) continue;
                    const identity = JSON.stringify([breakdown.dimension_keys ?? [], entry.dimension_values]);
                    categories[identity] = entry.value;
                  }
                }
                if (Object.keys(categories).length) result.push({ metric: `${prefix}${metric}:breakdowns`, period: responsePeriod, endTime: until, value: categories, numeric: null });
              }
            }
          } catch (error) {
            signal?.throwIfAborted();
            // Keep Graph's reason (trimmed) so Root › Errors explains the failure.
            failures.push({ metric: `${prefix}${metric}::${period}`, message: error instanceof Error ? `Configured insight collection failed: ${error.message.replace(/\s+/g, ' ').slice(0, 160)}` : 'Configured insight collection failed.' });
          }
        }
      }
      await collect(pageId, 'insights', config.pageInsightMetrics, periods);
      for (const collection of content) {
        signal?.throwIfAborted();
        try {
          // Discovery dates are not uniformly supported across these edges. Discover
          // bounded IDs and apply the requested time range to insights themselves.
          const items = await rows(`${encodeURIComponent(pageId)}/${collection.edge}`, token, { fields: [...new Set(['id', ...(collection.fields ?? [])])].join(',') });
          for (const item of items) {
            const id = object(item).id;
            if (typeof id !== 'string' || !id.trim()) continue;
            const fields = object(item);
            for (const [field, value] of Object.entries(fields)) {
              if (field === 'id') continue;
              // Metadata and nested summary/reaction counts are retained verbatim;
              // neutral normalization exposes numeric leaves and unknowns honestly.
              if (until) result.push({ metric: `content:${collection.edge}:${id}:field:${field}`, period: 'lifetime', endTime: until, value, numeric: numeric(value) });
            }
            await collect(id, collection.insightEdge, collection.metrics, collection.periods, `content:${collection.edge}:${id}:`);
          }
        } catch {
          signal?.throwIfAborted();
          failures.push({ metric: `content:${collection.edge}`, message: 'Configured content discovery failed.' });
        }
      }
      if (!result.length && failures.length) throw new Error('No configured Facebook insight collection succeeded.');
      if (failures.length) Object.defineProperty(result, 'failedMetrics', { value: failures, enumerable: false });
      return result;
    },
  };
}
