import { requireViewer } from '@/server/context';
import { runtimeConfig } from '@/server/config/store';
import { canAccessFeature } from '@/server/permissions';
import { canUseFeature } from '@/server/entitlements';
import { readTemplatePage } from '@/modules/publishing/server/templates';
import { publishingDestinationChoices } from '@/server/publishing/destinations';
import { isDateKey } from '@/lib/calendar-dates';
import { formatPostPreviewTime } from '@/components/PostPreview';
import { PageHeading } from '../publishing-ui';
import { PostComposer } from './PostComposer';
import styles from '../publishing.module.css';

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ date?: string; time?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true });
  const params = await searchParams;
  const canCreate = canAccessFeature(viewer.permissions, 'publishing/posts', 'write');
  const [allowedMimeTypes, maxUploadBytes, maxAltCharacters, maxMessageCharacters, maxMedia, maxFirstCommentDelayMinutes, choices] = await Promise.all([
    runtimeConfig('publishing.allowedImageMimeTypes'), runtimeConfig('publishing.maxImageUploadBytes'),
    runtimeConfig('publishing.maxImageAltCharacters'), runtimeConfig('publishing.maxMessageCharacters'), runtimeConfig('publishing.maxRemoteMediaPerPost'),
    runtimeConfig('publishing.maxFirstCommentDelayMinutes'), publishingDestinationChoices(viewer),
  ]);
  const canUseTemplates = canUseFeature(viewer.entitlements, 'publishing/templates') && canAccessFeature(viewer.permissions, 'publishing/templates', 'read');
  const templates = canUseTemplates ? await readTemplatePage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {}).then(result => result.templates.map(({ id, name, category, body, hashtags, firstComment, firstCommentDelayMinutes, labelId }) => ({ id, name, category, body, hashtags, firstComment, firstCommentDelayMinutes, labelId }))) : [];
  const createdAt = new Date();
  const schedule = {
    date: params.date && isDateKey(params.date) ? params.date : '',
    time: params.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(params.time) ? params.time : '',
    timeZone: viewer.membership.workspace.timezone,
  };
  return <>
    <PageHeading title="Create a post" description="Choose destinations, write your post, then save a draft or schedule it." />
    {canCreate ? <section className={`${styles.card} ${styles.createCard}`}><PostComposer targets={choices} templates={templates} maxFirstCommentDelayMinutes={Number(maxFirstCommentDelayMinutes)} imageRules={{ allowedMimeTypes: allowedMimeTypes as string[], maxUploadBytes: Number(maxUploadBytes), maxAltCharacters: Number(maxAltCharacters), maxMessageCharacters: Number(maxMessageCharacters), maxMedia: Number(maxMedia) }} schedule={schedule} authorName={viewer.user.name || 'You'} createdAt={createdAt} createdAtDisplay={formatPostPreviewTime(createdAt, schedule.timeZone)} /></section>
      : <section className={styles.card}><p>You do not have permission to create posts in this workspace.</p></section>}
  </>;
}
