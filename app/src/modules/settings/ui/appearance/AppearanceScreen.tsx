import { readWebApp } from '@/modules/settings/web-app/service';
import { InstallControl } from '@/modules/settings/web-app/InstallControl';
import { configValueOrDefault } from '@/server/config/config-or-default';
import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPage, SettingsPanel, styles as settingsStyles } from '@/modules/settings/ui/_components';
import { settingsLocale } from '@/modules/settings/ui/locale';
import { AppearancePicker } from './picker';
import type { AppearanceCopy } from './copy';
import { runtimeConfig } from '@/server/config/store';
import { accountSessionActor } from '@/modules/settings/server/account-session';
import { appearanceSession } from '@/modules/settings/server/appearance';
import { canAccessFeature } from '@/server/permissions';

export const metadata: Metadata = { title: 'Appearance' };

export default async function AppearancePage() {
  const viewer = await requireViewer({ feature: 'settings/appearance', channelScoped: true });
  const locale = await settingsLocale();
  const t = (await configValueOrDefault('settings.appearanceCopy'))[locale] as AppearanceCopy;
  const appearance = await appearanceSession(await accountSessionActor(viewer.user.id, viewer.workspaceId));
  const webApp = await readWebApp(await accountSessionActor(viewer.user.id, viewer.workspaceId));
  return <PageFrame module="settings" scopedAccess><SettingsPage tab="accountAppearance" active="settings/appearance" title={t.title} description={t.description} locale={locale}>
    <SettingsPanel title={t.panel} detail={t.panelDetail}>
      <AppearancePicker initialTheme={appearance.theme} initialMode={appearance.mode} copy={t} canWrite={canAccessFeature(viewer.permissions, 'settings/appearance', 'write')} />
    </SettingsPanel>
    {webApp.enabled ? <SettingsPanel title={webApp.copy[locale].title}><InstallControl requestTimeoutMs={webApp.requestTimeoutMs} copy={webApp.copy[locale]} canWrite={canAccessFeature(viewer.permissions, 'settings/appearance', 'write')} /></SettingsPanel> : null}
    <p className={settingsStyles['settings-note']}>{t.note}</p>
  </SettingsPage></PageFrame>;
}
