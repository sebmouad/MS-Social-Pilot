import { prisma } from './prisma';
import { decryptSecret } from './crypto';
import { toJsonOrNull } from './json';
import { asGraphError } from './facebook/graph';
import { actionMap, fetchAdAccounts, fetchAdInsights, type AdLevel } from './facebook/ads';
import { logActivity } from './scheduler/runner';

/**
 * Advertising analytics.
 *
 * The reason this sits beside organic reporting: a Page whose reach tripled
 * last month either earned it or bought it, and only spend distinguishes the
 * two. Everything here is read-only — nothing creates, edits or pauses an ad.
 *
 * Requires `ads_read` on the connected account. Without it Graph returns a
 * permission error, which is surfaced rather than swallowed: "no ad accounts"
 * and "not allowed to see the ad accounts" are different facts.
 */

export interface AdSyncResult {
  adAccountId: string;
  name: string;
  rows: number;
  error?: string;
}

/** Default sync window. Facebook keeps 37 months, but daily rows add up. */
const DEFAULT_WINDOW_DAYS = 90;

/**
 * Levels stored per pass, coarsest first.
 *
 * All four, because "which ad" is the question people actually have when a
 * campaign underperforms — and because the row count is bounded by the account
 * rather than by us: an account with three ads produces three ad rows a day.
 */
const LEVELS: AdLevel[] = ['account', 'campaign', 'adset', 'ad'];

/**
 * Find every ad account the workspace's connected users can read.
 *
 * Discovery runs against each social account's own token, because ad-account
 * roles are granted to people, not to Pages.
 */
export async function discoverAdAccounts(workspaceId: string): Promise<{
  found: number;
  errors: string[];
}> {
  const accounts = await prisma.socialAccount.findMany({
    where: { workspaceId, invalidatedAt: null },
  });

  let found = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const token = decryptSecret(account.accessToken);
      const adAccounts = await fetchAdAccounts(token);

      for (const adAccount of adAccounts) {
        await prisma.adAccount.upsert({
          where: { workspaceId_actId: { workspaceId, actId: adAccount.actId } },
          create: {
            workspaceId,
            socialAccountId: account.id,
            actId: adAccount.actId,
            name: adAccount.name,
            currency: adAccount.currency,
            accountStatus: adAccount.accountStatus,
          },
          update: {
            socialAccountId: account.id,
            name: adAccount.name,
            currency: adAccount.currency,
            accountStatus: adAccount.accountStatus,
          },
        });
        found += 1;
      }
    } catch (error) {
      errors.push(`${account.name}: ${asGraphError(error).displayMessage}`);
    }
  }

  if (found > 0) await logActivity(workspaceId, 'ads.discovered', { found });

  return { found, errors };
}

/** Pull daily delivery rows for one ad account. */
export async function syncAdAccount(options: {
  adAccountId: string;
  since?: Date;
  until?: Date;
}): Promise<AdSyncResult> {
  const account = await prisma.adAccount.findUniqueOrThrow({
    where: { id: options.adAccountId },
    include: { socialAccount: true },
  });

  const base: AdSyncResult = { adAccountId: account.id, name: account.name, rows: 0 };

  if (!account.socialAccount) {
    return { ...base, error: 'The connected account that owned this ad account is gone.' };
  }

  const until = options.until ?? new Date();
  const since =
    options.since ?? new Date(until.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  try {
    const token = decryptSecret(account.socialAccount.accessToken);
    let rows = 0;

    for (const level of LEVELS) {
      const insights = await fetchAdInsights({
        actId: account.actId,
        accessToken: token,
        level,
        since,
        until,
      });

      for (const row of insights) {
        await prisma.adInsight.upsert({
          where: {
            adAccountId_level_objectId_date: {
              adAccountId: account.id,
              level: row.level,
              objectId: row.objectId,
              date: row.date,
            },
          },
          create: {
            adAccountId: account.id,
            level: row.level,
            objectId: row.objectId,
            objectName: row.objectName,
            date: row.date,
            spend: row.spend,
            impressions: row.impressions,
            clicks: row.clicks,
            reach: row.reach,
            cpc: row.cpc,
            cpm: row.cpm,
            cpp: row.cpp,
            ctr: row.ctr,
            frequency: row.frequency,
            actions: toJsonOrNull(row.actions),
            fields: toJsonOrNull(row.fields),
          },
          update: {
            objectName: row.objectName,
            spend: row.spend,
            impressions: row.impressions,
            clicks: row.clicks,
            reach: row.reach,
            cpc: row.cpc,
            cpm: row.cpm,
            cpp: row.cpp,
            ctr: row.ctr,
            frequency: row.frequency,
            actions: toJsonOrNull(row.actions),
            fields: toJsonOrNull(row.fields),
            fetchedAt: new Date(),
          },
        });
        rows += 1;
      }
    }

    await prisma.adAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: new Date() },
    });

    return { ...base, rows };
  } catch (error) {
    return { ...base, error: asGraphError(error).displayMessage };
  }
}

/** Sync every enabled ad account in a workspace. */
export async function syncWorkspaceAds(options: {
  workspaceId: string;
  since?: Date;
  until?: Date;
}): Promise<AdSyncResult[]> {
  const accounts = await prisma.adAccount.findMany({
    where: { workspaceId: options.workspaceId, enabled: true },
    select: { id: true },
  });

  const results: AdSyncResult[] = [];
  for (const account of accounts) {
    results.push(
      await syncAdAccount({
        adAccountId: account.id,
        since: options.since,
        until: options.until,
      }),
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Reading back
// ---------------------------------------------------------------------------

export interface AdSpendSummary {
  currency: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  /** Weighted, not an average of averages — a mean of daily CPCs is wrong. */
  cpc: number | null;
  cpm: number | null;
  ctr: number | null;
  /** Every action type the window produced, summed. */
  actions: Record<string, number>;
  daily: Array<{ date: string; spend: number; impressions: number; clicks: number; reach: number }>;
}

/** Account-level totals and the daily curve. */
export async function readAdSummary(options: {
  workspaceId: string;
  adAccountId?: string;
  from: Date;
  to: Date;
}): Promise<AdSpendSummary> {
  const rows = await prisma.adInsight.findMany({
    where: {
      level: 'account',
      date: { gte: options.from, lte: options.to },
      adAccount: {
        workspaceId: options.workspaceId,
        ...(options.adAccountId ? { id: options.adAccountId } : {}),
      },
    },
    include: { adAccount: { select: { currency: true } } },
    orderBy: { date: 'asc' },
  });

  const spend = rows.reduce((sum, row) => sum + row.spend, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const reach = rows.reduce((sum, row) => sum + row.reach, 0);

  const actions: Record<string, number> = {};
  for (const row of rows) {
    const parsed = row.actions as Record<string, unknown> | null;
    for (const [key, value] of Object.entries(actionMap(parsed?.actions))) {
      actions[key] = (actions[key] ?? 0) + value;
    }
  }

  const round = (value: number): number => Math.round(value * 100) / 100;

  return {
    currency: rows[0]?.adAccount.currency ?? null,
    spend: round(spend),
    impressions,
    clicks,
    reach,
    // Derived from the totals, so a day that spent £1,000 counts a thousand
    // times more than a day that spent £1.
    cpc: clicks > 0 ? round(spend / clicks) : null,
    cpm: impressions > 0 ? round((spend / impressions) * 1000) : null,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : null,
    actions,
    daily: rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      spend: round(row.spend),
      impressions: row.impressions,
      clicks: row.clicks,
      reach: row.reach,
    })),
  };
}

export interface CampaignRow {
  objectId: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  cpc: number | null;
  cpm: number | null;
  ctr: number | null;
  actions: Record<string, number>;
}

/** Per-object totals over the window, biggest spender first. */
export async function readCampaigns(options: {
  workspaceId: string;
  adAccountId?: string;
  from: Date;
  to: Date;
  /** Campaign, ad set or individual ad. Defaults to campaign. */
  level?: Exclude<AdLevel, 'account'>;
}): Promise<CampaignRow[]> {
  const rows = await prisma.adInsight.findMany({
    where: {
      level: options.level ?? 'campaign',
      date: { gte: options.from, lte: options.to },
      adAccount: {
        workspaceId: options.workspaceId,
        ...(options.adAccountId ? { id: options.adAccountId } : {}),
      },
    },
  });

  const grouped = new Map<string, CampaignRow>();

  for (const row of rows) {
    const existing = grouped.get(row.objectId) ?? {
      objectId: row.objectId,
      name: row.objectName ?? row.objectId,
      spend: 0,
      impressions: 0,
      clicks: 0,
      reach: 0,
      cpc: null,
      cpm: null,
      ctr: null,
      actions: {},
    };

    existing.spend += row.spend;
    existing.impressions += row.impressions;
    existing.clicks += row.clicks;
    // Reach is unique people, so summing daily values overcounts anyone who
    // saw the ad twice. The highest single day is the closest honest figure
    // available without a second API call per campaign.
    existing.reach = Math.max(existing.reach, row.reach);

    const parsed = row.actions as Record<string, unknown> | null;
    for (const [key, value] of Object.entries(actionMap(parsed?.actions))) {
      existing.actions[key] = (existing.actions[key] ?? 0) + value;
    }

    grouped.set(row.objectId, existing);
  }

  return [...grouped.values()]
    .map((campaign) => ({
      ...campaign,
      spend: Math.round(campaign.spend * 100) / 100,
      cpc: campaign.clicks > 0 ? Math.round((campaign.spend / campaign.clicks) * 100) / 100 : null,
      cpm:
        campaign.impressions > 0
          ? Math.round((campaign.spend / campaign.impressions) * 100000) / 100
          : null,
      ctr:
        campaign.impressions > 0
          ? Math.round((campaign.clicks / campaign.impressions) * 10000) / 100
          : null,
    }))
    .sort((a, b) => b.spend - a.spend);
}

export interface AdAccountSummary {
  id: string;
  actId: string;
  name: string;
  currency: string | null;
  enabled: boolean;
  lastSyncedAt: Date | null;
}

export async function listAdAccounts(workspaceId: string): Promise<AdAccountSummary[]> {
  const rows = await prisma.adAccount.findMany({
    where: { workspaceId },
    orderBy: { name: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    actId: row.actId,
    name: row.name,
    currency: row.currency,
    enabled: row.enabled,
    lastSyncedAt: row.lastSyncedAt,
  }));
}
