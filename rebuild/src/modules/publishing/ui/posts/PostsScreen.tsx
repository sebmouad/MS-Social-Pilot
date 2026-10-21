import { loadComposerCopy } from '../../server/composer-copy';
import { ComposerCopyProvider } from '../compose/CopyProvider';
import { kitCopy as defaultCopy } from '../kit/copy';
import { loadPublishingCopy, loadPublishingNoticeCopy } from '../../server/customer-copy';
import { PublishingCopyProvider } from '../kit/CopyProvider';
import { loadPublishingActionCopy } from '../../server/action-copy';
import { PublishingActionCopyProvider } from '../WorkflowSubmitButtons';
import { statusLabel } from "@/components";
import { IconPlus } from "@tabler/icons-react";
import { PostPreview, type PostPreviewPost } from "@/components/PostPreview";
import { requireViewer } from "@/server/context";
import { readPublishingPostPage } from "@/modules/publishing/server/read";
import { publishingDestinationChoices } from '@/modules/publishing/server/destinations';
import { PageHeading, formatDate } from "@/modules/publishing/ui/publishing-ui";
import { EmptyPanel, FilterChips, type FilterChip } from "../kit/kit";
import { pageLocale } from "../kit/locale";
import { PostsTable, type PostsTableRow } from "./PostsTable";
import { PostsViewSwitch } from "./PostsViewSwitch";
import { ImportCsv } from "./ImportCsv";
import { postsNotice } from "./notices";
import tableStyles from "./posts-table.module.css";
import styles from "@/modules/publishing/ui/publishing.module.css";
import previewStyles from '@/components/PostPreview.module.css';
import { PostRowActions } from "./PostActions";
import { loadPostOrigins, originFilterOptions, parseOriginFilter } from "../origins/load";
import { originCopy } from "../origins/copy";
import { OriginBadge } from "../origins/OriginBadge";
import originStyles from "../origins/origin.module.css";
import { runtimeConfig } from '@/server/config/store';
import { RouteNotice } from '@/components/RouteNotice';
import { PostStatus } from '../../../../../generated/client';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadWorkspaceOperations } from '@/modules/settings/server/workspace-operations';
import { OperationError, isOperationErrorCode } from '@/lib/operation-error';

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ notice?: string; recovery?: string; page?: string; status?: string; channel?: string; q?: string; view?: string; origin?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true });
  const { notice, recovery, page: pageParam, status, channel, q, view: viewParam, origin: originParam } = await searchParams;
  const originKind = parseOriginFilter(originParam);
  const locale = await pageLocale();
  const { catalog, copy: localizedCopy } = await loadPublishingCopy();
  const noticeCatalog = await loadPublishingNoticeCopy();
  const actionCatalog = await loadPublishingActionCopy();
  const composerCatalog = await loadComposerCopy();
  const copy = localizedCopy[locale];
  const view = viewParam === 'feed' || viewParam === 'cards' ? viewParam : 'table';
  const [allowedMimeTypes, maxUploadBytes, maxAltCharacters, maxMedia, maxFirstCommentDelayMinutes] = await Promise.all([
    runtimeConfig('publishing.allowedImageMimeTypes'), runtimeConfig('publishing.maxImageUploadBytes'), runtimeConfig('publishing.maxImageAltCharacters'), runtimeConfig('publishing.maxRemoteMediaPerPost'), runtimeConfig('publishing.maxFirstCommentDelayMinutes'),
  ]);
  const imageRules = { allowedMimeTypes: allowedMimeTypes as string[], maxUploadBytes: Number(maxUploadBytes), maxAltCharacters: Number(maxAltCharacters), maxMedia: Number(maxMedia), maxFirstCommentDelayMinutes: Number(maxFirstCommentDelayMinutes) };
  const requestedPage = pageParam && /^[1-9]\d*$/.test(pageParam) && Number.isSafeInteger(Number(pageParam)) ? Number(pageParam) : 1;
  const selectedStatus = Object.values(PostStatus).find(value => value === status);
  const selectedChannel = channel || undefined;
  let listing: Awaited<ReturnType<typeof readPublishingPostPage>> | null = null;
  let listingError: string | null = null;
  try {
    listing = await readPublishingPostPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { page: requestedPage, status, channelId: selectedChannel, q, origin: originKind });
  } catch (error) {
    if (!(error instanceof OperationError) || !isOperationErrorCode(error.code)) throw error;
    listingError = safeOperationError(error, copy);
  }
  if (!listing) return <>
    <PageHeading title={copy.postsTitle} description={copy.postsDescription} />
    <RouteNotice className={styles.errorNotice} error focusKey={`posts-read-error:${q ?? ''}:${status ?? ''}:${channel ?? ''}`}>{`${listingError ?? safeOperationError(null, copy)} ${copy.resetAndRetry}`}</RouteNotice>
  </>;
  const targetChoices = await publishingDestinationChoices(viewer);
  const undoSendSeconds = await loadWorkspaceOperations(viewer.workspaceId).then(value => value.undoSendSeconds, () => 0);
  const timeZone = viewer.membership.workspace.timezone;
  const canManageDrafts = ["owner", "admin", "editor"].includes(viewer.membership.role);
  const canAuthorDrafts = canManageDrafts || viewer.membership.role === "contributor";
  const canWritePosts = canAccessFeature(viewer.permissions, 'publishing/posts', 'write');
  const canPublish = targetChoices.some(target => target.canPublish);
  const canOrganize = canUseFeature(viewer.entitlements, 'publishing/collaboration') && canAccessFeature(viewer.permissions, 'publishing/collaboration', 'read');
  const canQueue = canWritePosts && canUseFeature(viewer.entitlements, 'publishing/queue') && canAccessFeature(viewer.permissions, 'publishing/queue', 'write');
  const authority = (post: { authorId: string; status: string; targets: Array<{ status: string }> }) => {
    const canEdit = canManageDrafts || post.authorId === viewer.user.id;
    const canDuplicate = canWritePosts
      && (canManageDrafts || (viewer.membership.role === 'contributor' && post.authorId === viewer.user.id))
      && canEdit
      && !['processing', 'publishing', 'scheduled_remote'].includes(post.status)
      && !post.targets.some(target => target.status === 'processing' || target.status === 'scheduled_remote');
    return { canEdit, canDuplicate };
  };
  const origins = await loadPostOrigins(viewer.workspaceId, listing.posts.map(post => post.id), locale);
  const originOptions = originKind ? await originFilterOptions(viewer.workspaceId, locale) : [];
  const rows: PostsTableRow[] = listing.posts.map(post => ({ ...post, origin: origins.get(post.id) ?? null, media: post.media as Array<{ kind: string; url: string; altText?: string }>, ...authority(post), whenLabel: formatDate(post.scheduledAt ?? post.publishedAt, timeZone, true, locale, copy) }));
  const noticeText = notice ? postsNotice(notice, locale, noticeCatalog) ?? undefined : undefined;
  const pageLink = (page: number) => {
    const params = new URLSearchParams({ page: String(page) });
    if (status) params.set('status', status);
    if (channel) params.set('channel', channel);
    if (q) params.set('q', q);
    if (originKind) params.set('origin', originKind);
    if (viewParam === 'table' || viewParam === 'feed' || viewParam === 'cards') params.set('view', viewParam);
    return `/publishing/posts?${params}`;
  };
  const manageProps = { targets: targetChoices, canPublish, canOrganize, canQueue, imageRules, timeZone, undoSendSeconds };
  const previewFor = (post: (typeof rows)[number], variant: 'feed' | 'card') => <PostPreview
    post={post as PostPreviewPost}
    authorName={post.authorId === viewer.user.id ? viewer.user.name : copy.approvalsMember}
    timeZone={timeZone}
    variant={variant}
    locale={locale}
    actions={canAuthorDrafts ? <details className={previewStyles.managePost}>
      <summary>{copy.manage}</summary>
      {post.canEdit ? <PostRowActions post={post} canEdit canDuplicate={post.canDuplicate} {...manageProps} /> : <span className={styles.noActions}>{copy.actionsLimited}</span>}
    </details> : undefined}
  />;
  const canBulk = canWritePosts && canAuthorDrafts;
  const filterHref = (omit: 'status' | 'channel' | 'q' | 'origin') => {
    const params = new URLSearchParams();
    if (status && omit !== 'status') params.set('status', status);
    if (channel && omit !== 'channel') params.set('channel', channel);
    if (q && omit !== 'q') params.set('q', q);
    if (originKind && omit !== 'origin') params.set('origin', originKind);
    if (viewParam === 'table' || viewParam === 'feed' || viewParam === 'cards') params.set('view', viewParam);
    const query = params.toString();
    return `/publishing/posts${query ? `?${query}` : ''}`;
  };
  const chips: FilterChip[] = [
    ...(selectedStatus ? [{ key: 'status', label: copy.status, value: statusLabel(selectedStatus), removeHref: filterHref('status') }] : []),
    ...(selectedChannel ? [{ key: 'channel', label: copy.channel, value: targetChoices.find(target => target.id === selectedChannel)?.name ?? selectedChannel, removeHref: filterHref('channel') }] : []),
    ...(q?.trim() ? [{ key: 'q', label: copy.search, value: q.trim(), removeHref: filterHref('q') }] : []),
    ...(originKind ? [{ key: 'origin', label: originCopy[locale].createdBy, value: originOptions.find(option => option.kind === originKind)?.label ?? originKind, removeHref: filterHref('origin') }] : []),
  ];
  const viewHref = (next: 'table' | 'feed' | 'cards') => { const params = new URLSearchParams({ view: next }); if (status) params.set('status', status); if (channel) params.set('channel', channel); if (q) params.set('q', q); if (originKind) params.set('origin', originKind); return `/publishing/posts?${params}`; };
  const newPostLink = canWritePosts ? <a className="ui-button ui-button--primary" href="/publishing/compose"><IconPlus size={16} aria-hidden="true" /> {copy.newPost}</a> : undefined;
  const emptyState = chips.length
    ? <EmptyPanel title={copy.postsNoMatchTitle} action={<a className="ui-button ui-button--secondary" href="/publishing/posts">{copy.resetFilters}</a>}>{copy.postsNoMatchBody}</EmptyPanel>
    : <EmptyPanel title={copy.postsEmptyTitle} action={newPostLink}>{copy.postsEmptyBody}</EmptyPanel>;
  const headerActions = <>{canManageDrafts ? <ImportCsv targets={targetChoices} locale={locale} /> : null}{newPostLink}</>;
  return <PublishingCopyProvider catalog={catalog} locale={locale}><PublishingActionCopyProvider catalog={actionCatalog} locale={locale}><ComposerCopyProvider catalog={composerCatalog} locale={locale}>
    <PageHeading href="/publishing/posts" actions={headerActions} title={copy.postsTitle} description={copy.postsDescription} summary={copy.postsSummary(listing.total, listing.page, listing.pages)}/>
    {listing.channelUnavailable ? <p className={styles.errorNotice} role="status">{copy.unavailableChannel}</p> : null}
    {noticeText ? <RouteNotice className={notice?.startsWith('failed') ? styles.errorNotice : styles.successNotice} error={notice?.startsWith('failed')} focusKey={`${notice}:${recovery ?? ''}`}>{noticeText}</RouteNotice> : null}
    <section className={styles.card} data-module="publishing" aria-label={`${view === 'table' ? copy.viewTable : view === 'feed' ? copy.viewFeed : copy.viewCards}`}>
      <div className={tableStyles.toolbarRow}>
        <FilterChips chips={chips} resetHref="/publishing/posts" locale={locale} />
        <PostsViewSwitch value={view} hrefs={{ table: viewHref('table'), feed: viewHref('feed'), cards: viewHref('cards') }} locale={locale} />
      </div>
      {view === 'table'
        ? <PostsTable rows={rows} caption={copy.postsCaption(listing.page, listing.pages)} locale={locale} selectable={canBulk} canRetry={canPublish} manage={canAuthorDrafts ? manageProps : null} empty={emptyState} />
        : rows.length ? <ul className={view === 'feed' ? previewStyles.feedList : previewStyles.cardsGrid}>
          {rows.map(post => <li key={post.id}>{post.origin ? <div className={originStyles.above}><OriginBadge origin={post.origin} /></div> : null}{previewFor(post, view === 'feed' ? 'feed' : 'card')}</li>)}
        </ul> : emptyState}
      {listing.pages > 1 ? <nav className={styles.postPagination} aria-label={copy.pagesLabel}>
        {listing.page > 1 ? <a className="ui-button ui-button--secondary" href={pageLink(listing.page - 1)}>{copy.previousPage}</a> : <span />}
        <span>{copy.pageOf(listing.page, listing.pages)}</span>
        {listing.page < listing.pages ? <a className="ui-button ui-button--secondary" href={pageLink(listing.page + 1)}>{copy.nextPage}</a> : <span />}
      </nav> : null}
    </section>
  </ComposerCopyProvider></PublishingActionCopyProvider></PublishingCopyProvider>;
}

function safeOperationError(error: unknown, copy: typeof defaultCopy.en) {
  const code = error instanceof OperationError && isOperationErrorCode(error.code) ? error.code : null;
  if (code === 'invalid_request' && error instanceof OperationError) return error.message;
  if (code === 'unauthorized' || code === 'forbidden') return copy.permissionError;
  if (code === 'not_found') return copy.missingError;
  if (code === 'unavailable' || code === 'conflict') return copy.unavailableError;
  return copy.loadError;
}
