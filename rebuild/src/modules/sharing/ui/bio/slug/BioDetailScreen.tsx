import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { IconExternalLink } from '@tabler/icons-react';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { authLocale } from '@/modules/home/auth/locale';
import { clientIpFromHeaders } from '@/server/client-ip';
import { openPublicBio } from '@/modules/sharing/server/bio';
import { sharingCopy } from '@/modules/sharing/server/limits';
import { publicCopy } from '@/modules/sharing/ui/copy';
import styles from './bio.module.css';

export const metadata: Metadata = { title: 'Links', referrer: 'no-referrer' };

export default async function BioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = publicCopy(await authLocale());
  let access: Awaited<ReturnType<typeof openPublicBio>>;
  try { access = await openPublicBio(slug, clientIpFromHeaders(await headers()), 'render'); }
  catch { return <main className={styles.page}><EmptyState tone="error" title={t.loadFailed} /></main>; }
  if (!access.ok && access.reason === 'rate_limited') return <main className={styles.page}><EmptyState tone="error" title={t.rateLimited} /></main>;
  if (!access.ok) notFound();
  const bio = access.value;
  const { bioFooter } = await sharingCopy();
  return <main className={styles.page}>
    <Avatar name={bio.title} src={bio.avatarUrl} size="lg" decorative />
    <h1>{bio.title}</h1>
    {bio.description && <p className={styles.lead}>{bio.description}</p>}
    {bio.links.length
      ? <ul className={styles.links}>{bio.links.map(link => <li key={link.id}><a href={`/bio/${encodeURIComponent(slug)}/go/${encodeURIComponent(link.id)}`} rel="nofollow noopener"><span>{link.label}</span><IconExternalLink size={16} aria-hidden="true" /></a></li>)}</ul>
      : <EmptyState title={t.bio.noLinks} />}
    {bioFooter && <p className={styles.note}>{bioFooter}</p>}
  </main>;
}
