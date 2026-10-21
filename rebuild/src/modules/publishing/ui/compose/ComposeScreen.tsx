import { PublishingCopyProvider } from '@/modules/publishing/ui/kit/CopyProvider';
import { loadPublishingCopy } from '@/modules/publishing/server/customer-copy';
import { PublishingActionCopyProvider } from '@/modules/publishing/ui/WorkflowSubmitButtons';
import { loadPublishingActionCopy } from '@/modules/publishing/server/action-copy';
import { loadComposerCopy } from '../../server/composer-copy';
import { readChannelProfiles } from '@/modules/settings/channel-profiles/service';
import { headers } from 'next/headers';
import { requireViewer } from '@/server/context';
import { runtimeConfig } from '@/server/config/store';
import { canAccessFeature } from '@/server/permissions';
import { canUseFeature } from '@/server/entitlements';
import { readTemplatePage } from '@/modules/publishing/server/templates';
import { publishingDestinationChoices } from '@/modules/publishing/server/destinations';
import { isDateKey } from '@/lib/calendar-dates';
import { formatPostPreviewTime } from '@/components/PostPreview';
import { PageHeading } from '@/modules/publishing/ui/publishing-ui';
import { PostComposer } from './PostComposer';
import { aiStatus } from '@/modules/ai/server/ai';
import { loadWorkspaceOperations } from '@/modules/settings/server/workspace-operations';
import styles from '@/modules/publishing/ui/publishing.module.css';

async function ComposePageContent({ searchParams }: { searchParams: Promise<{ date?: string; time?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true });
  const params = await searchParams;
  const copyCatalog = await loadComposerCopy();
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
  // Advisory only: an unavailable setting hides the warning rather than blocking composition.
  const spacingGapMinutes = canCreate ? await loadWorkspaceOperations(viewer.workspaceId).then(value => value.spamGapMinutes, () => 0) : 0;
  // Suggestion-only writing help; the status is empty (and the control hidden) when unavailable.
  const aiLocale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' as const : 'en' as const;
  const aiAssist = canCreate ? await aiStatus({ userId: viewer.user.id, workspaceId: viewer.workspaceId }).catch(() => undefined) : undefined;
  const profiles = await readChannelProfiles({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, 'publishing/posts').catch(() => null);
  const remoteScheduling = { offered: await runtimeConfig('publishing.remoteScheduling.offered') === true, defaultMode: (await runtimeConfig('publishing.remoteScheduling.defaultMode') === 'remote' ? 'remote' : 'application') as 'application' | 'remote' };
  const createdAt = new Date();
  const schedule = {
    date: params.date && isDateKey(params.date) ? params.date : '',
    time: params.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(params.time) ? params.time : '',
    timeZone: viewer.membership.workspace.timezone,
  };
  return <>
    <PageHeading href="/publishing/compose" title={copyCatalog.screenTitle[aiLocale]} description={copyCatalog.screenDescription[aiLocale]} />
    {canCreate ? <section className={`${styles.card} ${styles.createCard}`}><PostComposer copyCatalog={copyCatalog} autosaveSeconds={Number(autosaveSeconds)} remoteScheduling={remoteScheduling} profiles={profiles ?? undefined} queueAvailable={queueAvailable} aiStatus={aiAssist} aiLocale={aiLocale} targets={choices} templates={templates} maxFirstCommentDelayMinutes={Number(maxFirstCommentDelayMinutes)} spacingGapMinutes={spacingGapMinutes} imageRules={{ allowedMimeTypes: allowedMimeTypes as string[], maxUploadBytes: Number(maxUploadBytes), maxAltCharacters: Number(maxAltCharacters), maxMessageCharacters: Number(maxMessageCharacters), maxMedia: Number(maxMedia) }} schedule={schedule} authorName={viewer.user.name || copyCatalog.authorFallback[aiLocale]} createdAt={createdAt} createdAtDisplay={formatPostPreviewTime(createdAt, schedule.timeZone)} /></section>
      : <section className={styles.card}><p>{copyCatalog.noPermission[aiLocale]}</p></section>}
  </>;
}

export default async function ComposePage(props: Parameters<typeof ComposePageContent>[0]) {
  const [{ catalog }, actions] = await Promise.all([loadPublishingCopy(), loadPublishingActionCopy()]);
  return <PublishingCopyProvider catalog={catalog}><PublishingActionCopyProvider catalog={actions}>{await ComposePageContent(props)}</PublishingActionCopyProvider></PublishingCopyProvider>;
}
