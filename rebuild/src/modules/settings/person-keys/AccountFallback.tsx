import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { prisma } from '@/server/data';
import { personKeySessionActor } from './session';
import { PersonKeysManager } from './Manager';
import { personKeyCopy } from './copy';

/** Account-only fallback when workspace settings cannot be opened, including after losing all memberships. */
export async function PersonKeysAccountFallback({ locale }: { locale: 'en' | 'fr' }) {
  let actor;
  try { actor = await personKeySessionActor(); } catch { redirect('/sign-in'); }
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true, disabledAt: true } });
  if (!user || user.disabledAt) redirect('/sign-in');
  const t = personKeyCopy[locale];
  return <AppShell activeModule="settings" enabledModules={['settings']} enabledFeatures={['settings/account']} rootAccess={false} userName={user.name} workspaceName={t.account}>
    <section className="route-state"><h1>{t.account}</h1><PersonKeysManager locale={locale} /></section>
  </AppShell>;
}
