import { REPORT_UI_POLICY_SCHEMA } from '@/modules/analytics/report-ui-config';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';

export async function loadReportUiPolicy() {
  try {
    const parsed=REPORT_UI_POLICY_SCHEMA.safeParse(await runtimeConfig('analytics.reports.ui'));
    if(parsed.success)return parsed.data;
  } catch { /* configuration details stay private */ }
  throw new OperationError('unavailable','Report choices could not be loaded. Try again shortly.');
}
