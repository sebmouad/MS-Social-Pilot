import { evaluateMetricAlerts, type AlertEvaluationSummary } from './evaluate';

/** Worker assembly for the shared `analyticsAlerts` job. Stored data only; no provider fan-out. */
export async function runMetricAlerts(now = new Date()): Promise<AlertEvaluationSummary> {
  return evaluateMetricAlerts({ now });
}
