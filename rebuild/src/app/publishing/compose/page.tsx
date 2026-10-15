import { notFound, redirect } from 'next/navigation';
import { requireViewer } from '@/server/context';
import { getPostForEditing } from '@/server/data';
import { canAccessFeature } from '@/server/permissions';
import { canUseFeature } from '@/server/entitlements';
import { runtimeConfig } from '@/server/config/store';
import { dateToZonedLocal, zoneLabel } from '@/lib/publishing/zoned-time';
import { PageHeading } from '../publishing-ui';
import { composeModules, loadChannelChoices } from '../channels';
import { Composer, type ComposerInitial } from './Composer';

export const metadata = { title: 'New post' };

type StoredMedia = { kind: string; url: string; altText?: string };

function initialFrom(post: NonNullable<Awaited<ReturnType<typeof getPostForEditing>>>): ComposerInitial {
  const media = (Array.isArray(post.media) ? post.media : []) as unknown as StoredMedia[];
  const image = media.find(item => item.kind === 'image');
  const video = media.find(item => item.kind === 'video');
  const base = { postId: post.id, message: post.message, firstComment: post.firstComment ?? '', targetIds: post.targets.map(row => row.targetId), link: '', imageRef: '', imageUrl: '', altText: '', videoUrl: '', keptCount: 0 };
  if (media.length > 1) return { ...base, attachmentKind: 'keep', keptCount: media.length };
  if (post.link) return { ...base, attachmentKind: 'link', link: post.link };
  if (video) return { ...base, attachmentKind: 'video', videoUrl: video.url };
  if (image) return { ...base, attachmentKind: 'image', imageRef: image.url.startsWith('media:') ? image.url : '', imageUrl: image.url.startsWith('media:') ? '' : image.url, altText: image.altText ?? '' };
  return { ...base, attachmentKind: 'none' };
}

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/compose', channelScoped: true });
  if (!canAccessFeature(viewer.permissions, 'publishing/compose', 'write')) redirect('/publishing/posts');
  const { edit } = await searchParams;
  const allowed = viewer.permissions.pageScope.all ? null : viewer.permissions.pageScope.ids;
  const editing = edit ? await getPostForEditing(viewer.workspaceId, edit, allowed, viewer.user.id, viewer.membership.role) : null;
  if (edit && !editing) notFound();

  const [mimeTypes, maxUploadBytes, maxAlt, maxText, maxTargets, mediaRoot, channels] = await Promise.all([
    runtimeConfig('publishing.allowedImageMimeTypes'), runtimeConfig('publishing.maxImageUploadBytes'), runtimeConfig('publishing.maxImageAltCharacters'),
    runtimeConfig('publishing.maxMessageCharacters'), runtimeConfig('publishing.maxTargetsPerPost'), runtimeConfig('storage.mediaRoot'), loadChannelChoices(viewer),
  ]);
  const publishable = channels.filter(channel => channel.canPublish);
  const timeZone = viewer.membership.workspace.timezone;
  const now = new Date();
  return <>
    <PageHeading title={editing ? 'Edit draft' : 'New post'} description={editing ? 'Change this draft, then save it, schedule it, or publish it.' : 'Write once, choose channels, and decide when it goes out.'} />
    <Composer
      channels={publishable.map(channel => ({ id: channel.id, name: channel.name, kindLabel: channel.kindLabel, provider: channel.provider, pictureUrl: channel.pictureUrl }))}
      modules={composeModules()}
      initial={editing ? initialFrom(editing) : null}
      rules={{ maxText: Number(maxText), maxTargets: Number(maxTargets), maxAlt: Number(maxAlt), maxUploadBytes: Number(maxUploadBytes), mimeTypes: mimeTypes as string[] }}
      timeZone={timeZone}
      timeZoneLabel={zoneLabel(timeZone, now)}
      nowLocal={dateToZonedLocal(now, timeZone)}
      canConnect={canAccessFeature(viewer.permissions, 'settings/connections', 'read') && canUseFeature(viewer.entitlements, 'settings/connections')}
      canBrowseLibrary={Boolean(mediaRoot) && canAccessFeature(viewer.permissions, 'publishing/media', 'read') && canUseFeature(viewer.entitlements, 'publishing/media')}
      canUpload={Boolean(mediaRoot)}
    />
  </>;
}
