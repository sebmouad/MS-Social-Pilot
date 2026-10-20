import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { readChannelProfiles } from '../../channel-profiles/service';
import { profileCopy } from '../../channel-profiles/copy';
import { SettingsPage, SettingsPanel } from '../_components';
import { ProfilesManager } from './ProfilesManager';
export default async function ProfilesScreen() {
  const viewer = await requireViewer({ feature: 'settings/connections' });
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const copy = profileCopy[locale];
  let directory = null;
  try { directory = await readChannelProfiles({ userId: viewer.user.id, workspaceId: viewer.workspaceId }); } catch {}
  return <PageFrame module="settings"><SettingsPage active="settings/connections" title={copy.title} description={copy.description} locale={locale}>
    <a href="/settings/connections">{copy.back}</a>
    <SettingsPanel title={copy.groups}>{directory ? <ProfilesManager initial={directory} locale={locale} canManage={['owner', 'admin'].includes(viewer.membership.role)} /> : <p role="alert">{copy.unavailable}</p>}</SettingsPanel>
  </SettingsPage></PageFrame>;
}
