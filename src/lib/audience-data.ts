import { Prisma } from '@prisma/client';

import { COUNTRY_CODES, canonicalLanguage } from './audience';
import { prisma } from './prisma';

/** Newest name first: Meta replaced `page_fans_*` with `page_follows_*` in November 2025. */
const COUNTRY = ['page_follows_country', 'page_fans_country'];
const LOCALE = ['page_follows_locale', 'page_fans_locale'];
const TOP = 3;
/** Facebook locales whose region part is not a real region. */
const FACEBOOK_LOCALES: Record<string, string> = { es_LA: 'es-419', ar_AR: 'ar' };

export interface AudienceSuggestion {
  countries: string[];
  languages: string[];
}

function top(breakdown: Record<string, number> | undefined, normalise: (key: string) => string | null): string[] {
  if (!breakdown) return [];
  const seen = new Set<string>();
  for (const [key] of Object.entries(breakdown).sort((a, b) => b[1] - a[1])) {
    const value = normalise(key);
    if (value) seen.add(value);
    if (seen.size === TOP) break;
  }
  return [...seen];
}

/**
 * What each Page's own followers suggest for its audience (H0): the top
 * countries and languages from the newest stored breakdowns. Only a
 * suggestion; nothing is saved until the user picks it. Database only.
 */
export async function suggestAudiences(targetIds: string[]): Promise<Record<string, AudienceSuggestion>> {
  if (targetIds.length === 0) return {};
  const rows = await prisma.$queryRaw<Array<{ targetId: string; metric: string; value: unknown }>>`
    SELECT DISTINCT ON ("targetId", metric) "targetId", metric, value
    FROM page_insights
    WHERE "targetId" IN (${Prisma.join(targetIds)})
      AND metric IN (${Prisma.join([...COUNTRY, ...LOCALE])})
    ORDER BY "targetId", metric, "endTime" DESC
  `;

  const breakdown = (targetId: string, metrics: string[]) => {
    for (const metric of metrics) {
      const value = rows.find((row) => row.targetId === targetId && row.metric === metric)?.value;
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
        return value as Record<string, number>;
      }
    }
    return undefined;
  };

  const out: Record<string, AudienceSuggestion> = {};
  for (const targetId of targetIds) {
    const suggestion = {
      countries: top(breakdown(targetId, COUNTRY), (code) => (COUNTRY_CODES.includes(code) ? code : null)),
      // Facebook's locales read `fr_FR`.
      languages: top(breakdown(targetId, LOCALE), (key) => canonicalLanguage(FACEBOOK_LOCALES[key] ?? key)),
    };
    if (suggestion.countries.length > 0 || suggestion.languages.length > 0) out[targetId] = suggestion;
  }
  return out;
}
