'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconChartBar,
  IconClick,
  IconExternalLink,
  IconEye,
  IconMessageCircle,
  IconRefresh,
  IconShare,
  IconThumbUp,
} from '@tabler/icons-react';
import { StatusChip } from '@/components';
import { refreshPostMetricsAction } from '@/modules/publishing/ui/posts/actions';
import type { PostPerformanceMetrics } from '../../../../server/post-reach';
import styles from './performance-card.module.css';

interface Props {
  postId: string;
  initialMetrics?: PostPerformanceMetrics | null;
  locale?: string;
  timeZone?: string;
}

export function PostPerformanceCard({ postId, initialMetrics, locale = 'en', timeZone = 'UTC' }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const metrics = initialMetrics;

  const handleSync = () => {
    startTransition(async () => {
      try {
        const res = await refreshPostMetricsAction(postId);
        if (res.ok) {
          setNotice(res.message);
          router.refresh();
        } else {
          setNotice(`Sync failed: ${res.message}`);
        }
      } catch (err) {
        setNotice(`Sync error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    });
  };

  const hasMetrics = metrics && (metrics.measured > 0 || metrics.reach > 0 || metrics.likes > 0 || metrics.views > 0);
  const lastSyncLabel = metrics?.lastSyncedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(metrics.lastSyncedAt))
    : null;

  return (
    <section className={styles.container} aria-label="Platform Performance and Insights">
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <IconChartBar size={22} className={styles.kpiIcon} aria-hidden="true" />
          <h2 className={styles.title}>Live Platform Performance</h2>
          {lastSyncLabel ? <span className={styles.syncStatus}>Synced: {lastSyncLabel}</span> : null}
        </div>
        <button
          type="button"
          className={styles.refreshButton}
          onClick={handleSync}
          disabled={isPending}
          title="Fetch latest real-time stats directly from connected platforms"
        >
          <IconRefresh size={16} className={isPending ? styles.spinning : undefined} aria-hidden="true" />
          <span>{isPending ? 'Syncing...' : 'Sync Real Data'}</span>
        </button>
      </header>

      {notice ? <div className={styles.syncNotice} role="status">{notice}</div> : null}

      <div className={styles.grid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>Reach (Unique)</span>
            <IconEye size={16} className={styles.kpiIcon} aria-hidden="true" />
          </div>
          <div className={styles.kpiValue}>{(metrics?.reach || metrics?.views || 0).toLocaleString(locale)}</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>Likes & Reactions</span>
            <IconThumbUp size={16} className={styles.kpiIcon} aria-hidden="true" />
          </div>
          <div className={styles.kpiValue}>{(metrics?.likes || 0).toLocaleString(locale)}</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>Comments</span>
            <IconMessageCircle size={16} className={styles.kpiIcon} aria-hidden="true" />
          </div>
          <div className={styles.kpiValue}>{(metrics?.comments || 0).toLocaleString(locale)}</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>Shares</span>
            <IconShare size={16} className={styles.kpiIcon} aria-hidden="true" />
          </div>
          <div className={styles.kpiValue}>{(metrics?.shares || 0).toLocaleString(locale)}</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>Total Views</span>
            <IconEye size={16} className={styles.kpiIcon} aria-hidden="true" />
          </div>
          <div className={styles.kpiValue}>{(metrics?.views || 0).toLocaleString(locale)}</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>Link Clicks</span>
            <IconClick size={16} className={styles.kpiIcon} aria-hidden="true" />
          </div>
          <div className={styles.kpiValue}>{(metrics?.clicks || 0).toLocaleString(locale)}</div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiLabel}>Engagement Rate</span>
            <IconChartBar size={16} className={styles.kpiIcon} aria-hidden="true" />
          </div>
          <div className={styles.kpiValue}>{metrics?.engagementRate ?? 0}%</div>
        </div>
      </div>

      {metrics?.destinations && metrics.destinations.length > 0 ? (
        <div>
          <h3 className={styles.destinationsTitle}>Data by Platform & Destination</h3>
          <ul className={styles.destinationsList}>
            {metrics.destinations.map(dest => {
              const directUrl = dest.remoteUrl;
              return (
                <li key={dest.targetId} className={styles.destinationCard}>
                  <div className={styles.destHeader}>
                    <div className={styles.destIdentity}>
                      {dest.targetPictureUrl ? (
                        <img className={styles.destAvatar} src={dest.targetPictureUrl} alt="" />
                      ) : (
                        <div className={styles.destAvatarFallback}>{dest.targetName.slice(0, 2).toUpperCase()}</div>
                      )}
                      <span className={styles.destName}>{dest.targetName}</span>
                      <StatusChip status={dest.status} compact locale={locale.startsWith('fr') ? 'fr' : 'en'} />
                    </div>
                    {directUrl ? (
                      <a
                        href={directUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.externalLink}
                        title={`View post directly on ${dest.targetName}`}
                      >
                        <span>View on Platform</span>
                        <IconExternalLink size={14} aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>

                  <div className={styles.destMetricsGrid}>
                    <div className={styles.destMetricItem}>
                      <IconEye size={14} aria-hidden="true" />
                      <span>Reach:</span>
                      <strong>{(dest.reach || dest.views || 0).toLocaleString(locale)}</strong>
                    </div>
                    <div className={styles.destMetricItem}>
                      <IconThumbUp size={14} aria-hidden="true" />
                      <span>Likes:</span>
                      <strong>{dest.likes.toLocaleString(locale)}</strong>
                    </div>
                    <div className={styles.destMetricItem}>
                      <IconMessageCircle size={14} aria-hidden="true" />
                      <span>Comments:</span>
                      <strong>{dest.comments.toLocaleString(locale)}</strong>
                    </div>
                    {dest.shares > 0 ? (
                      <div className={styles.destMetricItem}>
                        <IconShare size={14} aria-hidden="true" />
                        <span>Shares:</span>
                        <strong>{dest.shares.toLocaleString(locale)}</strong>
                      </div>
                    ) : null}
                    {dest.views > 0 ? (
                      <div className={styles.destMetricItem}>
                        <span>Views:</span>
                        <strong>{dest.views.toLocaleString(locale)}</strong>
                      </div>
                    ) : null}
                    {dest.clicks > 0 ? (
                      <div className={styles.destMetricItem}>
                        <IconClick size={14} aria-hidden="true" />
                        <span>Clicks:</span>
                        <strong>{dest.clicks.toLocaleString(locale)}</strong>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
