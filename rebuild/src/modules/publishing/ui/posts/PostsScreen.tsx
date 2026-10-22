import { loadComposerCopy } from '../../server/composer-copy';
import { ComposerCopyProvider } from '../compose/CopyProvider';
import { kitCopy as defaultCopy } from '../kit/copy';
import { loadPublishingCopy, loadPublishingNoticeCopy } from '../../server/customer-copy';
import { loadContent } from '../../server/content-copy';
import { ContentProvider } from '../ContentProvider';
import { PublishingCopyProvider } from '../kit/CopyProvider';
import { loadPublishingActionCopy } from '../../server/action-copy';
import { PublishingActionCopyProvider } from '../WorkflowSubmitButtons';
import { InfoTip, PageHeader, statusLabel } from "@/components";
import { IconPlus } from "@tabler/icons-react";
import { redirect } from 'next/navigation';
import { requireViewer } from "@/server/context";
import { readPublishingPostPage } from "@/modules/publishing/server/read";
import { publishingDestinationChoices } from '@/modules/publishing/server/destinations';
import { formatDate } from "@/modules/publishing/ui/publishing-ui";
import { EmptyPanel, type FilterChip } from "../kit/kit";
import { pageLocale } from "../kit/locale";
import { formatPostPreviewTime } from "@/components/PostPreview";
import { PostsTable, type PostsTableRow } from "./PostsTable";
import { PostsHeaderTools } from "./PostsHeaderTools";
import { ImportCsv } from "./ImportCsv";
import { postsNotice } from "./notices";
import styles from "@/modules/publishing/ui/publishing.module.css";
import { loadPostOrigins, originFilterOptions, parseOriginFilter } from "../origins/load";
import { originCopy } from "../origins/copy";
import { runtimeConfig } from '@/server/config/store';
import { RouteNotice } from '@/components/RouteNotice';
import { PostStatus } from '../../../../../generated/client';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadWorkspaceOperations } from '@/modules/settings/server/workspace-operations';
import { OperationError, isOperationErrorCode } from '@/lib/operation-error';
import { pageChannelScope } from '@/modules/shell/server/scope';

type Params = { notice?: string; recovery?: string; page?: string; status?: string; channel?: string; q?: string; origin?: string; post?: string };

const STATUS_FILTERS = ['draft', 'pending_approval', 'rejected', 'scheduled', 'publishing', 'published', 'partially_failed', 'failed', 'cancelled'] as const;
const POST_ID = /^[A-Za-z0-9_-]{1,200}$/;

export default async function PostsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true });
  const params = await searchParams;
  const { notice, recovery, page: pageParam, status, q, origin: originParam, post: postParam } = params;
  const originKind = parseOriginFilter(originParam);
  const locale = await pageLocale();
  const { catalog, copy: localizedCopy } = await loadPublishingCopy();
  const noticeCatalog = await loadPublishingNoticeCopy();
  const actionCatalog = await loadPublishingActionCopy();
  const composerCatalog = await loadComposerCopy();
  const content = await loadContent();
  const copy = localizedCopy[locale];
  const [allowedMimeTypes, maxUploadBytes, maxAltCharacters, maxMedia, maxFirstCommentDelayMinutes, searchMaxCharacters, exportMaxPosts, exportMaxBytes] = await Promise.all([
    runtimeConfig('publishing.allowedImageMimeTypes'), runtimeConfig('publishing.maxImageUploadBytes'), runtimeConfig('publishing.maxImageAltCharacters'), runtimeConfig('publishing.maxRemoteMediaPerPost'), runtimeConfig('publishing.maxFirstCommentDelayMinutes'),
    runtimeConfig('publishing.searchMaxCharacters'), runtimeConfig('publishing.exportMaxPosts'), runtimeConfig('publishing.exportMaxBytes'),
  ]);
  const imageRules = { allowedMimeTypes: allowedMimeTypes as string[], maxUploadBytes: Number(maxUploadBytes), maxAltCharacters: Number(maxAltCharacters), maxMedia: Number(maxMedia), maxFirstCommentDelayMinutes: Number(maxFirstCommentDelayMinutes) };
  const requestedPage = pageParam && /^[1-9]\d*$/.test(pageParam) && Number.isSafeInteger(Number(pageParam)) ? Number(pageParam) : 1;
  const selectedStatus = Object.values(PostStatus).find(value => value === status);
  // The sidebar's channel scope decides which channels the list covers (several channels filter as "any of"). A saved channel-group address still works.
  const scope = await pageChannelScope(viewer, params).catch(() => null);
  const selectedChannel = params.channel?.startsWith('channel-group:') ? params.channel : scope?.ids.length ? scope.ids.join(',') : undefined;
  let listing: Awaited<ReturnType<typeof readPublishingPostPage>> | null = null;
  let listingError: string | null = null;
  try {
    listing = await readPublishingPostPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { page: requestedPage, status, channelId: selectedChannel, q, origin: originKind });
  } catch (error) {
    if (!(error instanceof OperationError) || !isOperationErrorCode(error.code)) throw error;
    listingError = safeOperationError(error, copy);
  }
  const pageInfo = <InfoTip name={copy.postsTitle}>{content.copy.postsInfo}</InfoTip>;
  if (!listing) return <ContentProvider {...content}>
    <PageHeader module="publishing" title={copy.postsTitle} info={pageInfo} />
    <RouteNotice className={styles.errorNotice} error focusKey={`posts-read-error:${q ?? ''}:${status ?? ''}:${selectedChannel ?? ''}`}>{`${listingError ?? safeOperationError(null, copy)} ${copy.resetAndRetry}`}</RouteNotice>
  </ContentProvider>;
  // A shared `?post=` link to a post that is not on this page opens the post's own page instead.
  if (postParam && POST_ID.test(postParam) && !listing.posts.some(post => post.id === postParam)) redirect(`/content/post/${encodeURIComponent(postParam)}`);
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
  const originOptions = await originFilterOptions(viewer.workspaceId, locale).catch(() => []);
  const rows: PostsTableRow[] = listing.posts.map(post => ({ ...post, origin: origins.get(post.id) ?? null, media: post.media as Array<{ kind: string; url: string; altText?: string }>, authorName: post.authorId === viewer.user.id ? viewer.user.name : copy.approvalsMember, ...authority(post), whenLabel: formatDate(post.scheduledAt ?? post.publishedAt, timeZone, true, locale, copy), firstCommentDueLabels: firstCommentDueLabels(post, timeZone) }));
  const noticeText = notice ? postsNotice(notice, locale, noticeCatalog) ?? undefined : undefined;
  // Every address keeps the sidebar's channel parameter and the other filters; only the omitted one is dropped.
  const hrefWith = (page: number | null, omit?: 'status' | 'q' | 'origin') => {
    const next = new URLSearchParams();
    if (page) next.set('page', String(page));
    if (status && omit !== 'status') next.set('status', status);
    if (params.channel) next.set('channel', params.channel);
    if (q && omit !== 'q') next.set('q', q);
    if (originKind && omit !== 'origin') next.set('origin', originKind);
    const query = next.toString();
    return `/content${query ? `?${query}` : ''}`;
  };
  const resetHref = params.channel ? `/content?channel=${encodeURIComponent(params.channel)}` : '/content';
  const manageProps = { targets: targetChoices, canPublish, canOrganize, canQueue, imageRules, timeZone, undoSendSeconds };
  const canBulk = canWritePosts && canAuthorDrafts;
  const chips: FilterChip[] = [
    ...(selectedStatus ? [{ key: 'status', label: copy.status, value: statusLabel(selectedStatus), removeHref: hrefWith(null, 'status') }] : []),
    ...(q?.trim() ? [{ key: 'q', label: copy.search, value: q.trim(), removeHref: hrefWith(null, 'q') }] : []),
    ...(originKind ? [{ key: 'origin', label: originCopy[locale].createdBy, value: originOptions.find(option => option.kind === originKind)?.label ?? originKind, removeHref: hrefWith(null, 'origin') }] : []),
  ];
  const newPostLink = canWritePosts ? <a className="ui-button ui-button--primary" href="/create"><IconPlus size={16} aria-hidden="true" /> {copy.newPost}</a> : undefined;
  const emptyState = chips.length
    ? <EmptyPanel title={copy.postsNoMatchTitle} action={<a className="ui-button ui-button--secondary" href={resetHref}>{content.copy.contentFilterClear}</a>}>{copy.postsNoMatchBody}</EmptyPanel>
    : <EmptyPanel title={copy.postsEmptyTitle} action={newPostLink}>{copy.postsEmptyBody}</EmptyPanel>;
  const statuses = STATUS_FILTERS.map(value => ({ value, label: copy[`status_${value}`] }));
  const headerActions = <>{canManageDrafts ? <ImportCsv targets={targetChoices} locale={locale} /> : null}{newPostLink}</>;
  return <ContentProvider {...content}><PublishingCopyProvider catalog={catalog} locale={locale}><PublishingActionCopyProvider catalog={actionCatalog} locale={locale}><ComposerCopyProvider catalog={composerCatalog} locale={locale}>
    <PageHeader module="publishing" title={copy.postsTitle} count={listing.total.toLocaleString(locale)} info={pageInfo} actions={headerActions}
      filters={<PostsHeaderTools statuses={statuses} origins={originOptions} chips={chips} resetHref={resetHref} searchMaxCharacters={Number(searchMaxCharacters)} exportMaxPosts={Number(exportMaxPosts)} exportMaxBytes={Number(exportMaxBytes)} locale={locale} canExport={canAuthorDrafts} />} />
    {listing.channelUnavailable ? <p className={styles.errorNotice} role="status">{content.copy.contentChannelUnavailable}</p> : null}
    {noticeText ? <RouteNotice className={notice?.startsWith('failed') ? styles.errorNotice : styles.successNotice} error={notice?.startsWith('failed')} focusKey={`${notice}:${recovery ?? ''}`}>{noticeText}</RouteNotice> : null}
    <section data-module="publishing" aria-label={content.copy.postsRows}>
      <PostsTable rows={rows} caption={copy.postsCaption(listing.page, listing.pages)} locale={locale} timeZone={timeZone} selectable={canBulk} canRetry={canPublish} manage={canAuthorDrafts ? manageProps : null} empty={emptyState} initialPostId={postParam && POST_ID.test(postParam) ? postParam : undefined} />
      {listing.pages > 1 ? <nav className={styles.postPagination} aria-label={copy.pagesLabel}>
        {listing.page > 1 ? <a className="ui-button ui-button--secondary" href={hrefWith(listing.page - 1)}>{copy.previousPage}</a> : <span />}
        <span>{copy.pageOf(listing.page, listing.pages)}</span>
        {listing.page < listing.pages ? <a className="ui-button ui-button--secondary" href={hrefWith(listing.page + 1)}>{copy.nextPage}</a> : <span />}
      </nav> : null}
    </section>
  </ComposerCopyProvider></PublishingActionCopyProvider></PublishingCopyProvider></ContentProvider>;
}

function safeOperationError(error: unknown, copy: typeof defaultCopy.en) {
  const code = error instanceof OperationError && isOperationErrorCode(error.code) ? error.code : null;
  if (code === 'invalid_request' && error instanceof OperationError) return error.message;
  if (code === 'unauthorized' || code === 'forbidden') return copy.permissionError;
  if (code === 'not_found') return copy.missingError;
  if (code === 'unavailable' || code === 'conflict') return copy.unavailableError;
  return copy.loadError;
}

/** First-comment due times per destination, formatted here so the browser never applies its own time-zone data. */
function firstCommentDueLabels(post: { firstCommentDelayMinutes?: number | null; targets: Array<{ id: string; publishedAt?: Date | string | null }> }, timeZone: string) {
  const delay = post.firstCommentDelayMinutes ?? 0;
  const labels: Record<string, string> = {};
  for (const target of post.targets) {
    const published = target.publishedAt ? new Date(target.publishedAt) : null;
    if (published && Number.isFinite(published.getTime())) labels[target.id] = formatPostPreviewTime(new Date(published.getTime() + delay * 60_000), timeZone);
  }
  return labels;
}
