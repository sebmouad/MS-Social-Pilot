import { errorCopyDefaults } from '@/modules/analytics/error-copy';
import { analyticsError, localizeAnalyticsError } from '@/modules/analytics/server/error-copy';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { z } from 'zod';
import { ALERTS_POLICY_SCHEMA } from '../config';
import { alertConfirmation, alertListSchema, alertRuleActionSchema, type AlertMetric, type AlertOperator, type AlertRuleAction, type AlertWindowDays, type MetricAlertFiringView, type MetricAlertRuleView } from '../contracts';
import { audit, authorizeReport, bad, lockActor, missing, pageOf, usableChannelIds } from '../../reports/server/access';
import { transact } from '../../reports/server/limits';
import type { ReportActor } from '../../reports/contracts';

export type AlertActor = ReportActor;
export type AlertLimits = z.infer<typeof ALERTS_POLICY_SCHEMA>;

export async function alertLimits(): Promise<AlertLimits> {
  const parsed = ALERTS_POLICY_SCHEMA.safeParse(await runtimeConfig('analytics.alerts.policy'));
  if (!parsed.success) throw bad(errorCopyDefaults['Analytics workflows are temporarily unavailable. Try again later.'].en);
  return parsed.data;
}

type RuleRow = {
  id: string; targetId: string; targetName: string | null; name: string; metric: string; operator: string;
  threshold: number; windowDays: number; enabled: boolean; createdAt: Date; updatedAt: Date;
  usable: boolean | null; firingActual: number | null; firingAt: Date | null; evaluatedActual: number | null; evaluatedAt: Date | null;
};

/** Rules within the person's channel scope, with their open firing (if any) and latest evaluation. */
export async function listMetricAlertRules(actor: AlertActor, input: unknown = {}) {
  try {
    const parsed = alertListSchema.safeParse(input ?? {});
    if (!parsed.success) throw bad(errorCopyDefaults['Choose a valid result page.'].en);
    const auth = await authorizeReport(actor, 'read');
    const limits = await alertLimits();
    const size = pageOf(limits.rulesPageSize, auth.maxItems);
    const offset = (parsed.data.page ?? 1) - 1;
    const scope = auth.scope;
    if (scope && !scope.length) return { ok: true as const, rules: [] as MetricAlertRuleView[], page: parsed.data.page ?? 1, hasMore: false, canManage: false };
    if (parsed.data.channelId && scope && !scope.includes(parsed.data.channelId)) return { ok: true as const, rules: [] as MetricAlertRuleView[], page: parsed.data.page ?? 1, hasMore: false, canManage: auth.canManage };
    const channel = parsed.data.channelId ?? null;
    const rows = await prisma.$queryRaw<RuleRow[]>`SELECT r.id, r."targetId", t.name AS "targetName", r.name, r.metric, r.operator, r.threshold, r."windowDays", r.enabled, r."createdAt", r."updatedAt",
      (t.enabled = true AND a."invalidatedAt" IS NULL AND a.provider = ANY(${[...auth.providers]}::text[])) AS usable,
      f.actual AS "firingActual", f."firedAt" AS "firingAt", e.actual AS "evaluatedActual", e."firedAt" AS "evaluatedAt"
      FROM metric_alert_rules r
      LEFT JOIN targets t ON t.id = r."targetId" AND t."workspaceId" = r."workspaceId"
      LEFT JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId"
      LEFT JOIN metric_alert_firings f ON f."ruleId" = r.id AND f.state = 'fired'
      LEFT JOIN LATERAL (SELECT actual, "firedAt" FROM metric_alert_firings WHERE "ruleId" = r.id ORDER BY "firedAt" DESC, id DESC LIMIT 1) e ON true
      WHERE r."workspaceId" = ${actor.workspaceId}
        AND (${scope === null}::boolean OR r."targetId" = ANY(${[...(scope ?? [])]}::text[]))
        AND (${channel}::text IS NULL OR r."targetId" = ${channel})
      ORDER BY r.name ASC, r.id ASC OFFSET ${offset * size} LIMIT ${size + 1}`;
    const rules: MetricAlertRuleView[] = rows.slice(0, size).map(r => ({
      id: r.id, channelId: r.targetId, channelName: r.targetName, channelAvailable: r.usable === true,
      name: r.name, metric: r.metric as AlertMetric, operator: r.operator as AlertOperator, threshold: r.threshold,
      windowDays: (r.windowDays === 30 ? 30 : 7) as AlertWindowDays, enabled: r.enabled,
      state: r.firingActual !== null ? 'firing' : r.evaluatedAt !== null ? 'ok' : 'unknown',
      lastActual: r.firingActual ?? r.evaluatedActual, lastEvaluatedAt: r.firingAt ?? r.evaluatedAt,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }));
    return { ok: true as const, rules, page: parsed.data.page ?? 1, hasMore: rows.length > size, canManage: auth.canManage };
  } catch (error) { throw await localizeAnalyticsError(error); }
}

type FiringRow = { id: string; ruleId: string; ruleName: string; targetId: string; targetName: string | null; metric: string; operator: string; threshold: number; actual: number; periodStart: Date; periodEnd: Date; state: string; firedAt: Date; resolvedAt: Date | null };

/** Firing history within the person's channel scope, newest first. */
export async function listMetricAlertFirings(actor: AlertActor, input: unknown = {}) {
  try {
    const parsed = alertListSchema.safeParse(input ?? {});
    if (!parsed.success) throw bad(errorCopyDefaults['Choose a valid result page.'].en);
    const auth = await authorizeReport(actor, 'read');
    const limits = await alertLimits();
    const size = pageOf(limits.firingsPageSize, auth.maxItems);
    const offset = (parsed.data.page ?? 1) - 1;
    const scope = auth.scope;
    if (scope && !scope.length) return { ok: true as const, firings: [] as MetricAlertFiringView[], page: parsed.data.page ?? 1, hasMore: false };
    const channel = parsed.data.channelId ?? null;
    const resolved = parsed.data.includeResolved === true;
    const rows = await prisma.$queryRaw<FiringRow[]>`SELECT f.id, f."ruleId", r.name AS "ruleName", r."targetId", t.name AS "targetName", r.metric, r.operator, r.threshold, f.actual, f."periodStart", f."periodEnd", f.state, f."firedAt", f."resolvedAt"
      FROM metric_alert_firings f JOIN metric_alert_rules r ON r.id = f."ruleId" AND r."workspaceId" = f."workspaceId"
      LEFT JOIN targets t ON t.id = r."targetId" AND t."workspaceId" = r."workspaceId"
      WHERE f."workspaceId" = ${actor.workspaceId}
        AND (${scope === null}::boolean OR r."targetId" = ANY(${[...(scope ?? [])]}::text[]))
        AND (${channel}::text IS NULL OR r."targetId" = ${channel})
        AND (${resolved}::boolean OR f.state = 'fired')
      ORDER BY f."firedAt" DESC, f.id DESC OFFSET ${offset * size} LIMIT ${size + 1}`;
    const firings: MetricAlertFiringView[] = rows.slice(0, size).map(r => ({
      id: r.id, ruleId: r.ruleId, ruleName: r.ruleName, channelId: r.targetId, channelName: r.targetName,
      metric: r.metric as AlertMetric, operator: r.operator as AlertOperator, threshold: r.threshold,
      actual: r.actual, periodStart: r.periodStart, periodEnd: r.periodEnd,
      state: r.state === 'resolved' ? 'resolved' as const : 'fired' as const, firedAt: r.firedAt, resolvedAt: r.resolvedAt,
    }));
    return { ok: true as const, firings, page: parsed.data.page ?? 1, hasMore: rows.length > size };
  } catch (error) { throw await localizeAnalyticsError(error); }
}

/** Owners, admins and editors manage shared alert definitions; the channel must be usable when the rule is created. */
export async function manageMetricAlertRule(actor: AlertActor, input: unknown) {
  try {
    const parsed = alertRuleActionSchema.safeParse(input);
    if (!parsed.success) throw bad();
    const value: AlertRuleAction = parsed.data;
    const expected = value.action === 'create' ? alertConfirmation.createRule(value.channelId, value.metric) : value.action === 'update' ? alertConfirmation.updateRule(value.id) : alertConfirmation.deleteRule(value.id);
    if (value.confirmation !== expected) throw bad();
    const auth = await authorizeReport(actor, 'write', { manager: true });
    const limits = await alertLimits();
    return transact(actor.workspaceId, { timeout: limits.transactionTimeoutMs, maxWait: limits.transactionMaxWaitMs }, async tx => {
      const fresh = await lockActor(tx, actor);
      const inScope = (id: string) => fresh.scope === null || fresh.scope.includes(id);
      if (value.action === 'create') {
        if (!inScope(value.channelId) || !(await usableChannelIds(tx, actor.workspaceId, auth.providers, [value.channelId], true)).length) throw bad(errorCopyDefaults['Choose a channel you can manage in this workspace.'].en);
        const count = Number((await tx.$queryRaw<Array<{ count: bigint | number }>>`SELECT COUNT(*) AS count FROM metric_alert_rules WHERE "workspaceId" = ${actor.workspaceId}`)[0]?.count ?? 0);
        if (count >= limits.maxRulesPerWorkspace) throw await analyticsError('conflict', "This workspace has reached its metric alert limit. Delete one first.");
        const id = randomUUID();
        await tx.$executeRaw`INSERT INTO metric_alert_rules (id, "workspaceId", "targetId", name, metric, operator, threshold, "windowDays", enabled, "createdById", "createdAt", "updatedAt") VALUES (${id}, ${actor.workspaceId}, ${value.channelId}, ${value.name}, ${value.metric}, ${value.operator}, ${value.threshold}, ${value.windowDays}, ${value.enabled ?? true}, ${actor.userId}, NOW(), NOW())`;
        await audit(tx, actor, 'analytics.metric_alert_created', { ruleId: id, channelId: value.channelId, metric: value.metric, operator: value.operator, threshold: value.threshold, windowDays: value.windowDays });
        return { ok: true as const, action: value.action, id };
      }
      const current = (await tx.$queryRaw<Array<{ id: string; targetId: string }>>`SELECT id, "targetId" FROM metric_alert_rules WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`)[0];
      if (!current || !inScope(current.targetId)) throw missing();
      if (value.action === 'update') {
        const changed = await tx.$executeRaw`UPDATE metric_alert_rules SET name = ${value.name}, metric = ${value.metric}, operator = ${value.operator}, threshold = ${value.threshold}, "windowDays" = ${value.windowDays}, enabled = ${value.enabled}, "updatedAt" = NOW() WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
        if (!changed) throw missing();
        if (!value.enabled) await tx.$executeRaw`UPDATE metric_alert_firings SET state = 'resolved', "resolvedAt" = NOW() WHERE "ruleId" = ${value.id} AND state = 'fired'`;
        await audit(tx, actor, 'analytics.metric_alert_updated', { ruleId: value.id, channelId: current.targetId, metric: value.metric, enabled: value.enabled });
        return { ok: true as const, action: value.action, id: value.id };
      }
      // Firing history goes with the rule; past notifications stay in the notification center.
      const removed = await tx.$executeRaw`DELETE FROM metric_alert_rules WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
      if (!removed) throw missing();
      await audit(tx, actor, 'analytics.metric_alert_deleted', { ruleId: value.id, channelId: current.targetId });
      return { ok: true as const, action: value.action, id: value.id };
    });
  } catch (error) { throw await localizeAnalyticsError(error); }
}
