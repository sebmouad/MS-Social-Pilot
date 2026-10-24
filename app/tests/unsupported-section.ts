import { REPORT_SUPPORTED_SECTIONS, type ReportSectionId } from '../src/modules/analytics/reports/contracts';

/**
 * Every stored report section is implemented now, so the "stored but not supplied" rule is exercised by
 * temporarily removing one section from the supported list (the readers consult it at call time).
 */
export async function withUnsupported<T>(section: ReportSectionId, run: () => T | Promise<T>): Promise<T> {
  const list = REPORT_SUPPORTED_SECTIONS as unknown as string[];
  const index = list.indexOf(section);
  if (index < 0) throw new Error('section is already unsupported');
  list.splice(index, 1);
  try { return await run(); } finally { list.splice(index, 0, section); }
}
