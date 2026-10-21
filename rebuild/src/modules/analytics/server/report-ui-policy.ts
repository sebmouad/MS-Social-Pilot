import { analyticsError } from '@/modules/analytics/server/error-copy';
import { REPORT_UI_POLICY_SCHEMA, DEFAULT_REPORT_UI_POLICY } from '@/modules/analytics/report-ui-config';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { recapOffered } from '@/modules/analytics/reports/server/recap';
import type { ReportActor } from '@/modules/analytics/reports/contracts';

/** A Root policy saved before the AI recap existed has no label for it; add the default so the policy stays usable. */
function withRecapLabel(stored: unknown): unknown {
  const policy = stored as { sectionLabels?: Array<{ id?: unknown }> } | null;
  if (!policy || !Array.isArray(policy.sectionLabels) || policy.sectionLabels.some(item => item?.id === 'aiRecap')) return stored;
  return { ...policy, sectionLabels: [...policy.sectionLabels, DEFAULT_REPORT_UI_POLICY.sectionLabels.find(item => item.id === 'aiRecap')!] };
}

/**
 * Report choices. The AI recap is offered only when the caller passes an actor for whom AI assist is on and configured;
 * with no actor, or AI off, it is not among the choices or defaults.
 */
export async function loadReportUiPolicy(actor?: Pick<ReportActor, 'userId' | 'workspaceId' | 'permissionCeiling'>) {
  try {
    const parsed=REPORT_UI_POLICY_SCHEMA.safeParse(withRecapLabel(await runtimeConfig('analytics.reports.ui')));
    if(parsed.success){
      if(actor && await recapOffered(actor)) return parsed.data;
      const policy=parsed.data;
      return {...policy,enabledSections:policy.enabledSections.filter(id=>id!=='aiRecap'),defaultSections:policy.defaultSections.filter(id=>id!=='aiRecap'),sectionOptions:policy.sectionOptions.filter(item=>item.id!=='aiRecap')};
    }
  } catch { /* configuration details stay private */ }
  throw await analyticsError('unavailable', "Report choices could not be loaded. Try again shortly.");
}
