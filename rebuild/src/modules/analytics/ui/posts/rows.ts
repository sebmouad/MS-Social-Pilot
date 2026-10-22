import type { PostThumbnail } from '@/components/post-thumbnail';
import type { InstantFormatter } from '@/server/instant-labels';
import type { PostsTableMeasure, PostsTableRow } from './PostsTable';

type PostItem = {
  channelId: string; channelName: string; postId: string; text: string; url: string | null;
  publishedAt: Date | null; measuredAt: Date | null;
  measures: Array<{ key: string; value: number | null }>;
  /** Stored image/poster/picture reference resolved by the read model; absent when none is stored. */
  thumbnail?: PostThumbnail | null;
};

/** Serializable rows for PostsTable: dates become ISO strings and measures a keyed record. */
export function postsTableRows(items: readonly PostItem[], instants: InstantFormatter): PostsTableRow[] {
  return items.map(item => ({
    key: `${item.channelId}:${item.postId}`, thumbnail: item.thumbnail ?? null, text: item.text, url: item.url, channelName: item.channelName,
    publishedAt: item.publishedAt?.toISOString() ?? null, measuredAt: item.measuredAt?.toISOString() ?? null,
    measures: Object.fromEntries(item.measures.map(measure => [measure.key, measure.value])),
    labels: { ...(item.publishedAt ? { publishedAt: instants.dateTime(item.publishedAt) } : {}), ...(item.measuredAt ? { measuredAt: instants.dateTime(item.measuredAt) } : {}) },
  }));
}

/** Measure choices in the viewer's language, falling back to the English label. */
export function postsTableMeasures(measures: ReadonlyArray<{ key: string; label: string; labelFr?: string }>, locale: 'en' | 'fr'): PostsTableMeasure[] {
  return measures.map(measure => ({ key: measure.key, label: locale === 'fr' ? measure.labelFr ?? measure.label : measure.label }));
}
