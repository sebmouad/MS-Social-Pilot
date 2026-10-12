/** The parts a report can be made of, in the order they print. */
export const REPORT_SECTIONS = ['analysis', 'goals', 'responseTime', 'audience', 'published', 'destinations', 'topPosts'] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

/** `?sections=a,b` to the sections it names; all of them when absent or empty. */
export function parseSections(raw: string | undefined): ReportSection[] {
  if (!raw) return [...REPORT_SECTIONS];
  const named = raw.split(',').map((value) => value.trim());
  const chosen = REPORT_SECTIONS.filter((section) => named.includes(section));
  return chosen.length > 0 ? chosen : [...REPORT_SECTIONS];
}
