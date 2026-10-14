import { audienceGrowthIdentity } from './audience-growth-metrics';
import type { AudienceSummary } from './analytics';

type AudienceRow = { id: string; name: string; network: string; audience: AudienceSummary };
type ExtraRow = { key: string; name: string; network: string; followers: number | null };

const sum = (values: Array<number | null>) => values.some((value) => value !== null)
  ? values.reduce<number>((total, value) => total + (value ?? 0), 0)
  : null;
const breakdown = (rows: AudienceSummary[], key: 'byCountry' | 'byCity' | 'byLocale' | 'byGenderAge') => {
  const result: Record<string, number> = {};
  for (const row of rows) for (const [name, value] of Object.entries(row[key])) {
    if (Number.isFinite(value)) result[name] = (result[name] ?? 0) + value;
  }
  return result;
};

/** Account totals are additive; unavailable accounts remain visible in coverage. */
export function audienceTotal(pages: AudienceRow[], extras: ExtraRow[]) {
  const followerRows = [...pages.map((row) => ({ name: row.name, network: row.network, followers: row.audience.followers })), ...extras];
  const followerValues = followerRows.map((row) => row.followers);
  const growthRows = pages.filter((row) =>
    audienceGrowthIdentity(row.audience.addsMetric, 'gained').kind === 'followers' &&
    audienceGrowthIdentity(row.audience.removesMetric, 'lost').kind === 'followers' &&
    row.audience.adds !== null && row.audience.removes !== null);
  const values = growthRows.map((row) => row.audience);
  const gained = sum(values.map((row) => row.adds));
  const lost = sum(values.map((row) => row.removes));
  return {
    followers: sum(followerValues),
    followerCoverage: followerValues.filter((value) => value !== null).length,
    selectedCount: followerRows.length,
    fans: sum(pages.map((row) => row.audience.fans)),
    talkingAbout: sum(pages.map((row) => row.audience.talkingAbout)),
    gained, lost, net: gained !== null && lost !== null ? gained - lost : null,
    growthCoverage: growthRows.length,
    byCountry: breakdown(pages.map((row) => row.audience), 'byCountry'),
    byCity: breakdown(pages.map((row) => row.audience), 'byCity'),
    byLocale: breakdown(pages.map((row) => row.audience), 'byLocale'),
    byGenderAge: breakdown(pages.map((row) => row.audience), 'byGenderAge'),
    rows: followerRows,
  };
}
