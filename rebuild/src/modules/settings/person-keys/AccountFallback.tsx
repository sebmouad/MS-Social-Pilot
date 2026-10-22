import { readSettingsUiCopy } from '../ui/copy-server';
import { SettingsCopyProvider } from '../ui/copy-context';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { prisma } from '@/server/data';
import { shellChrome } from '@/modules/shell/server/chrome';
import { personKeySessionActor } from './session';
import { PersonKeysManager } from './Manager';


/** Account-only fallback when workspace settings cannot be opened, including after losing all memberships. */
export async function PersonKeysAccountFallback({ locale }: { locale: 'en' | 'fr' }) {
  let actor;
  try { actor = await personKeySessionActor(); } catch { redirect('/sign-in'); }
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true, disabledAt: true } });
  if (!user || user.disabledAt) redirect('/sign-in');
  const copy = await readSettingsUiCopy();
  const t = copy.personKeys[locale];
  const chrome = await shellChrome();
  return <SettingsCopyProvider copy={copy}><AppShell activeModule="settings" enabledModules={['settings']} enabledFeatures={['settings/account']} rootAccess={false} copy={chrome.copy} policy={chrome.policy} userName={user.name} workspaceName={t.account}>
    <section className="route-state"><h1>{t.account}</h1><PersonKeysManager locale={locale} /></section>
  </AppShell></SettingsCopyProvider>;
}
