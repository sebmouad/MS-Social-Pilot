import { graphPaged, graphRequest } from './graph';
import { AD_DEFAULT_FIELDS } from './metrics';

/**
 * Marketing API reads: which ad accounts a user can see, and what they spent.
 *
 * The point of having this next to organic analytics is the comparison. A Page
 * whose reach tripled last month either earned it or bought it, and only the
 * spend figures distinguish the two.
 *
 * Read-only. Nothing here creates, edits or pauses an ad — that is a different
 * product with a different blast radius, and `ads_management` is deliberately
 * not requested.
 */

const MAX_ACCOUNT_PAGES = 3;
const MAX_INSIGHT_PAGES = 10;

export interface AdAccountRef {
  actId: string;
  name: string;
  currency: string | null;
  accountStatus: number | null;
}

interface RawAdAccount {
  id?: string;
  account_id?: string;
  name?: string;
  currency?: string;
  account_status?: number;
}

/** Ad accounts the connected user has a role on. */
export async function fetchAdAccounts(
  accessToken: string,
  options: { signal?: AbortSignal } = {},
): Promise<AdAccountRef[]> {
  const raw = await graphPaged<RawAdAccount>('me/adaccounts', {
    accessToken,
    maxPages: MAX_ACCOUNT_PAGES,
    limit: 100,
    signal: options.signal,
    params: { fields: 'id,account_id,name,currency,account_status' },
  });

  return raw
    .map((entry) => {
      // `id` already carries the act_ prefix; `account_id` does not.
      const actId = entry.id ?? (entry.account_id ? `act_${entry.account_id}` : null);
      if (!actId) return null;
      return {
        actId,
        name: entry.name ?? actId,
        currency: entry.currency ?? null,
        accountStatus: typeof entry.account_status === 'number' ? entry.account_status : null,
      } satisfies AdAccountRef;
    })
    .filter((account): account is AdAccountRef => account !== null);
}

/** Levels the insights edge aggregates at. */
export type AdLevel = 'account' | 'campaign' | 'adset' | 'ad';

export interface AdInsightRow {
  level: AdLevel;
  objectId: string;
  objectName: string | null;
  date: Date;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  cpc: number | null;
  cpm: number | null;
  cpp: number | null;
  ctr: number | null;
  frequency: number | null;
  /** `[{ action_type, value }]` arrays, keyed by the field they came from. */
  actions: Record<string, unknown> | null;
  /** Everything else the request returned, so nothing is discarded. */
  fields: Record<string, unknown>;
}

/** Fields whose value is an action array rather than a scalar. */
const ACTION_FIELDS = new Set([
  'actions',
  'unique_actions',
  'action_values',
  'ad_click_actions',
  'ad_impression_actions',
  'outbound_clicks',
  'unique_outbound_clicks',
  'outbound_clicks_ctr',
  'unique_outbound_clicks_ctr',
  'cost_per_action_type',
  'cost_per_unique_action_type',
  'conversions',
  'conversion_values',
  'catalog_segment_actions',
  'catalog_segment_value',
  'purchase_roas',
  'website_purchase_roas',
  'mobile_app_purchase_roas',
  'video_play_actions',
  'video_thruplay_watched_actions',
  'video_avg_time_watched_actions',
  'video_time_watched_actions',
  'video_continuous_2_sec_watched_actions',
  'video_15_sec_watched_actions',
  'video_30_sec_watched_actions',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p95_watched_actions',
  'video_p100_watched_actions',
  'video_play_curve_actions',
  'video_play_retention_graph_actions',
  'video_play_retention_0_to_15s_actions',
  'video_play_retention_20_to_60s_actions',
  'dda_countby_convs',
]);

/** Ads Insights returns every number as a string. */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const NAME_FIELD: Record<AdLevel, string> = {
  account: 'account_name',
  campaign: 'campaign_name',
  adset: 'adset_name',
  ad: 'ad_name',
};

const ID_FIELD: Record<AdLevel, string> = {
  account: 'account_id',
  campaign: 'campaign_id',
  adset: 'adset_id',
  ad: 'ad_id',
};

/**
 * Daily insight rows for an ad account.
 *
 * `time_increment=1` is what makes this a time series rather than one totalled
 * row; without it Facebook collapses the whole range and the daily chart has a
 * single point. The full field list is requested because the whole point of
 * this module is that nothing gets dropped, and Ads Insights charges the same
 * for one field as for a hundred.
 */
export async function fetchAdInsights(options: {
  actId: string;
  accessToken: string;
  level: AdLevel;
  since: Date;
  until: Date;
  fields?: string[];
  signal?: AbortSignal;
}): Promise<AdInsightRow[]> {
  const day = (date: Date): string => date.toISOString().slice(0, 10);

  const raw = await graphPaged<Record<string, unknown>>(`${options.actId}/insights`, {
    accessToken: options.accessToken,
    maxPages: MAX_INSIGHT_PAGES,
    limit: 200,
    signal: options.signal,
    params: {
      level: options.level,
      time_increment: 1,
      time_range: JSON.stringify({ since: day(options.since), until: day(options.until) }),
      fields: (options.fields ?? AD_DEFAULT_FIELDS).join(','),
    },
  });

  return raw
    .map((entry) => {
      const date = typeof entry.date_start === 'string' ? new Date(entry.date_start) : null;
      if (!date || Number.isNaN(date.getTime())) return null;

      const objectId = String(entry[ID_FIELD[options.level]] ?? options.actId);
      const name = entry[NAME_FIELD[options.level]];

      const actions: Record<string, unknown> = {};
      const fields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(entry)) {
        if (ACTION_FIELDS.has(key)) actions[key] = value;
        else fields[key] = value;
      }

      return {
        level: options.level,
        objectId,
        objectName: typeof name === 'string' ? name : null,
        date,
        spend: num(entry.spend) ?? 0,
        impressions: num(entry.impressions) ?? 0,
        clicks: num(entry.clicks) ?? 0,
        reach: num(entry.reach) ?? 0,
        cpc: num(entry.cpc),
        cpm: num(entry.cpm),
        cpp: num(entry.cpp),
        ctr: num(entry.ctr),
        frequency: num(entry.frequency),
        actions: Object.keys(actions).length > 0 ? actions : null,
        fields,
      } satisfies AdInsightRow;
    })
    .filter((row): row is AdInsightRow => row !== null);
}

/**
 * Flatten an action array into `{ action_type: value }`.
 *
 * Ads Insights nests these as `[{ action_type: "link_click", value: "42" }]`,
 * which no chart can read directly.
 */
export function actionMap(value: unknown): Record<string, number> {
  if (!Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { action_type?: unknown; value?: unknown };
    const key = typeof record.action_type === 'string' ? record.action_type : null;
    const parsed = num(record.value);
    if (key && parsed !== null) result[key] = parsed;
  }
  return result;
}

/** Confirm a token can read a specific ad account before storing it. */
export async function verifyAdAccount(
  actId: string,
  accessToken: string,
): Promise<AdAccountRef> {
  const { data } = await graphRequest<RawAdAccount>(actId, {
    accessToken,
    params: { fields: 'id,account_id,name,currency,account_status' },
  });

  return {
    actId: data.id ?? actId,
    name: data.name ?? actId,
    currency: data.currency ?? null,
    accountStatus: typeof data.account_status === 'number' ? data.account_status : null,
  };
}
