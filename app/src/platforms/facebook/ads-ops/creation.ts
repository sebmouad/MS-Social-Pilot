/**
 * Facebook-owned protocol constants for paused campaign / ad-set creation.
 * Values are copied from the existing Facebook ads code (platforms/facebook/ads.ts,
 * adset.ts, publishing.ts) so the neutral host never sees them.
 */
export const FACEBOOK_CAMPAIGN_OBJECTIVES: readonly { value: string; label: string }[] = [
  { value: 'OUTCOME_AWARENESS', label: 'Awareness' }, { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement' },
  { value: 'OUTCOME_LEADS', label: 'Leads' }, { value: 'OUTCOME_SALES', label: 'Sales' },
  { value: 'OUTCOME_TRAFFIC', label: 'Traffic' }, { value: 'OUTCOME_APP_PROMOTION', label: 'App promotion' },
];

export const FACEBOOK_ADSET_OPTIMIZATION_GOALS: readonly { value: string; label: string }[] = [
  { value: 'LINK_CLICKS', label: 'Link clicks' }, { value: 'IMPRESSIONS', label: 'Impressions' },
];

/** Protocol invariants for ad-set creation, matching the existing adset.ts request. Never taken from callers. */
export const FACEBOOK_ADSET_CREATE_DEFAULTS = {
  billing_event: 'IMPRESSIONS',
  bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  location_types: ['home', 'recent'],
} as const;

/** Creation is always paused: delivery only starts through a separate, confirmed status change. */
export const FACEBOOK_CREATE_STATUS = 'PAUSED';

const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ ' +
  'OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

let countryOptions: readonly { value: string; label: string }[] | undefined;
/** ISO 3166-1 alpha-2 choices; labels come from Intl when available and fall back to the code. */
export function facebookCountryOptions(): readonly { value: string; label: string }[] {
  if (!countryOptions) {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { names = null; }
    countryOptions = COUNTRY_CODES.map(value => ({ value, label: `${names?.of(value) ?? value}` }));
  }
  return countryOptions;
}
export const isFacebookCountryCode = (value: string) => COUNTRY_CODES.includes(value);
