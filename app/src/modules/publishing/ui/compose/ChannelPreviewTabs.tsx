'use client';
import { Tabs } from '@/components';
import { PostPreview, type PostPreviewPost, type PostPreviewRendering } from '@/components/PostPreview';
import { AuthoringMediaPreview, type PostAttachmentsController } from '@/modules/publishing/components/PostAttachments';
import { effectiveDestinationFormat, type DestinationFormatTarget } from '@/modules/publishing/components/DestinationFormats';
import { Avatar } from '@/modules/publishing/ui/kit/kit';
import { useContent } from '../ContentProvider';
import styles from './PostComposer.module.css';

export type ChannelPreviewTarget = DestinationFormatTarget & { pictureUrl?: string | null; platformName?: string | null; displayName: string };

/**
 * Composer preview as tabs: one neutral "All channels" tab plus one tab per selected destination.
 * Each channel tab renders the destination module's safe format metadata (text fold, media shape,
 * caption and first-comment support) through the shared PostPreview. Nothing here knows a provider.
 */
export function ChannelPreviewTabs({ channels, formats, previewPost, attachments, timeZone, locale, authorFallback, value, onChange }: {
  channels: readonly ChannelPreviewTarget[];
  formats: Record<string, string>;
  previewPost: PostPreviewPost;
  attachments: PostAttachmentsController;
  timeZone: string;
  locale: 'en' | 'fr';
  authorFallback: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const { copy: cc } = useContent();
  const renderingCopy = { seeMore: cc.createPreviewSeeMore, seeLess: cc.createPreviewSeeLess, noCaption: cc.createPreviewNoCaption, noFirstComment: cc.createPreviewNoFirstComment, emptyComment: cc.createPreviewEmptyComment };
  const items = [{
    id: 'all', label: cc.createPreviewAll, content: <>
      <p className={styles.previewNote}>{cc.createPreviewInfo}</p>
      <PostPreview post={previewPost} authorName={authorFallback} timeZone={timeZone} locale={locale} variant="card" mediaOverride={<AuthoringMediaPreview controller={attachments} />} />
    </>,
  }, ...channels.map(target => {
    const name = target.displayName;
    const format = target.publishingFormats?.find(candidate => candidate.id === effectiveDestinationFormat(target, formats));
    const rendering: PostPreviewRendering | undefined = format ? {
      textFoldChars: format.preview?.textFoldChars ?? null,
      mediaAspect: format.preview?.mediaAspect ?? null,
      caption: format.preview?.caption !== false,
      firstComment: format.firstComment ? 'supported' : 'unsupported',
      emptyFirstCommentSlot: true,
      copy: renderingCopy,
    } : undefined;
    const row = previewPost.targets.find(entry => entry.target.id === target.id);
    return {
      id: target.id,
      label: name,
      icon: <Avatar name={name} src={target.pictureUrl} size={22} />,
      content: <>
        <p className={styles.previewNote}>{format ? `${format.label}${target.platformName ? ` · ${target.platformName}` : ''}` : cc.createPreviewNeutral} — {cc.createPreviewApprox}</p>
        <PostPreview post={{ ...previewPost, targets: row ? [row] : [] }} authorName={name} authorAvatarUrl={target.pictureUrl} timeZone={timeZone} locale={locale} variant="card"
          mediaOverride={<AuthoringMediaPreview controller={attachments} layout="tiles" aspect={rendering?.mediaAspect ?? null} />}
          rendering={rendering} />
      </>,
    };
  })];
  return <Tabs items={items} value={value} onChange={onChange} label={cc.createPreviewTitle} className="composer-channel-tabs" />;
}
