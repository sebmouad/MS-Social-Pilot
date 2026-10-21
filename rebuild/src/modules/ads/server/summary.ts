export type InsightRow = {
  id: string;
  adAccountId: string;
  level: string;
  objectId: string;
  objectName: string | null;
  date: Date;
  /** Legacy fixtures may predate fetch provenance. Never substitute the report day. */
  fetchedAt?: Date;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  cpc: number | null;
  cpm: number | null;
  cpp: number | null;
  ctr: number | null;
  frequency: number | null;
  actions: unknown;
  fields: unknown;
  adAccount: { id: string; name: string; currency: string | null };
};

export type AdsSummary = {
  key: string;
  level: string;
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  currency: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  reachDate: Date;
  cpc: number | null;
  cpm: number | null;
  cpp: number | null;
  ctr: number | null;
  frequency: number | null;
  actions: Array<{ name: string; value: number }>;
  fields: unknown;
  parentId?: string | null;
  fieldsDate: Date;
  dailyMetrics: Array<{ date: Date; fetchedAt: Date | null; spend: number; impressions: number; clicks: number; reach: number; cpc: number | null; cpm: number | null; cpp: number | null; ctr: number | null; frequency: number | null; actions: unknown; fields: unknown }>;
  rows: number;
};

type ActionItem = { action_type?: unknown; value?: unknown };

function actionItems(value: unknown): ActionItem[] {
  return Array.isArray(value) ? value.filter((item): item is ActionItem => Boolean(item) && typeof item === "object") : [];
}

/** Roll daily rows up per account and object. Reach/frequency/other fields are snapshots, so use latest row. */
export function summarizeInsights(rows: readonly InsightRow[], level?: string): AdsSummary[] {
  const groups = new Map<string, AdsSummary & { actionTotals: Map<string, number>; nameDate: Date }>();
  for (const row of rows) {
    if (level && row.level !== level) continue;
    const key = JSON.stringify([row.adAccountId, row.level, row.objectId]);
    let current = groups.get(key);
    if (!current) {
      current = {
        key, level: row.level, id: row.objectId, name: row.objectName || row.objectId,
        accountId: row.adAccount.id, accountName: row.adAccount.name, currency: row.adAccount.currency,
        spend: 0, impressions: 0, clicks: 0, reach: row.reach, reachDate: row.date,
        cpc: null, cpm: null, cpp: row.cpp, ctr: null, frequency: row.frequency, actions: [],
        fields: row.fields, fieldsDate: row.date, dailyMetrics: [], rows: 0, actionTotals: new Map(), nameDate: row.date,
      };
      groups.set(key, current);
    }
    current.spend += row.spend;
    current.impressions += row.impressions;
    current.clicks += row.clicks;
    current.rows += 1;
    current.dailyMetrics.push({ date: row.date, fetchedAt: row.fetchedAt ?? null, spend: row.spend, impressions: row.impressions, clicks: row.clicks, reach: row.reach, cpc: row.cpc, cpm: row.cpm, cpp: row.cpp, ctr: row.ctr, frequency: row.frequency, actions: row.actions, fields: row.fields });
    if (row.date > current.nameDate) {
      current.name = row.objectName || row.objectId;
      current.nameDate = row.date;
    }
    if (row.date > current.reachDate) {
      current.reach = row.reach;
      current.reachDate = row.date;
      current.frequency = row.frequency;
      current.cpp = row.cpp;
    }
    if (row.date > current.fieldsDate) {
      current.fields = row.fields;
      current.fieldsDate = row.date;
    }
    for (const action of actionItems(row.actions)) {
      if (typeof action.action_type !== "string") continue;
      const numericValue = typeof action.value === "number" ? action.value : Number(action.value);
      if (Number.isFinite(numericValue)) current.actionTotals.set(action.action_type, (current.actionTotals.get(action.action_type) ?? 0) + numericValue);
    }
  }
  return [...groups.values()].map(({ actionTotals, nameDate: _nameDate, ...summary }) => {
    summary.cpc = summary.clicks > 0 ? summary.spend / summary.clicks : null;
    summary.cpm = summary.impressions > 0 ? summary.spend * 1000 / summary.impressions : null;
    summary.ctr = summary.impressions > 0 ? summary.clicks * 100 / summary.impressions : null;
    summary.actions = [...actionTotals].map(([name, value]) => ({ name, value })).sort((a, b) => a.name.localeCompare(b.name));
    summary.dailyMetrics.sort((a, b) => b.date.getTime() - a.date.getTime());
    return summary;
  }).sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function groupSummariesByAccount(summaries: readonly AdsSummary[]) {
  const groups = new Map<string, AdsSummary[]>();
  for (const summary of summaries) groups.set(summary.accountId, [...(groups.get(summary.accountId) ?? []), summary]);
  return groups;
}
