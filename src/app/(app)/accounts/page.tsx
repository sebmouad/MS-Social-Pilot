import { redirect } from 'next/navigation';
import { screenMetadata } from '@/lib/metadata';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('nav.accounts');
}


/**
 * The old accounts screen.
 *
 * Its job — connect a Facebook user, list the Pages and Groups behind it — is
 * now part of Connections, which also covers tokens, Instagram accounts and ad
 * accounts. Kept as a redirect because the OAuth callback and several emails
 * still point people here.
 */
export default function AccountsPage() {
  redirect('/connections');
}
