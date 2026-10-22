import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { facebookGraphUsageCopySchema, facebookGraphUsagePolicySchema } from './graph-usage-config';
import type { PlatformApiUsageScope } from '@/server/platforms/host';

type Snapshot = { capturedAt: string; metrics: Array<{ key: string; value: number }>; scopeId?: string };
const lastWrite = new Map<string, number>();
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const metricsOf = (value: unknown, keys: readonly string[]) => {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return keys.flatMap(key => { const n = finite(record[key]); return n === null ? [] : [{ key, value: n }]; });
};
const parse = (raw: string | null): unknown => { if (!raw || raw.length > 8192) return null; try { return JSON.parse(raw); } catch { return null; } };

/** Pure: turn Graph usage headers into per-scope snapshots (one header can carry several business use cases). */
export function graphUsageSnapshots(headers: Headers, now: Date): Array<{ key: string; snapshot: Snapshot }> {
  const capturedAt = now.toISOString();
  const out: Array<{ key: string; snapshot: Snapshot }> = [];
  const app = metricsOf(parse(headers.get('x-app-usage')), ['call_count', 'total_time', 'total_cputime']);
  if (app.length) out.push({ key: 'app', snapshot: { capturedAt, metrics: app } });
  const accountMetrics = metricsOf(parse(headers.get('x-ad-account-usage')), ['acc_id_util_pct', 'reset_time_duration']);
  if (accountMetrics.length) out.push({ key: 'ad-account', snapshot: { capturedAt, metrics: accountMetrics } });
  const business = parse(headers.get('x-business-use-case-usage'));
  if (business && typeof business === 'object' && !Array.isArray(business)) {
    for (const [id, rows] of Object.entries(business as Record<string, unknown>).slice(0, 20)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows.slice(0, 20)) {
        const type = row && typeof row === 'object' && typeof (row as { type?: unknown }).type === 'string' ? (row as { type: string }).type.slice(0, 80) : 'unknown';
        const metrics = metricsOf(row, ['call_count', 'total_time', 'total_cputime', 'estimated_time_to_regain_access']);
        if (metrics.length) out.push({ key: `business-use-case:${id.slice(0, 40)}:${type}`, snapshot: { capturedAt, metrics, scopeId: type } });
      }
    }
  }
  return out;
}

export async function recordFacebookGraphUsage(headers: Headers, now: Date = new Date()): Promise<void> {
  if (!headers.get('x-app-usage') && !headers.get('x-ad-account-usage') && !headers.get('x-business-use-case-usage')) return;
  const policy = facebookGraphUsagePolicySchema.parse(await runtimeConfig('meta.graphUsagePolicy'));
  if (!policy.enabled) return;
  for (const { key, snapshot } of graphUsageSnapshots(headers, now)) {
    const previous = lastWrite.get(key);
    if (previous !== undefined && now.getTime() - previous < policy.minWriteIntervalSeconds * 1000) continue;
    lastWrite.set(key, now.getTime());
    await prisma.$executeRaw`INSERT INTO graph_usage (key, snapshot, "savedAt") VALUES (${key}, ${JSON.stringify(snapshot)}::jsonb, ${now}) ON CONFLICT (key) DO UPDATE SET snapshot = EXCLUDED.snapshot, "savedAt" = EXCLUDED."savedAt"`;
  }
}

/** Wrap a fetch so every Graph response feeds the recorder; recording never affects the request outcome. */
export function withGraphUsageRecording(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await base(input, init);
    void recordFacebookGraphUsage(response.headers).catch(() => undefined);
    return response;
  };
}

export async function readFacebookGraphUsage(limit: number, locale: 'en' | 'fr' = 'en', now: Date = new Date()): Promise<PlatformApiUsageScope[]> {
  const [policyRaw, copyRaw] = await Promise.all([runtimeConfig('meta.graphUsagePolicy'), runtimeConfig('meta.graphUsageCopy')]);
  const policy = facebookGraphUsagePolicySchema.parse(policyRaw);
  const copy = facebookGraphUsageCopySchema.parse(copyRaw)[locale];
  const rows = await prisma.$queryRaw<Array<{ key: string; snapshot: Snapshot; savedAt: Date }>>`SELECT key, snapshot, "savedAt" FROM graph_usage ORDER BY key LIMIT ${Math.min(limit, policy.maxScopes)}`;
  const known: Record<string, { label: string; unit: 'percent' | 'seconds' | 'minutes'; warn: boolean }> = {
    call_count: { label: copy.callCount, unit: 'percent', warn: true }, total_time: { label: copy.totalTime, unit: 'percent', warn: true }, total_cputime: { label: copy.totalCpuTime, unit: 'percent', warn: true },
    acc_id_util_pct: { label: copy.accountUtilization, unit: 'percent', warn: true }, reset_time_duration: { label: copy.accountResetSeconds, unit: 'seconds', warn: false },
    estimated_time_to_regain_access: { label: copy.regainMinutes, unit: 'minutes', warn: false },
  };
  return rows.map(row => {
    const captured = new Date(row.snapshot.capturedAt ?? row.savedAt);
    const label = row.key === 'app' ? copy.app : row.key === 'ad-account' ? copy.adAccount : `${copy.businessUseCase}${row.snapshot.scopeId ? ` · ${row.snapshot.scopeId}` : ''}`;
    return {
      scope: row.key, label, capturedAt: captured.toISOString(), stale: now.getTime() - captured.getTime() > policy.staleAfterSeconds * 1000,
      metrics: (row.snapshot.metrics ?? []).flatMap(metric => { const meta = known[metric.key]; return meta ? [{ key: metric.key, label: meta.label, value: metric.value, unit: meta.unit, warning: meta.warn && metric.value >= policy.warnPercent }] : []; }),
    };
  });
}
