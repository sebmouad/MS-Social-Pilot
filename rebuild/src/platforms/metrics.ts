/**
 * Platform-neutral metric catalogue contracts.
 *
 * A platform module lists the metrics it stores (`PlatformModule.metrics`) with
 * a plain customer name, a one-line definition, a unit and the rule used to
 * combine the metric across channels and days. Shared analytics code only ever
 * reads these definitions: raw provider names are developer detail and appear
 * in the product only behind a "technical details" disclosure.
 */

/** What one number counts. Values are stored as: count, people, rate (percent or multiple), currency (major units), duration (seconds). */
export type MetricUnit = 'count' | 'people' | 'currency' | 'rate' | 'duration';

/**
 * How values combine.
 * - `sum`: events that add up across channels and days.
 * - `unique`: distinct people. Not additive: totals are an upper bound ("up to N") and each channel is listed separately.
 * - `latest`: a running total (for example followers). Each channel contributes its newest value; channels are summed.
 * - `rate`: recomputed from the summed parts, never averaged.
 */
export type MetricAggregation = 'sum' | 'unique' | 'latest' | 'rate';

/** `channel` metrics belong to a connected channel; `ads` metrics belong to an advertising account. */
export type MetricScope = 'channel' | 'ads';

export type MetricGroup = 'audience' | 'reach' | 'engagement' | 'profile' | 'video' | 'messaging' | 'advertising';

export const METRIC_GROUP_LABELS: Record<MetricGroup, string> = {
  audience: 'Audience',
  reach: 'Reach and views',
  engagement: 'Engagement',
  profile: 'Profile activity',
  video: 'Video',
  messaging: 'Messages',
  advertising: 'Advertising',
};

export interface MetricRetirement {
  /** Day (YYYY-MM-DD) the platform stopped serving the metric. */
  readonly on: string;
  /** Catalogue key of the metric that replaces it, when the platform names one. */
  readonly replacedBy?: string;
}

export interface MetricDefinition {
  /** Stored metric name. Never shown to customers outside technical details. */
  readonly key: string;
  readonly scope: MetricScope;
  /** Customer name. */
  readonly name: string;
  /** One plain sentence. */
  readonly definition: string;
  readonly unit: MetricUnit;
  readonly aggregation: MetricAggregation;
  readonly group: MetricGroup;
  /** Shown first in the key numbers. */
  readonly headline?: boolean;
  /** Values are label→number maps (for example by country), not a single number. */
  readonly breakdown?: boolean;
  /** For `rate` metrics: `numerator / denominator * scale`, from the summed parts (catalogue keys in the same scope). */
  readonly rate?: { readonly numerator: string; readonly denominator: string; readonly scale?: number; readonly style: 'percent' | 'multiple' | 'money' };
  /** A falling number is an improvement (costs). */
  readonly lowerIsBetter?: boolean;
  /** Neither a rise nor a fall is good or bad (for example spend). */
  readonly neutral?: boolean;
  /** Multiplier applied to stored values (for example milliseconds to seconds). */
  readonly valueScale?: number;
  readonly retired?: MetricRetirement;
}

/** Shorthand used by module catalogues. */
export function channelMetric(key: string, name: string, definition: string, unit: MetricUnit, aggregation: MetricAggregation, group: MetricGroup, extra: Partial<MetricDefinition> = {}): MetricDefinition {
  return { key, scope: 'channel', name, definition, unit, aggregation, group, ...extra };
}

export function adsMetric(key: string, name: string, definition: string, unit: MetricUnit, aggregation: MetricAggregation, extra: Partial<MetricDefinition> = {}): MetricDefinition {
  return { key, scope: 'ads', name, definition, unit, aggregation, group: 'advertising', ...extra };
}

/** Whether the platform has stopped serving the metric as of `now`. */
export function isRetired(definition: Pick<MetricDefinition, 'retired'>, now: Date = new Date()): boolean {
  return Boolean(definition.retired) && now.getTime() >= Date.parse(`${definition.retired!.on}T00:00:00Z`);
}

/** Turns a stored name into readable words for metrics no module describes. */
export function humanizeMetricKey(key: string): string {
  const cleaned = key.replace(/^(page|post)_/, '').replace(/[:_]+/g, ' ').trim();
  const words = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return words || 'Other measure';
}
