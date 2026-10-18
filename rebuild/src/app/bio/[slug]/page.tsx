import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { clientIpFromHeaders } from '@/server/client-ip';
import { openPublicBio } from '@/modules/sharing/server/bio';
import { sharingCopy } from '@/modules/sharing/server/limits';
import styles from './bio.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Links', referrer: 'no-referrer' };

export default async function BioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let access: Awaited<ReturnType<typeof openPublicBio>>;
  try { access = await openPublicBio(slug, clientIpFromHeaders(await headers())); }
  catch { return <main className={styles.page}><p role="alert" className={styles.note}>This page could not be loaded. Please try again shortly.</p></main>; }
  if (!access.ok && access.reason === 'rate_limited') return <main className={styles.page}><p role="alert" className={styles.note}>Too many visits just now. Please wait a few minutes and try again.</p></main>;
  if (!access.ok) notFound();
  const bio = access.value;
  const { bioFooter } = await sharingCopy();
  return <main className={styles.page}>
    {bio.avatarUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img className={styles.avatar} src={bio.avatarUrl} alt="" referrerPolicy="no-referrer" />}
    <h1>{bio.title}</h1>
    {bio.description && <p className={styles.lead}>{bio.description}</p>}
    {bio.links.length ? <ul className={styles.links}>{bio.links.map(link => <li key={link.id}><a href={`/bio/${encodeURIComponent(slug)}/go/${encodeURIComponent(link.id)}`} rel="nofollow noopener">{link.label}</a></li>)}</ul> : <p className={styles.note}>No links yet.</p>}
    {bioFooter && <p className={styles.note}>{bioFooter}</p>}
  </main>;
}
