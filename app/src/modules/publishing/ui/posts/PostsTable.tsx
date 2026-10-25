'use client';
import { usePublishingCopy } from '../kit/CopyProvider';

import { useCallback, useState, type ComponentProps, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { IconExternalLink, IconEye, IconMessageCircle, IconThumbUp } from '@tabler/icons-react';
import { DataTable, ListRow, SidePanel, StatusChip, type TableColumn } from '@/components';
import { PostPreview, type PostPreviewPost } from '@/components/PostPreview';
import type { PostPerformanceMetrics } from '../../server/post-reach';
import { postContentSummary } from '@/modules/publishing/content-summary';
import { AttentionHint, Avatar, AvatarStack, MediaThumb } from '../kit/kit';
import { type KitLocale } from '../kit/copy';
import { useContent } from '../ContentProvider';
import { fillContent } from '../content-copy';
import { BulkPostActions } from './BulkPostActions';
import { OriginBadge } from '../origins/OriginBadge';
import { PostRowActions } from './PostActions';
import type { PostOriginView } from '../origins/post-origin';
import { ChannelsCell, PostCell, ReachCell, StatusCell, postThumbUrl } from './PostTableCells';
import styles from './posts-table.module.css';

type ManageProps = ComponentProps<typeof PostRowActions>;
export type PostsTableRow = Omit<ManageProps['post'], 'targets'> & {
  id: string; authorId: string; createdAt: Date; scheduledAt: Date | null;
  targets: Array<Omit<ManageProps['post']['targets'][number], 'target'> & { remoteUrl: string | null; target: { id: string; type: string; name: string; pictureUrl: string | null; platformName?: string | null } }>;
  /** Publish time already formatted in the workspace time zone on the server, so hydration cannot disagree. */
  whenLabel: string;
  /** Who wrote it, resolved on the server for the preview. */
  authorName: string;
  /** Set when an installed automation created the post. */
  origin?: PostOriginView | null;
  /** Per-row authority decided by the server; the actions re-check on submit. */
  canEdit: boolean; canDuplicate: boolean;
  /** Stored reach and real platform metrics across published destinations. */
  reach?: PostPerformanceMetrics;
};
export type PostsTableManage = Pick<ManageProps, 'targets' | 'canPublish' | 'canOrganize' | 'canQueue' | 'imageRules' | 'timeZone' | 'undoSendSeconds'>;

/**
 * Content › Posts (design v2 S2): the shared table with a side preview. Activating a row opens the post detail page;
 * the preview button opens the post beside the list (`?post=<id>` keeps it shareable); the list stays usable.
 * Phones get compact rows that open the post page.
 */
export function PostsTable({ rows, caption, locale = 'en', timeZone = 'UTC', selectable, canRetry, manage, empty, initialPostId }: { rows: PostsTableRow[]; caption: string; timeZone?: string; locale?: KitLocale; selectable: boolean; canRetry: boolean; manage: PostsTableManage | null; empty: ReactNode; initialPostId?: string }) {
  const copy = usePublishingCopy(locale);
  const { copy: content } = useContent();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(initialPostId ?? null);
  const current = rows.find(row => row.id === openId) ?? null;
  const label = (row: PostsTableRow) => postContentSummary(row.message, row.media, row.link, copy) || row.id;

  // The address follows the panel without a server round trip; every other parameter stays.
  const show = useCallback((id: string | null) => {
    setOpenId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('post', id); else url.searchParams.delete('post');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const columns: TableColumn<PostsTableRow>[] = [
    { key: 'post', label: copy.columnPost, render: row => <><button type="button" className={styles.rowOpen} aria-haspopup="true" aria-expanded={openId === row.id} aria-label={fillContent(content.postsOpenRow, { text: label(row).slice(0, 80) })} onClick={event => { event.stopPropagation(); show(openId === row.id ? null : row.id); }}><PostCell post={row} locale={locale} showOrigin={false} /></button>{row.origin ? <span className={styles.rowOrigin}><OriginBadge origin={row.origin} /></span> : null}</> },
    { key: 'channels', label: copy.columnChannels, render: row => <ChannelsCell post={row} locale={locale} /> },
    { key: 'status', label: copy.columnStatus, render: row => <StatusCell post={row} locale={locale} /> },
    { key: 'reach', label: copy.columnReach, align: 'end', render: row => <ReachCell reach={row.reach} locale={locale} /> },
    { key: 'scheduled', label: copy.columnWhen, render: row => row.whenLabel },
  ];
  if (!rows.length) return <>{empty}</>;
  return <>
    {selectable ? <BulkPostActions selected={selected} onClear={() => setSelected([])} canRetry={canRetry} locale={locale} /> : null}
    <div className={styles.split} data-open={current ? 'true' : undefined}>
      <div className={styles.listPane}>
        <div className={styles.desktopList}>
          <DataTable columns={columns} rows={rows} rowKey={row => row.id} caption={caption} stackOnPhone={false}
            onRowClick={row => router.push(`/content/post/${encodeURIComponent(row.id)}`)}
            selection={selectable ? { selected, onChange: setSelected, rowLabel: row => copy.selectPost(label(row).slice(0, 60)), selectAllLabel: copy.selectAll } : undefined}
            rowActionsLabel={row => copy.actionsFor(label(row).slice(0, 60))}
            rowActions={row => [
              { key: 'preview', label: content.postsPanelTitle, icon: <IconEye size={16} />, onSelect: () => show(row.id) },
              { key: 'details', label: copy.openDetails, icon: <IconExternalLink size={16} />, onSelect: () => router.push(`/content/post/${encodeURIComponent(row.id)}`) },
            ]} />
        </div>
        <ul className={styles.phoneList} aria-label={caption}>
          {rows.map(row => {
            const failed = row.targets.some(target => target.status === 'failed');
            const channels = [...new Map(row.targets.map(({ target }) => [target.id, target])).values()];
            const reachNum = row.reach?.reach ?? row.reach?.value ?? null;
            const likes = row.reach?.likes ?? 0;
            const comments = row.reach?.comments ?? 0;
            return <li key={row.id}><ListRow href={`/content/post/${encodeURIComponent(row.id)}`}
              leading={<MediaThumb url={postThumbUrl(row.media)} alt="" count={Array.isArray(row.media) ? row.media.length : 0} video={false} locale={locale} />}
              title={label(row)}
              meta={<>
                <AvatarStack channels={channels} max={3} locale={locale} />
                <StatusChip status={row.status} compact />
                {failed ? <AttentionHint locale={locale} /> : null}
                {reachNum !== null && (row.reach?.measured ?? 0) > 0 ? (
                  <span className={styles.phoneMetrics}>
                    {reachNum.toLocaleString(locale)} reach
                    {likes > 0 ? ` · ${likes.toLocaleString(locale)} likes` : ''}
                    {comments > 0 ? ` · ${comments.toLocaleString(locale)} comments` : ''}
                  </span>
                ) : null}
                <span>{row.whenLabel}</span>
              </>} /></li>;
          })}
        </ul>
      </div>
      <SidePanel open={Boolean(current)} title={content.postsPanelTitle} closeLabel={content.postsPanelClose} onClose={() => show(null)} className={styles.panel}
        actions={current ? <a className="ui-button ui-button--secondary" href={`/content/post/${encodeURIComponent(current.id)}`}>{content.postsPanelDetails}</a> : undefined}>
        {current ? <div className={styles.panelBody}>
          <PostPreview post={current as PostPreviewPost} authorName={current.authorName} timeZone={timeZone} locale={locale} variant="card" metrics={current.reach} />

          {/* Real Platform Performance Metrics */}
          {current.reach && (current.reach.measured > 0 || current.reach.reach > 0 || current.reach.likes > 0) ? (
            <section className={styles.panelMetricsSection} aria-label="Platform performance">
              <h3 className={styles.panelSectionTitle}>Real Platform Performance</h3>
              <div className={styles.panelMetricsGrid}>
                <div className={styles.panelMetricCard}>
                  <div className={styles.metricVal}>{(current.reach.reach || current.reach.views || 0).toLocaleString(locale)}</div>
                  <div className={styles.metricLbl}>Reach</div>
                </div>
                <div className={styles.panelMetricCard}>
                  <div className={styles.metricVal}>{current.reach.likes.toLocaleString(locale)}</div>
                  <div className={styles.metricLbl}>Likes</div>
                </div>
                <div className={styles.panelMetricCard}>
                  <div className={styles.metricVal}>{current.reach.comments.toLocaleString(locale)}</div>
                  <div className={styles.metricLbl}>Comments</div>
                </div>
                <div className={styles.panelMetricCard}>
                  <div className={styles.metricVal}>{current.reach.shares.toLocaleString(locale)}</div>
                  <div className={styles.metricLbl}>Shares</div>
                </div>
                <div className={styles.panelMetricCard}>
                  <div className={styles.metricVal}>{current.reach.views.toLocaleString(locale)}</div>
                  <div className={styles.metricLbl}>Views</div>
                </div>
                <div className={styles.panelMetricCard}>
                  <div className={styles.metricVal}>{current.reach.clicks.toLocaleString(locale)}</div>
                  <div className={styles.metricLbl}>Clicks</div>
                </div>
              </div>
            </section>
          ) : null}

          <section aria-labelledby="post-panel-destinations">
            <h3 id="post-panel-destinations">{content.postsPanelDestinations}</h3>
            {current.targets.length ? <ul className={styles.destinations}>{current.targets.map(({ id, status, remoteUrl, target }) => {
              const destMetric = current.reach?.destinations?.find(d => d.targetId === target.id);
              return <li key={id ?? target.id}>
                <Avatar name={target.name} src={target.pictureUrl} size={24} />
                <span className={styles.destName}>{target.name}</span>
                {destMetric && (destMetric.likes > 0 || destMetric.comments > 0 || destMetric.reach > 0) ? (
                  <div className={styles.destMetrics}>
                    {destMetric.likes > 0 ? <span><IconThumbUp size={11} aria-hidden="true" /> {destMetric.likes}</span> : null}
                    {destMetric.comments > 0 ? <span><IconMessageCircle size={11} aria-hidden="true" /> {destMetric.comments}</span> : null}
                    {destMetric.reach > 0 ? <span><IconEye size={11} aria-hidden="true" /> {destMetric.reach}</span> : null}
                  </div>
                ) : null}
                <StatusChip status={status} compact />
                {remoteUrl || destMetric?.remoteUrl ? <a href={remoteUrl || destMetric?.remoteUrl || '#'} target="_blank" rel="noopener noreferrer" aria-label={`${copy.openDetails}: ${target.name}`}><IconExternalLink size={15} aria-hidden="true" /></a> : null}
              </li>;
            })}</ul> : <p>{content.postsPanelNoDestinations}</p>}
          </section>
          {manage ? <section aria-labelledby="post-panel-actions">
            <h3 id="post-panel-actions">{content.postsPanelActions}</h3>
            {current.canEdit ? <PostRowActions post={current} canEdit={current.canEdit} canDuplicate={current.canDuplicate} {...manage} /> : <p>{copy.actionsLimited}</p>}
          </section> : null}
        </div> : null}
      </SidePanel>
    </div>
  </>;
}
