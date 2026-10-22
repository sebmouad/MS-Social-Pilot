import { headers } from 'next/headers';
import { requireRootPage } from '@/server/config/access';
import { listClientInvitations, loadClientInvitationCopy } from '../../server/client-invitations';
import { ClientInvitationsManager } from './ClientInvitationsManager';

/** Mount under private Root registration. Never mount this screen in customer Agency. */
export default async function RootClientInvitationsScreen() {
  const actor = await requireRootPage();
  const locale = (await headers()).get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const [initial, copy] = await Promise.all([listClientInvitations(actor.id), loadClientInvitationCopy(locale)]);
  return <ClientInvitationsManager initial={initial} copy={copy} locale={locale} />;
}
