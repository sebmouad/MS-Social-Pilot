/**
 * How figures add up across several profiles (NEXT_PHASES §B2).
 *
 * Pure, so the rules are tested once and every screen that totals profiles —
 * the Total view, the compare table's totals row, reports — says the same.
 *
 * - Counts (posts, interactions, follows gained or lost) add up.
 * - Followers: the sum of each profile's latest figure.
 * - Unique people (reach) do not add up: someone who saw two Pages is counted
 *   once per Page, so the sum is an upper bound, shown as "up to N".
 * - Rates are recomputed from summed parts, never averaged.
 * - Money is summed per currency and never across two.
 */

/** Sum of the values that are known; null when none is. */
export function sumKnown(values: ReadonlyArray<number | null | undefined>): number | null {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
}

/** A rate from summed parts, rounded to one decimal; null without a denominator. */
export function ratio(numerator: number | null, denominator: number | null, scale = 1): number | null {
  if (numerator === null || !denominator) return null;
  return Math.round((numerator / denominator) * scale * 10) / 10;
}

export interface ProfileFigures {
  followers: number | null;
  netFollows: number | null;
  posts: number;
  interactions: number;
  reach: number | null;
}

export interface ProfileTotals {
  profiles: number;
  followers: number | null;
  netFollows: number | null;
  posts: number;
  interactions: number;
  /** All interactions over all posts — not the average of each profile's average. */
  interactionsPerPost: number | null;
  /** Upper bound of the people reached: unique reach does not add up. */
  reachUpTo: number | null;
  /** How many profiles the reach bound is built from (some have none). */
  reachProfiles: number;
}

export function totalProfiles(rows: ReadonlyArray<ProfileFigures>): ProfileTotals {
  const posts = rows.reduce((total, row) => total + row.posts, 0);
  const interactions = rows.reduce((total, row) => total + row.interactions, 0);
  return {
    profiles: rows.length,
    followers: sumKnown(rows.map((row) => row.followers)),
    netFollows: sumKnown(rows.map((row) => row.netFollows)),
    posts,
    interactions,
    interactionsPerPost: posts ? Math.round(interactions / posts) : null,
    reachUpTo: sumKnown(rows.map((row) => row.reach)),
    reachProfiles: rows.filter((row) => typeof row.reach === 'number').length,
  };
}

/** Amounts grouped by currency, largest first; never one figure across two currencies. */
export function sumByCurrency(
  rows: ReadonlyArray<{ currency: string | null; amount: number | null }>,
): Array<{ currency: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.amount === null || !Number.isFinite(row.amount)) continue;
    const currency = row.currency?.toUpperCase() || '?';
    totals.set(currency, (totals.get(currency) ?? 0) + row.amount);
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount);
}

/** The top `limit` rows by a figure, unknown figures left out. */
export function topBy<T>(rows: ReadonlyArray<T>, pick: (row: T) => number | null, limit = 5): T[] {
  return rows
    .filter((row) => pick(row) !== null)
    .sort((a, b) => (pick(b) ?? 0) - (pick(a) ?? 0))
    .slice(0, limit);
}
