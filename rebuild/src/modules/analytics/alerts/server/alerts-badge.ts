import { prisma } from '@/server/data';
import { authorizeReport } from '../../reports/server/access';
import type { ReportActor } from '../../reports/contracts';

/**
 * Open metric-alert firings in the person's channel scope, for the Measure hub
 * badge. It uses the same scope as the firing list, so the badge never counts
 * rules outside the member's channels. The count is capped; any refusal or
 * failure returns 0: a badge must never block a page.
 */
export async function openAlertCount(actor: ReportActor, cap = 100): Promise<number> {
  try {
    const auth = await authorizeReport(actor, 'read');
    const scope = auth.scope;
    if (scope && !scope.length) return 0;
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM (
        SELECT f.id FROM metric_alert_firings f JOIN metric_alert_rules r ON r.id = f."ruleId" AND r."workspaceId" = f."workspaceId"
        WHERE f."workspaceId" = ${actor.workspaceId} AND f.state = 'fired'
          AND (${scope === null}::boolean OR r."targetId" = ANY(${[...(scope ?? [])]}::text[]))
        LIMIT ${cap + 1}
      ) AS open`;
    return Math.min(Number(rows[0]?.count ?? 0), cap + 1);
  } catch {
    return 0;
  }
}
