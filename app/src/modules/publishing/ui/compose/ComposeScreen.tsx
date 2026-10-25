import { PublishingCopyProvider } from '@/modules/publishing/ui/kit/CopyProvider';
import { workspaceScheduleMode } from '@/modules/publishing/server/schedule-modes';
import { loadPublishingCopy } from '@/modules/publishing/server/customer-copy';
import { PublishingActionCopyProvider } from '@/modules/publishing/ui/WorkflowSubmitButtons';
import { loadPublishingActionCopy } from '@/modules/publishing/server/action-copy';
import { loadComposerCopy } from '../../server/composer-copy';
import { loadContent } from '../../server/content-copy';
import { ContentProvider } from '../ContentProvider';
import { readChannelProfiles } from '@/modules/settings/channel-profiles/service';
import { requireViewer } from '@/server/context';
import { runtimeConfig } from '@/server/config/store';
import { canAccessFeature } from '@/server/permissions';
import { canUseFeature } from '@/server/entitlements';
import { readTemplatePage } from '@/modules/publishing/server/templates';
import { readLabelPage } from '@/modules/publishing/server/labels';
import { publishingDestinationChoices } from '@/modules/publishing/server/destinations';
import { pageChannelScope } from '@/modules/shell/server/scope';
import { isDateKey } from '@/lib/calendar-dates';
import { formatPostPreviewTime } from '@/lib/post-preview-time';
import { PostComposer } from './PostComposer';
import { readPublishingPostPage } from '@/modules/publishing/server/read';
import { postThumbnail } from '@/components/post-thumbnail';
import { aiStatus } from '@/modules/studio/server/ai';
import { loadWorkspaceOperations } from '@/modules/settings/server/workspace-operations';

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

/**
 * Create (design v2 S7): the composer opens full screen. Services and server actions are the ones the old composer used;
 * the channels of the sidebar scope are pre-selected as destinations and can be changed here.
 */
async function ComposePageContent({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true });
  const params = await searchParams;
  const copyCatalog = await loadComposerCopy();
  const { copy: content, policy, locale } = await loadContent();
  const canCreate = canAccessFeature(viewer.permissions, 'publishing/posts', 'write');
  const [allowedMimeTypes, maxUploadBytes, maxAltCharacters, maxMessageCharacters, maxMedia, maxFirstCommentDelayMinutes, choices, autosaveSeconds] = await Promise.all([
    runtimeConfig('publishing.allowedImageMimeTypes'), runtimeConfig('publishing.maxImageUploadBytes'),
    runtimeConfig('publishing.maxImageAltCharacters'), runtimeConfig('publishing.maxMessageCharacters'), runtimeConfig('publishing.maxRemoteMediaPerPost'),
    runtimeConfig('publishing.maxFirstCommentDelayMinutes'), publishingDestinationChoices(viewer), runtimeConfig('publishing.draftAutosaveSeconds'),
  ]);
  // Add to queue needs both the queue feature and post writing; the server re-checks both.
  const queueAvailable = canCreate && canUseFeature(viewer.entitlements, 'publishing/queue') && canAccessFeature(viewer.permissions, 'publishing/queue', 'write');
  const canUseTemplates = canUseFeature(viewer.entitlements, 'publishing/templates') && canAccessFeature(viewer.permissions, 'publishing/templates', 'read');
  const templates = canUseTemplates ? await readTemplatePage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {}).then(result => result.templates.map(({ id, name, category, body, hashtags, firstComment, firstCommentDelayMinutes, labelId }) => ({ id, name, category, body, hashtags, firstComment, firstCommentDelayMinutes, labelId }))) : [];
  // Label choices for More options; unavailable labels hide the selector rather than blocking composition.
  const canUseLabels = canUseFeature(viewer.entitlements, 'publishing/labels') && canAccessFeature(viewer.permissions, 'publishing/labels', 'read');
  const labels = canUseLabels ? await (async () => {
    const all: Array<{ id: string; name: string }> = [];
    for (let page = 1; page <= 100; page++) {
      const result = await readLabelPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { page });
      all.push(...result.labels.map(({ id, name }) => ({ id, name })));
      if (!result.hasMore) break;
    }
    return all;
  })().catch(() => []) : [];
  // Advisory only: an unavailable setting hides the warning rather than blocking composition.
  const spacingGapMinutes = canCreate ? await loadWorkspaceOperations(viewer.workspaceId).then(value => value.spamGapMinutes, () => 0) : 0;
  // Suggestion-only writing help; the status is empty (and the control hidden) when unavailable.
  const aiAssist = canCreate ? await aiStatus({ userId: viewer.user.id, workspaceId: viewer.workspaceId }).catch(() => undefined) : undefined;
  const profiles = await readChannelProfiles({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, 'publishing/posts').catch(() => null);
  const remoteScheduling = { offered: await runtimeConfig('publishing.remoteScheduling.offered') === true, defaultMode: (((await workspaceScheduleMode(viewer.workspaceId).catch(() => null)) ?? await runtimeConfig('publishing.remoteScheduling.defaultMode')) === 'remote' ? 'remote' : 'application') as 'application' | 'remote' };
  const createdAt = new Date();
  const date = first(params.date);
  const time = first(params.time);
  const schedule = {
    date: date && isDateKey(date) ? date : '',
    time: time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '',
    timeZone: viewer.membership.workspace.timezone,
  };
  // Destinations: the sidebar scope, limited to channels that can publish. With no scope, a lone postable channel is chosen for you.
  const postable = choices.filter(choice => choice.canPublish).map(choice => choice.id);
  const scope = await pageChannelScope(viewer, params).catch(() => null);
  const scoped = (scope?.ids ?? []).filter(id => postable.includes(id));
  const initialTargetIds = scoped.length ? scoped : postable.length === 1 ? postable : [];
  const authorFallback = copyCatalog.authorFallback[locale];
  // The grid preview shows real recent posts: the latest published page of posts, filtered to the selected channels in the browser.
  const recentPosts = await readPublishingPostPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { status: 'published' })
    .then(page => page.posts.map(post => ({ id: post.id, targetIds: post.targets.map(target => target.target.id), thumbnail: postThumbnail(post.media) })), () => []);
  const initialMessage = first(params.message);
  const initialLink = first(params.link);
  const initialMediaParam = first(params.media);
  const initialMediaUrls = initialMediaParam ? [initialMediaParam] : undefined;
  return <ContentProvider copy={content} policy={policy} locale={locale}>
    {canCreate
      ? <PostComposer recentPosts={recentPosts} copyCatalog={copyCatalog} autosaveSeconds={Number(autosaveSeconds)} remoteScheduling={remoteScheduling} profiles={profiles ?? undefined} queueAvailable={queueAvailable} aiStatus={aiAssist} aiLocale={locale} targets={choices} initialTargetIds={initialTargetIds} initialMessage={initialMessage} initialLink={initialLink} initialMediaUrls={initialMediaUrls} templates={templates} labels={labels} maxFirstCommentDelayMinutes={Number(maxFirstCommentDelayMinutes)} spacingGapMinutes={spacingGapMinutes} imageRules={{ allowedMimeTypes: allowedMimeTypes as string[], maxUploadBytes: Number(maxUploadBytes), maxAltCharacters: Number(maxAltCharacters), maxMessageCharacters: Number(maxMessageCharacters), maxMedia: Number(maxMedia) }} schedule={schedule} authorName={viewer.user.name || authorFallback} createdAt={createdAt} createdAtDisplay={formatPostPreviewTime(createdAt, schedule.timeZone)} />
      : <section><p>{copyCatalog.noPermission[locale]}</p><a href="/content">{content.postDetailBack}</a></section>}
  </ContentProvider>;
}

export default async function ComposePage(props: Parameters<typeof ComposePageContent>[0]) {
  const [{ catalog }, actions] = await Promise.all([loadPublishingCopy(), loadPublishingActionCopy()]);
  return <PublishingCopyProvider catalog={catalog}><PublishingActionCopyProvider catalog={actions}>{await ComposePageContent(props)}</PublishingActionCopyProvider></PublishingCopyProvider>;
}
