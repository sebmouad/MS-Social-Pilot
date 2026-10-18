import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { clientIpFromHeaders } from '@/server/client-ip';
import { loadPublicView, publicMode, resolvePublicLink } from '@/modules/sharing/server/public';
import { sharingCopy } from '@/modules/sharing/server/limits';
import { ReviewActions } from './ReviewActions';
import styles from './share.module.css';

export const dynamic = 'force-dynamic';
/** The address is a credential: never indexed, never sent onward in a Referer header. */
export const metadata: Metadata = { title: 'Shared with you', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };

const STATUS: Record<string, string> = { awaiting_review: 'Waiting for your decision', planned: 'Planned', published: 'Published' };
const when = (date: Date | null, zone: string) => date ? new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short', timeZone: zone }).format(date) : 'No date yet';

export default async function SharePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const tab = (await searchParams).tab;
  const access = await resolvePublicLink(token, clientIpFromHeaders(await headers()));
  if (!access.ok && access.reason === 'rate_limited') return <main className={styles.page}><p role="alert" className={styles.notice}>Too many visits just now. Please wait a few minutes and try again.</p></main>;
  if (!access.ok) notFound();
  const link = access.value;
  const mode = publicMode(link, Array.isArray(tab) ? tab[0] : tab);
  let view: Awaited<ReturnType<typeof loadPublicView>>;
  const copy = await sharingCopy();
  try { view = await loadPublicView(link, mode); }
  catch { return <main className={styles.page}><p role="alert" className={styles.notice}>This page could not be loaded. Please try again shortly.</p></main>; }
  return <main className={styles.page}>
    <header className={styles.header}><strong>{link.workspaceName}</strong><span className={styles.badge}>{link.kind === 'portal' ? 'Client portal' : link.kind === 'review' ? 'Review' : 'Calendar'}</span></header>
    <div className={styles.body}>
      <h1>{link.title}</h1>
      {copy.intro && <p className={styles.lead}>{copy.intro}</p>}
      {link.description && <p className={styles.lead}>{link.description}</p>}
      {link.kind === 'portal' && <nav aria-label="Sections" className={styles.tabs}><a aria-current={mode === 'review' ? 'page' : undefined} href="?tab=review">To review</a><a aria-current={mode === 'calendar' ? 'page' : undefined} href="?tab=calendar">Calendar</a></nav>}
      {!view.posts.length && <p className={styles.empty}>{mode === 'review' ? 'Nothing is waiting for review right now.' : 'Nothing is planned in this period.'}</p>}
      <ul className={styles.list}>{view.posts.map(post => <li key={post.id} className={styles.card}>
        <div className={styles.meta}><span>{when(post.scheduledAt, link.timezone)}</span><span className={styles.status}>{STATUS[post.status]}</span></div>
        <p className={styles.destinations}>{post.destinations.map(d => d.name).join(', ') || 'Selected channels'}</p>
        <p className={styles.message}>{post.message || 'No text'}</p>
        {post.link && <a className={styles.attach} href={post.link} rel="noopener noreferrer nofollow" target="_blank">{post.link}</a>}
        {post.media.length > 0 && <div className={styles.media}>{post.media.map(item => item.kind === 'image' ? /* eslint-disable-next-line @next/next/no-img-element */ <img key={item.url} src={item.url} alt="" referrerPolicy="no-referrer" loading="lazy" /> : <a key={item.url} href={item.url} rel="noopener noreferrer nofollow" target="_blank">Video attachment</a>)}</div>}
        {post.uploadedImages.length > 0 && <div className={styles.media}>{post.uploadedImages.map(id => /* eslint-disable-next-line @next/next/no-img-element */ <img key={id} src={`/share/${encodeURIComponent(token)}/media/${id}`} alt="" referrerPolicy="no-referrer" loading="lazy" />)}</div>}
        {post.uploadedMediaCount > post.uploadedImages.length && <p className={styles.attach}>{post.uploadedMediaCount - post.uploadedImages.length} more uploaded {post.uploadedMediaCount - post.uploadedImages.length === 1 ? 'file' : 'files'} attached (no preview)</p>}
        {post.latestFeedback && <p className={styles.feedback}>Last answer: {post.latestFeedback.decision === 'approved' ? 'approved' : post.latestFeedback.decision === 'rejected' ? 'changes requested' : 'comment sent'}</p>}
        {mode === 'review' && (link.allowComments || post.canDecide) && <ReviewActions token={token} postId={post.id} canDecide={post.canDecide} allowComments={link.allowComments} notice={copy.answerNotice} />}
      </li>)}</ul>
      {view.truncated && <p className={styles.notice}>Only the first {view.posts.length} posts are shown.</p>}
    </div>
  </main>;
}
