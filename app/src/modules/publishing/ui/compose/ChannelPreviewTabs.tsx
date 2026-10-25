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
  }), {
    id: 'grid_planner',
    label: cc.createGridPreview,
    content: (
      <div className={styles.gridPlanner}>
        <div className={styles.gridProfileHeader}>
          <div className={styles.gridProfileAvatar}>{authorFallback.slice(0, 2).toUpperCase()}</div>
          <div className={styles.gridProfileStats}>
            <div><strong>1,248</strong><span>posts</span></div>
            <div><strong>48.6K</strong><span>followers</span></div>
            <div><strong>320</strong><span>following</span></div>
          </div>
        </div>
        <p className={styles.previewNote} style={{ margin: 0 }}>
          Visual Feed Harmony: preview how this upcoming post fits your Instagram / TikTok grid profile.
        </p>
        <div className={styles.nineGridContainer}>
          <div className={`${styles.gridCell} ${styles.gridCellUpcoming}`}>
            <span className={styles.gridCellBadge}>Upcoming</span>
            {attachments.items.length > 0 && attachments.items[0].url ? (
              <img
                src={attachments.items[0].url.startsWith('media:') ? `/api/media/${attachments.items[0].url.slice(6)}` : attachments.items[0].url}
                alt="Draft"
              />
            ) : (
              <div style={{ color: 'var(--ink-faint)', fontSize: '11px', textAlign: 'center', padding: '8px' }}>
                Draft Media
              </div>
            )}
          </div>
          {[
            { id: 2, likes: '1.4k', comments: '52', bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
            { id: 3, likes: '890', comments: '34', bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
            { id: 4, likes: '2.1k', comments: '112', bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
            { id: 5, likes: '954', comments: '28', bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
            { id: 6, likes: '1.8k', comments: '76', bg: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
            { id: 7, likes: '3.2k', comments: '140', bg: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)' },
            { id: 8, likes: '620', comments: '19', bg: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)' },
            { id: 9, likes: '1.1k', comments: '45', bg: 'linear-gradient(135deg, #5ee7df 0%, #b490ca 100%)' },
          ].map(cell => (
            <div key={cell.id} className={styles.gridCell} style={{ background: cell.bg }}>
              <div className={styles.gridCellStats}>
                <span>❤️ {cell.likes}</span>
                <span>💬 {cell.comments}</span>
              </div>
            </div>
          ))}
        </div>
        <div className={styles.gridHarmony}>
          <span>Color Harmony & Balance:</span>
          <div className={styles.colorPalette}>
            <span className={styles.colorDot} style={{ background: 'var(--accent)' }} />
            <span className={styles.colorDot} style={{ background: '#764ba2' }} />
            <span className={styles.colorDot} style={{ background: '#4facfe' }} />
            <span className={styles.colorDot} style={{ background: '#fa709a' }} />
            <span className={styles.colorDot} style={{ background: '#38f9d7' }} />
          </div>
        </div>
      </div>
    ),
  }];
  return <Tabs items={items} value={value} onChange={onChange} label={cc.createPreviewTitle} className="composer-channel-tabs" />;
}
