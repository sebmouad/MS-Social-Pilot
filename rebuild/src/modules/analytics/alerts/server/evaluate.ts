import { localizeAnalyticsError } from '@/modules/analytics/server/error-copy';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { emitWorkspaceAlert } from '@/modules/settings/notifications/producers';
import { platformAnalytics } from '@/server/platforms/registry';
import { assertWorkspaceJobAccess } from '@/server/jobs/access';
import type { Prisma } from '../../../../../generated/client';
import { audit, usableChannelIds } from '../../reports/server/access';
import { alertLimits, type AlertLimits } from './rules';
import type { AlertMetric } from '../contracts';

type Tx = Prisma.TransactionClient;
type RuleRow = { id: string; workspaceId: string; targetId: string; name: string; metric: string; operator: string; threshold: number; windowDays: number; provider: string | null };
export type AlertEvaluationSummary = { examined: number; fired: number; resolved: number; skipped: number; failed: number };
export type AlertMeasurePort = (input: { workspaceId: string; targetId: string; provider: string | null; metric: AlertMetric; from: Date; to: Date }) => Promise<number | null>;
export type EvaluateDeps = { now?: Date; limits?: AlertLimits; measures?: AlertMeasurePort };

const emptySummary = (): AlertEvaluationSummary => ({ examined: 0, fired: 0, resolved: 0, skipped: 0, failed: 0 });

/**
 * Neutral stored reads, the same quantities Goals shows: published-post
 * counts from local post state, everything else from the channel module's
 * stored goal measures. Null means unknown and never becomes a firing.
 */
export const storedAlertMeasure: AlertMeasurePort = async ({ workspaceId, targetId, provider, metric, from, to }) => {
  if (metric === 'posts') {
    const [count] = await prisma.$queryRaw<Array<{ count: bigint | number }>>`SELECT COUNT(*) AS count FROM post_targets pt JOIN targets t ON t.id = pt."targetId" WHERE pt."targetId" = ${targetId} AND t."workspaceId" = ${workspaceId} AND pt.status = 'published' AND pt."publishedAt" >= ${from} AND pt."publishedAt" < ${to}`;
    return Number(count?.count ?? 0);
  }
  const analytics = provider ? await platformAnalytics(provider) : null;
  if (!analytics?.goalMeasures) return null;
  const measures = await analytics.goalMeasures({ workspaceId, targetId, from, to });
  if (metric === 'followers') return measures.audienceGained;
  if (metric === 'views') return measures.views;
  return measures.engagements;
};

const crossed = (operator: string, actual: number, threshold: number) => operator === 'above' ? actual >= threshold : actual <= threshold;

/**
 * Job body for the shared worker (which holds the job lease). Each enabled
 * rule is evaluated in its own transaction: workspace and channel authority
 * are rechecked, the stored actual is read, and a firing opens (once, with
 * one notification) or resolves. Unknown measurements change nothing.
 */
export async function evaluateMetricAlerts(deps: EvaluateDeps = {}): Promise<AlertEvaluationSummary> {
  try {
    const summary = emptySummary();
    const now = deps.now ?? new Date();
    const limits = deps.limits ?? await alertLimits();
    const measures = deps.measures ?? storedAlertMeasure;
    let rules: RuleRow[];
    try {
      rules = await prisma.$queryRaw<RuleRow[]>`SELECT r.id, r."workspaceId", r."targetId", r.name, r.metric, r.operator, r.threshold, r."windowDays", a.provider
        FROM metric_alert_rules r JOIN workspaces w ON w.id = r."workspaceId"
        LEFT JOIN targets t ON t.id = r."targetId" AND t."workspaceId" = r."workspaceId"
        LEFT JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId"
        WHERE r.enabled = true AND w."suspendedAt" IS NULL
          AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = r."workspaceId" AND p.status::text <> 'completed')
        ORDER BY r."updatedAt" ASC, r.id ASC LIMIT ${limits.evaluateBatchSize}`;
    } catch {
      return summary;
    }
    for (const rule of rules) {
      summary.examined += 1;
      try {
        const outcome = await prisma.$transaction(async tx => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT r.id FROM metric_alert_rules r JOIN workspaces w ON w.id = r."workspaceId" WHERE r.id = ${rule.id} AND r."workspaceId" = ${rule.workspaceId} AND r.enabled = true AND w."suspendedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = r."workspaceId" AND p.status::text <> 'completed') FOR UPDATE OF r SKIP LOCKED`;
          if (!locked.length) return 'skipped' as const;
          if (!rule.provider) return 'skipped' as const;
          try { await assertWorkspaceJobAccess(rule.workspaceId, { provider: rule.provider, anyFeatureOf: ['analytics/reports'] }); }
          catch { return 'skipped' as const; }
          if (!(await usableChannelIds(tx, rule.workspaceId, [rule.provider], [rule.targetId])).length) return 'skipped' as const;
          const to = now;
          const from = new Date(to.getTime() - rule.windowDays * 86_400_000);
          let actual: number | null;
          try {
            actual = await measures({ workspaceId: rule.workspaceId, targetId: rule.targetId, provider: rule.provider, metric: rule.metric as AlertMetric, from, to });
          } catch { return 'failed' as const; }
          if (actual === null || !Number.isFinite(actual)) return 'skipped' as const;
          if (!crossed(rule.operator, actual, rule.threshold)) {
            const resolved = await tx.$executeRaw`UPDATE metric_alert_firings SET state = 'resolved', "resolvedAt" = ${now} WHERE "ruleId" = ${rule.id} AND state = 'fired'`;
            if (resolved) await audit(tx, { userId: null, workspaceId: rule.workspaceId }, 'analytics.metric_alert_resolved', { ruleId: rule.id, channelId: rule.targetId, actual });
            return resolved ? 'resolved' as const : 'skipped' as const;
          }
          const id = randomUUID();
          const inserted = await tx.$queryRaw<Array<{ id: string }>>`INSERT INTO metric_alert_firings (id, "workspaceId", "ruleId", "periodStart", "periodEnd", actual, state, "firedAt") VALUES (${id}, ${rule.workspaceId}, ${rule.id}, ${from}, ${to}, ${actual}, 'fired', ${now}) ON CONFLICT ("ruleId") WHERE state = 'fired' DO NOTHING RETURNING id`;
          if (!inserted.length) return 'skipped' as const;
          await audit(tx, { userId: null, workspaceId: rule.workspaceId }, 'analytics.metric_alert_fired', { ruleId: rule.id, channelId: rule.targetId, metric: rule.metric, actual, threshold: rule.threshold });
          await emitWorkspaceAlert(tx, { workspaceId: rule.workspaceId, eventId: `metric_alert_${rule.id}_${inserted[0]!.id}`, kind: 'metric_alert', targetId: rule.targetId });
          return 'fired' as const;
        });
        if (outcome === 'fired') summary.fired += 1;
        else if (outcome === 'resolved') summary.resolved += 1;
        else if (outcome === 'failed') summary.failed += 1;
        else summary.skipped += 1;
      } catch { summary.failed += 1; }
    }
    return summary;
  } catch (error) { throw await localizeAnalyticsError(error); }
}
