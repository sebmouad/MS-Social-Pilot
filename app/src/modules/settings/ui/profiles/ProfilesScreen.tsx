import { configOrDefault } from '@/server/config/config-or-default';
import { readSettingsUiCopy } from '@/modules/settings/ui/copy-server';
import { runtimeConfig } from '@/server/config/store';
import { profileConfirmationCopySchema } from '../../channel-profiles/config';
import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { readChannelProfiles } from '../../channel-profiles/service';

import { SettingsPage, SettingsPanel } from '../_components';
import { ProfilesManager } from './ProfilesManager';
export default async function ProfilesScreen() {
  const viewer = await requireViewer({ feature: 'settings/connections' });
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const uiCopy = await readSettingsUiCopy();
  const copy = uiCopy.profiles[locale];
  const confirmationCopy = (await configOrDefault('settings.channelProfilesConfirmationCopy', profileConfirmationCopySchema))[locale];
  let directory = null;
  try { directory = await readChannelProfiles({ userId: viewer.user.id, workspaceId: viewer.workspaceId }); } catch {}
  return <PageFrame module="settings"><SettingsPage copy={uiCopy} tab="channelsGroups" active="settings/connections" title={copy.title} description={copy.description} locale={locale}>
    <SettingsPanel title={copy.groups}>{directory ? <ProfilesManager confirmationCopy={confirmationCopy} initial={directory} locale={locale} canManage={['owner', 'admin'].includes(viewer.membership.role)} /> : <p role="alert">{copy.unavailable}</p>}</SettingsPanel>
  </SettingsPage></PageFrame>;
}
