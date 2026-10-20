import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPage, SettingsPanel, styles as settingsStyles } from '@/modules/settings/ui/_components';
import { settingsLocale } from '@/modules/settings/ui/locale';
import { AppearancePicker } from './picker';
import { appearanceCopy } from './copy';

export const metadata: Metadata = { title: 'Appearance' };

export default async function AppearancePage() {
  await requireViewer({ feature: 'settings/appearance' });
  const locale = await settingsLocale();
  const t = appearanceCopy[locale];
  return <PageFrame module="settings"><SettingsPage active="settings/appearance" title={t.title} description={t.description} locale={locale}>
    <SettingsPanel title={t.panel} detail={t.panelDetail}>
      <AppearancePicker locale={locale} />
    </SettingsPanel>
    <p className={settingsStyles['settings-note']}>{t.note}</p>
  </SettingsPage></PageFrame>;
}
