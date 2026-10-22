import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { readLibrary } from '@/modules/media/server/library';
import { PageHeading } from '../publishing/publishing-ui';
import { MediaLibrary } from './MediaLibrary';
import styles from './media.module.css';

const ALLOWED = ['kind', 'q', 'page', 'usage'];
export default async function MediaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer({ feature: 'publishing/media', channelScoped: true });
  const params = await searchParams;
  const heading = <PageHeading title="Media library" description="Images and videos available to your posts." />;
  const kind = params.kind; const usage = params.usage; const page = params.page; const q = params.q;
  if (Object.entries(params).some(([key, value]) => !ALLOWED.includes(key) || typeof value !== 'string') || (kind !== undefined && kind !== 'image' && kind !== 'video') || (usage !== undefined && usage !== 'used' && usage !== 'unused') || (typeof page === 'string' && !/^[1-9]\d{0,3}$/.test(page))) {
    return <>{heading}<RouteNotice error focusKey="media-load-error">Choose valid library filters and try again.</RouteNotice></>;
  }
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const canWrite = canAccessFeature(viewer.permissions, 'publishing/media', 'write');
  try {
    const result = await readLibrary(actor, { ...(kind ? { kind } : {}), ...(usage ? { usage } : {}), ...(typeof q === 'string' && q ? { q } : {}), ...(typeof page === 'string' ? { page: Number(page) } : {}) });
    return <>
      {heading}
      <MediaLibrary items={result.items.map(i => ({ ...i, createdAt: i.createdAt.toISOString(), holders: i.holders?.map(h => ({ ...h, scheduledAt: h.scheduledAt?.toISOString() ?? null })) ?? null }))}
        usage={result.usage} page={result.page} hasMore={result.hasMore} filters={{ kind: (kind as string | undefined) ?? '', usage: (usage as string | undefined) ?? '', q: typeof q === 'string' ? q : '' }}
        canWrite={canWrite} workspaceWide={result.workspaceWide} usageMayBeIncomplete={result.usageMayBeIncomplete} maxSearch={result.limits.maxSearchCharacters} />
      <p className={styles.privacy}>Deleting media does not remove posts, but a post that used it may lose its attachment.</p>
    </>;
  } catch (error) {
    return <>{heading}<RouteNotice error focusKey="media-load-error">{error instanceof OperationError ? error.message : 'The media library could not be loaded. Refresh and try again.'}</RouteNotice></>;
  }
}
