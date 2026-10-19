import { prisma } from '@/server/data';
import type { ReportEligibility, ReportGenerationPort, ReportMailPort } from '../contracts';

/**
 * Host registration. Report features are offered to customers only while a generation port is registered
 * AND the run-history table exists. Scheduled delivery additionally needs a mail port that reports itself ready
 * and an eligibility gate for the workspace owner's plan/access. Nothing is registered by importing this module.
 */
type Registered = { generation: ReportGenerationPort; mail: ReportMailPort | null; eligible: ReportEligibility | null };
let registered: Registered | null = null;
export function registerReportGeneration(input: { generation: ReportGenerationPort; mail?: ReportMailPort | null; eligible?: ReportEligibility | null }) {
  registered = { generation: input.generation, mail: input.mail ?? null, eligible: input.eligible ?? null };
}
export function unregisterReportGeneration() { registered = null; }
export const registeredReportPorts = () => registered;

let tableReady = false;
export function resetReportCapabilityCache() { tableReady = false; }
export async function runHistoryReady(): Promise<boolean> {
  if (tableReady) return true;
  try {
    const rows = await prisma.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('public.report_runs') IS NOT NULL AS present`;
    tableReady = rows[0]?.present === true; return tableReady;
  } catch { return false; }
}
/** Actual delivery readiness, asked each time. A port without a probe is taken as ready; a throwing probe is not ready. */
export async function mailReady(mail: ReportMailPort | null | undefined): Promise<boolean> {
  if (!mail) return false;
  if (!mail.ready) return true;
  try { return (await mail.ready()) === true; } catch { return false; }
}

export type ReportCapabilities = { generate: boolean; schedules: boolean };
/**
 * Customer-visible capability: run-now (a download) needs generation + history; schedules also need ready delivery.
 * Readiness of delivery never affects manual generation.
 */
export async function reportCapabilities(): Promise<ReportCapabilities> {
  if (!registered || !(await runHistoryReady())) return { generate: false, schedules: false };
  // A schedule that can never pass the owner-eligibility gate would look active while sending nothing.
  return { generate: true, schedules: registered.eligible !== null && await mailReady(registered.mail) };
}
