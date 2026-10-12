/**
 * Target audience per Page (NEXT_PHASES H0): where the people are, which
 * languages they read, their time zone and the cultural calendars to follow.
 * Nothing here is a default: every list starts empty and the user decides. A
 * Page with nothing set follows the workspace's defaults.
 *
 * A plain module, so client components can use it.
 */

/** ISO 3166-1 alpha-2 codes. Names come from `Intl.DisplayNames` in the reader's language. */
export const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

/** Calendars whose dates a Page can choose to follow (H2 reads them). None by default. */
export const CULTURAL_CALENDARS = [
  'public_holidays',
  'international_days',
  'christian_western',
  'christian_orthodox',
  'islamic',
  'jewish',
  'hindu',
  'lunar_new_year',
  'buddhist',
] as const;
export type CulturalCalendar = (typeof CULTURAL_CALENDARS)[number];

export interface Audience {
  countries: string[];
  /** BCP-47 tags, e.g. `fr-FR`, `en-US`. */
  languages: string[];
  /** IANA time zone; null follows the workspace's. */
  timezone: string | null;
  calendars: string[];
}

export const EMPTY_AUDIENCE: Audience = { countries: [], languages: [], timezone: null, calendars: [] };

/** A language tag in its canonical form, or null when it is not one. */
export function canonicalLanguage(tag: string): string | null {
  const cleaned = tag.trim().replace(/_/g, '-');
  if (!cleaned) return null;
  try {
    return Intl.getCanonicalLocales(cleaned)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * What a Page's audience is in practice: each part it set, else the
 * workspace's default for that part, else the workspace's time zone.
 */
export function effectiveAudience(page: Audience, workspace: Audience, workspaceTimezone: string): Audience & { timezone: string } {
  return {
    countries: page.countries.length > 0 ? page.countries : workspace.countries,
    languages: page.languages.length > 0 ? page.languages : workspace.languages,
    timezone: page.timezone ?? workspace.timezone ?? workspaceTimezone,
    calendars: page.calendars.length > 0 ? page.calendars : workspace.calendars,
  };
}

/** The audience columns of a Page or workspace row, as an `Audience`. */
export function audienceOf(row: {
  audienceCountries: string[];
  audienceLanguages: string[];
  audienceTimezone: string | null;
  audienceCalendars: string[];
}): Audience {
  return {
    countries: row.audienceCountries,
    languages: row.audienceLanguages,
    timezone: row.audienceTimezone,
    calendars: row.audienceCalendars,
  };
}
