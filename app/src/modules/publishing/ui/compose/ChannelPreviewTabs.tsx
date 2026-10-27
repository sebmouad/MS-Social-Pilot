'use client';
import { Tabs } from '@/components';
import { PostPreview, type PostPreviewPost, type PostPreviewRendering } from '@/components/PostPreview';
import { AuthoringMediaPreview, type PostAttachmentsController } from '@/modules/publishing/components/PostAttachments';
import { effectiveDestinationFormat, type DestinationFormatTarget } from '@/modules/publishing/components/DestinationFormats';
import { Avatar } from '@/modules/publishing/ui/kit/kit';
import { useContent } from '../ContentProvider';
import styles from './PostComposer.module.css';
import type { PostThumbnail } from '@/components/post-thumbnail';

export const GRID_PREVIEW_TAB = 'grid_planner';
export type RecentGridPost = { id: string; targetIds: string[]; thumbnail: PostThumbnail | null };
export type ChannelPreviewTarget = DestinationFormatTarget & { pictureUrl?: string | null; platformName?: string | null; displayName: string };

/**
 * Composer preview as tabs: one neutral "All channels" tab plus one tab per selected destination.
 * Each channel tab renders the destination module's safe format metadata (text fold, media shape,
 * caption and first-comment support) through the shared PostPreview. Nothing here knows a provider.
 */
export function ChannelPreviewTabs({ recentPosts, channels, formats, previewPost, attachments, timeZone, locale, authorFallback, value, onChange }: {
  recentPosts: readonly RecentGridPost[];
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
      {/* The post appears from the Page, not from the person writing it: lead with the first selected Page (+N for the others). */}
      <PostPreview post={previewPost} authorName={channels[0] ? `${channels[0].displayName}${channels.length > 1 ? ` +${channels.length - 1}` : ''}` : authorFallback} {...(channels[0]?.pictureUrl ? { authorAvatarUrl: channels[0].pictureUrl } : {})} timeZone={timeZone} locale={locale} variant="card" mediaOverride={<AuthoringMediaPreview controller={attachments} />} />
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
  }), {
    id: GRID_PREVIEW_TAB,
    label: cc.createGridPreview,
    content: (
      <div className={styles.gridPlanner}>
        <p className={styles.previewNote} style={{ margin: 0 }}>{cc.createGridNote}</p>
        <div className={styles.nineGridContainer}>
          <div className={`${styles.gridCell} ${styles.gridCellUpcoming}`}>
            <span className={styles.gridCellBadge}>{cc.createGridThisPost}</span>
            {attachments.items.length > 0 && attachments.items[0].url ? (
              <img src={attachments.items[0].url.startsWith('media:') ? `/api/media/${attachments.items[0].url.slice(6)}` : attachments.items[0].url} alt="" />
            ) : <span className={styles.gridCellEmpty}>{cc.createGridNoMedia}</span>}
          </div>
          {recentPosts.map(post => <div key={post.id} className={styles.gridCell}>
            {post.thumbnail?.url ? <img src={post.thumbnail.url} alt="" loading="lazy" /> : <span className={styles.gridCellEmpty}>{cc.createGridNoMedia}</span>}
          </div>)}
        </div>
        {recentPosts.length === 0 ? <p className={styles.previewNote}>{cc.createGridEmpty}</p> : null}
      </div>
    ),
  }];
  return <Tabs items={items} value={value} onChange={onChange} label={cc.createPreviewTitle} className="composer-channel-tabs" />;
}
