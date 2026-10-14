/**
 * The analytics Summary: one or many channels, this period against the one
 * before, by the aggregation rules in `aggregate.ts`.
 *
 * Pure, with no server imports, so it is tested with literal rows and can be
 * shared with client components.
 */
import { ratio, sumKnown, totalProfiles, type ProfileFigures } from './aggregate';
import { change, type Finding } from './page-analysis';

/** What the Summary needs from each channel (a `PageComparisonRow` fits). */
export interface SummaryChannel extends ProfileFigures {
  targetId: string;
  name: string;
  follows: number | null;
  unfollows: number | null;
  findings: Finding[];
  previous: { followers: number | null; posts: number; interactions: number; reach: number | null; netFollows: number | null };
}

export type SummaryKpiKey = 'reach' | 'interactions' | 'followers' | 'rate' | 'posts' | 'perPost';

export interface SummaryKpi {
  key: SummaryKpiKey;
  current: number | null;
  previous: number | null;
  /** Percentage change, rounded; null without both figures. */
  change: number | null;
}

export interface SummaryFigures {
  kpis: SummaryKpi[];
  /** Net change in followers over the window, with its parts where known. */
  netFollows: number | null;
  follows: number | null;
  unfollows: number | null;
  /** True when reach is a sum over several channels, so an upper bound ("up to"). */
  reachIsUpperBound: boolean;
}

/**
 * Headline figures for the selection, now and before.
 *
 * Counts add up; reach is summed per channel and flagged as an upper bound
 * when there is more than one; the interaction rate is recomputed from summed
 * interactions over summed reach, never averaged. Historical followers come
 * from stored Page snapshots; missing snapshots never become estimated totals.
 */
export function summaryFigures(rows: ReadonlyArray<SummaryChannel>): SummaryFigures {
  const now = totalProfiles(rows);
  const before = totalProfiles(
    rows.map((row) => ({
      followers: row.previous.followers,
      netFollows: row.previous.netFollows,
      posts: row.previous.posts,
      interactions: row.previous.interactions,
      reach: row.previous.reach,
    })),
  );

  const followersBefore = rows.length > 0 && rows.every((row) => row.followers !== null && row.previous.followers !== null)
    ? before.followers : null;
  // No posts, no rate: 0 % would read as posts that nobody touched.
  const rateNow = now.posts ? ratio(now.interactions, now.reachUpTo, 100) : null;
  const rateBefore = before.posts ? ratio(before.interactions, before.reachUpTo, 100) : null;

  const kpi = (key: SummaryKpiKey, current: number | null, previous: number | null): SummaryKpi => ({
    key,
    current,
    previous,
    change: change(current, previous),
  });

  return {
    kpis: [
      kpi('reach', now.reachUpTo, before.reachUpTo),
      kpi('interactions', now.interactions, before.interactions),
      kpi('followers', now.followers, followersBefore),
      kpi('rate', rateNow, rateBefore),
      kpi('posts', now.posts, before.posts),
      kpi('perPost', now.interactionsPerPost, before.interactionsPerPost),
    ],
    netFollows: now.netFollows,
    follows: sumKnown(rows.map((row) => row.follows)),
    unfollows: sumKnown(rows.map((row) => row.unfollows)),
    reachIsUpperBound: rows.length > 1,
  };
}

/** Findings about the data itself rather than the channel: not news in a summary. */
const HOUSEKEEPING = new Set(['stale', 'neverSynced']);
const TONE_ORDER: Record<Finding['tone'], number> = { warning: 0, good: 1, info: 2 };

export interface ChannelFinding {
  finding: Finding;
  /** The channels it is about, in order; empty when only one channel is selected. */
  channels: string[];
}

/**
 * The few findings worth reading first, across every selected channel.
 *
 * Warnings before good news before tips; within a tone, channels keep their
 * order and each channel's own order. At most one finding per channel until
 * every channel has had one, so a single busy channel does not fill the box.
 */
export function combinedFindings(rows: ReadonlyArray<SummaryChannel>, limit = 3): ChannelFinding[] {
  const several = rows.length > 1;
  // The same sentence about several channels is said once, naming them all.
  const bySentence = new Map<string, { finding: Finding; channels: string[]; channelIndex: number; rank: number }>();
  rows.forEach((row, channelIndex) =>
    row.findings
      .filter((finding) => !HOUSEKEEPING.has(finding.key))
      .forEach((finding, rank) => {
        const key = JSON.stringify(finding);
        const seen = bySentence.get(key);
        if (seen) {
          seen.channels.push(row.name);
          seen.rank = Math.min(seen.rank, rank);
        }
        else bySentence.set(key, { finding, channels: several ? [row.name] : [], channelIndex, rank });
      }),
  );
  const candidates = [...bySentence.values()];
  candidates.sort(
    (a, b) =>
      a.rank - b.rank ||
      TONE_ORDER[a.finding.tone] - TONE_ORDER[b.finding.tone] ||
      a.channelIndex - b.channelIndex,
  );
  // Each channel's first finding before anyone's second; then shown by tone.
  const picked = candidates.slice(0, limit);
  picked.sort((a, b) => TONE_ORDER[a.finding.tone] - TONE_ORDER[b.finding.tone] || a.channelIndex - b.channelIndex);
  return picked.map(({ finding, channels }) => ({ finding, channels: several ? channels : [] }));
}

export interface ChannelChange {
  targetId: string;
  name: string;
  /** Which figure the change is of: interactions, or reach when there are none either time. */
  figure: 'interactions' | 'reach';
  current: number | null;
  change: number | null;
}

/** Each channel's change against the comparison window, biggest movement first. */
export function channelChanges(rows: ReadonlyArray<SummaryChannel>): ChannelChange[] {
  return rows
    .map((row): ChannelChange => {
      const quiet = row.interactions === 0 && row.previous.interactions === 0;
      return quiet
        ? { targetId: row.targetId, name: row.name, figure: 'reach', current: row.reach, change: change(row.reach, row.previous.reach) }
        : {
            targetId: row.targetId,
            name: row.name,
            figure: 'interactions',
            current: row.interactions,
            change: change(row.interactions, row.previous.interactions),
          };
    })
    .sort((a, b) => Math.abs(b.change ?? -1) - Math.abs(a.change ?? -1));
}

/** Several channels' daily values added up day by day (shorter series pad with 0). */
export function sumSeries(series: ReadonlyArray<ReadonlyArray<number>>): number[] {
  const length = Math.max(0, ...series.map((values) => values.length));
  return Array.from({ length }, (_, day) => series.reduce((sum, values) => sum + (values[day] ?? 0), 0));
}

/** An aggregate day is unknown if any selected channel lacks a reading. */
export function sumCompleteSeries(series: ReadonlyArray<ReadonlyArray<number | null>>): Array<number | null> {
  const length = Math.max(0, ...series.map((values) => values.length));
  return Array.from({ length }, (_, day) =>
    series.length > 0 && series.every((values) => typeof values[day] === 'number')
      ? series.reduce((sum, values) => sum + (values[day] as number), 0)
      : null,
  );
}

/** Daily values grouped into consecutive weeks of seven days, from the first day. */
export function weekly(values: ReadonlyArray<number>): number[] {
  const out: number[] = [];
  for (let start = 0; start < values.length; start += 7) {
    out.push(values.slice(start, start + 7).reduce((sum, value) => sum + value, 0));
  }
  return out;
}

/** A weekly figure is unavailable if any day in that week is missing. */
export function weeklyComplete(values: ReadonlyArray<number | null>): Array<number | null> {
  const out: Array<number | null> = [];
  for (let start = 0; start < values.length; start += 7) {
    const days = values.slice(start, start + 7);
    out.push(days.every((value): value is number => value !== null)
      ? days.reduce((sum, value) => sum + value, 0)
      : null);
  }
  return out;
}
