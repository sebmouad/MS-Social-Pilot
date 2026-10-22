import type { PostPerformance } from '@/server/platforms/host';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { TOP_POST_CONTENT_POLICY_SCHEMA } from '../config';

export type TopPostContent = { previewImages: boolean; text: string; media: Array<{ kind: 'image' | 'video'; url: string }>; link: string | null; articleTitle: string; articleDescription: string; shortened: boolean };
export type ReportTopPost = PostPerformance & { content?: TopPostContent };
/** Report URLs are passive public HTTP(S) references, never executable schemes or credentials. */
export function reportUrl(value: unknown, max = Infinity): string | null {
  if (typeof value !== 'string' || value.length > max) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= max ? url.href : null; } catch { return null; }
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Enrich only the ranked, authorized channel's published destinations. No other
 * destination overrides, storage keys, author identities or provider errors leave this read.
 * Saved content may have changed after publication: it is not a remote snapshot.
 */
export async function readTopPostContent(workspaceId: string, channelId: string, period: { start: string; end: string }, ranked: PostPerformance[]): Promise<ReportTopPost[]> {
  const policy = TOP_POST_CONTENT_POLICY_SCHEMA.parse(await runtimeConfig('analytics.reports.topPostContent'));
  if (!ranked.length) return [];
  const publicOrigin = reportUrl(await runtimeConfig('app.publicOrigin'));
  const ids = ranked.slice(0, policy.posts).map(p => p.postId);
  const from = new Date(`${period.start}T00:00:00.000Z`);
  const to = new Date(`${period.end}T00:00:00.000Z`); to.setUTCDate(to.getUTCDate() + 1);
  const rows = await prisma.$queryRaw<Array<{ postId: string; text: string; media: unknown; link: string | null; articleTitle: string | null; articleDescription: string | null }>>`
    SELECT pt."postId", left(COALESCE(pt."messageOverride", p.message), ${policy.textCharacters + 1}::int) AS text,
      CASE WHEN pt."skipMedia" THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object('kind', item->>'kind', 'url', left(item->>'url', ${policy.urlCharacters + 1}::int)) ORDER BY ordinal)
        FROM (SELECT item, ordinal FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.media) = 'array' THEN p.media ELSE '[]'::jsonb END)
          WITH ORDINALITY AS media(item, ordinal) ORDER BY ordinal LIMIT ${policy.mediaPerPost + 1}) bounded
      ), '[]'::jsonb) END AS media,
      left(p.link, ${policy.urlCharacters + 1}::int) AS link,
      left(p."linkPreview"->>'title', ${policy.previewCharacters + 1}::int) AS "articleTitle",
      left(p."linkPreview"->>'description', ${policy.previewCharacters + 1}::int) AS "articleDescription"
    FROM post_targets pt JOIN posts p ON p.id = pt."postId"
    JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = p."workspaceId"
    WHERE p."workspaceId" = ${workspaceId} AND pt."targetId" = ${channelId}
      AND pt."postId" = ANY(${ids}::text[]) AND pt.status = 'published'
      AND pt."publishedAt" >= ${from} AND pt."publishedAt" < ${to}
    LIMIT ${policy.posts}`;
  const byId = new Map(rows.map(row => [row.postId, row]));
  return ranked.slice(0, policy.posts).flatMap(post => {
    const row = byId.get(post.postId);
    if (!row) return []; // A removed/unpublished destination cannot leak stale adapter content.
    let shortened = false;
    const clip = (value: unknown, max: number) => {
      const text = typeof value === 'string' ? value : '';
      const characters = [...text];
      if (characters.length <= max) return text;
      shortened = true; return characters.slice(0, max - 1).join('') + '…';
    };
    const rawMedia = Array.isArray(row.media) ? row.media : [];
    if (rawMedia.length > policy.mediaPerPost) shortened = true;
    const media = rawMedia.slice(0, policy.mediaPerPost).flatMap(item => {
      const m = object(item);
      const localId = typeof m.url === 'string' && /^media:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(m.url) ? m.url.slice('media:'.length) : null;
      const url = localId && publicOrigin ? reportUrl(new URL(policy.mediaUrlTemplate.replace('{id}', localId), new URL(publicOrigin).origin).href, policy.urlCharacters) : reportUrl(m.url, policy.urlCharacters);
      if (!url) shortened = true;
      return url && (m.kind === 'image' || m.kind === 'video') ? [{ kind: m.kind, url } as { kind: 'image' | 'video'; url: string }] : [];
    });
    if (row.link && !reportUrl(row.link, policy.urlCharacters)) shortened = true;
    const content: TopPostContent = { previewImages: policy.imagePreviews, text: clip(row.text, policy.textCharacters), media,
      link: reportUrl(row.link, policy.urlCharacters), articleTitle: clip(row.articleTitle, policy.previewCharacters), articleDescription: clip(row.articleDescription, policy.previewCharacters), shortened: false };
    content.shortened = shortened;
    return [{ ...post, text: content.text, url: reportUrl(post.url, policy.urlCharacters), content }];
  });
}
