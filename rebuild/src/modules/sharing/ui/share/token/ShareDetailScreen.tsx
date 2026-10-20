import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { IconCalendarEvent, IconChecklist } from '@tabler/icons-react';
import { Badge, type BadgeTone } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { authLocale } from '@/modules/home/auth/locale';
import { clientIpFromHeaders } from '@/server/client-ip';
import { loadPublicView, publicMode, resolvePublicLink } from '@/modules/sharing/server/public';
import { sharingCopy } from '@/modules/sharing/server/limits';
import { publicCopy } from '@/modules/sharing/ui/copy';
import { ReviewActions } from './ReviewActions';
import styles from './share.module.css';

/** The address is a credential: never indexed, never sent onward in a Referer header. */
export const metadata: Metadata = { title: 'Shared with you', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };

const STATUS_TONE: Record<string, BadgeTone> = { awaiting_review: 'warning', planned: 'brand', published: 'success' };

export default async function SharePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const tab = (await searchParams).tab;
  const locale = await authLocale();
  const t = publicCopy(locale);
  const when = (date: Date | null, zone: string) => date ? new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone: zone }).format(date) : t.share.noDate;
  const access = await resolvePublicLink(token, clientIpFromHeaders(await headers()), 'render');
  if (!access.ok && access.reason === 'rate_limited') return <main className={styles.page}><div className={styles.body}><EmptyState tone="error" title={t.rateLimited} /></div></main>;
  if (!access.ok) notFound();
  const link = access.value;
  const mode = publicMode(link, Array.isArray(tab) ? tab[0] : tab);
  let view: Awaited<ReturnType<typeof loadPublicView>>;
  const copy = await sharingCopy();
  try { view = await loadPublicView(link, mode); }
  catch { return <main className={styles.page}><div className={styles.body}><EmptyState tone="error" title={t.loadFailed} /></div></main>; }
  return <main className={styles.page}>
    <header className={styles.header}><strong>{link.workspaceName}</strong><Badge tone="brand">{t.share.kinds[link.kind] ?? link.kind}</Badge></header>
    <div className={styles.body}>
      <PageHeader title={link.title} description={[copy.intro, link.description].filter(Boolean).join(' ') || undefined} />
      {link.kind === 'portal' && <nav aria-label={t.share.sections} className={styles.tabs}>
        <a aria-current={mode === 'review' ? 'page' : undefined} href="?tab=review"><IconChecklist size={16} aria-hidden="true" />{t.share.tabReview}</a>
        <a aria-current={mode === 'calendar' ? 'page' : undefined} href="?tab=calendar"><IconCalendarEvent size={16} aria-hidden="true" />{t.share.tabCalendar}</a>
      </nav>}
      {!view.posts.length && (mode === 'review'
        ? <EmptyState icon={<IconChecklist size={22} />} title={t.share.emptyReviewTitle}>{t.share.emptyReview}</EmptyState>
        : <EmptyState icon={<IconCalendarEvent size={22} />} title={t.share.emptyCalendarTitle}>{t.share.emptyCalendar}</EmptyState>)}
      <ul className={styles.list}>{view.posts.map(post => <li key={post.id} className={styles.card}>
        <div className={styles.meta}><span>{when(post.scheduledAt, link.timezone)}</span><Badge tone={STATUS_TONE[post.status] ?? 'neutral'}>{t.share.statuses[post.status] ?? post.status}</Badge></div>
        <p className={styles.destinations}>{post.destinations.map(d => d.name).join(', ') || t.share.channels}</p>
        <p className={styles.message}>{post.message || t.share.noText}</p>
        {post.link && <a className={styles.attach} href={post.link} rel="noopener noreferrer nofollow" target="_blank">{post.link}</a>}
        {post.media.length > 0 && <div className={styles.media}>{post.media.map(item => item.kind === 'image' ? /* eslint-disable-next-line @next/next/no-img-element */ <img key={item.url} src={item.url} alt="" referrerPolicy="no-referrer" loading="lazy" /> : <a key={item.url} href={item.url} rel="noopener noreferrer nofollow" target="_blank">{t.share.video}</a>)}</div>}
        {post.uploadedImages.length > 0 && <div className={styles.media}>{post.uploadedImages.map(id => /* eslint-disable-next-line @next/next/no-img-element */ <img key={id} src={`/share/${encodeURIComponent(token)}/media/${id}`} alt="" referrerPolicy="no-referrer" loading="lazy" />)}</div>}
        {post.uploadedMediaCount > post.uploadedImages.length && <p className={styles.attach}>{t.share.moreFiles(post.uploadedMediaCount - post.uploadedImages.length)}</p>}
        {post.latestFeedback && <p className={styles.feedback}>{t.share.lastAnswer}: {post.latestFeedback.decision === 'approved' ? t.share.approved : post.latestFeedback.decision === 'rejected' ? t.share.changes : t.share.commented}</p>}
        {mode === 'review' && (link.allowComments || post.canDecide) && <ReviewActions token={token} postId={post.id} canDecide={post.canDecide} allowComments={link.allowComments} notice={copy.answerNotice} copy={t.review} />}
      </li>)}</ul>
      {view.truncated && <p className={styles.notice}>{t.share.truncated(view.posts.length)}</p>}
    </div>
  </main>;
}
