import { headers } from 'next/headers';
import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { requireViewer } from '@/server/context';
import { runtimeConfig } from '@/server/config/store';
import { canAccessFeature } from '@/server/permissions';
import { LibraryHeader } from '@/modules/publishing/ui/library/LibraryHeader';
import { readLibrary } from '../server/library';
import { MEDIA_FEATURE_ID } from '../manifest';
import { mediaLocale, mediaText } from '../copy';
import { MediaLibrary } from './MediaLibrary';
import styles from './media.module.css';

const ALLOWED = ['kind', 'q', 'page', 'usage'];

export default async function MediaScreen({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const LOCALE = mediaLocale((await headers()).get('accept-language'));
  const copy = await runtimeConfig('media.copy');
  const t = (key: Parameters<typeof mediaText>[1]) => mediaText(LOCALE, key, {}, copy);
  const viewer = await requireViewer({ feature: MEDIA_FEATURE_ID, channelScoped: true });
  const params = await searchParams;
  const heading = <LibraryHeader active="media" viewer={viewer} />;
  const kind = params.kind; const usage = params.usage; const page = params.page; const q = params.q;
  if (Object.entries(params).some(([key, value]) => !ALLOWED.includes(key) || typeof value !== 'string') || (kind !== undefined && kind !== 'image' && kind !== 'video') || (usage !== undefined && usage !== 'used' && usage !== 'unused') || (typeof page === 'string' && !/^[1-9]\d{0,3}$/.test(page))) {
    return <>{heading}<RouteNotice error focusKey="media-load-error">{t('invalidFilters')}</RouteNotice></>;
  }
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const canWrite = canAccessFeature(viewer.permissions, MEDIA_FEATURE_ID, 'write');
  try {
    const result = await readLibrary(actor, { ...(kind ? { kind } : {}), ...(usage ? { usage } : {}), ...(typeof q === 'string' && q ? { q } : {}), ...(typeof page === 'string' ? { page: Number(page) } : {}) });
    return <>
      {heading}
      <MediaLibrary items={result.items.map(i => ({ ...i, createdAt: i.createdAt.toISOString(), holders: i.holders?.map(h => ({ ...h, scheduledAt: h.scheduledAt?.toISOString() ?? null })) ?? null }))}
        usage={result.usage} page={result.page} hasMore={result.hasMore} filters={{ kind: (kind as string | undefined) ?? '', usage: (usage as string | undefined) ?? '', q: typeof q === 'string' ? q : '' }}
        canWrite={canWrite} workspaceWide={result.workspaceWide} usageMayBeIncomplete={result.usageMayBeIncomplete} maxSearch={result.limits.maxSearchCharacters} maxName={result.limits.maxNameCharacters} locale={LOCALE} copy={copy} />
      <p className={styles.help}>{t('privacy')}</p>
    </>;
  } catch (error) {
    return <>{heading}<RouteNotice error focusKey="media-load-error">{error instanceof OperationError ? error.message : t('loadFailed')}</RouteNotice></>;
  }
}
