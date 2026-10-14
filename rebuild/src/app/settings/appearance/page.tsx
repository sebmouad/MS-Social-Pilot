import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPage, SettingsPanel, styles as settingsStyles } from '../_components';
import { AppearancePicker } from './picker';

export const metadata: Metadata = { title: 'Appearance' };

export default async function AppearancePage() {
  await requireViewer({ feature: 'settings/appearance' });
  return <PageFrame module="settings"><SettingsPage active="settings/appearance" title="Appearance" description="Choose the colors that make your workspace feel right.">
    <SettingsPanel title="Workspace theme" detail="Your choice is saved in this browser and will be ready the next time you visit.">
      <AppearancePicker />
    </SettingsPanel>
    <p className={settingsStyles['settings-note']}>Theme colors are designed to keep text, controls, and focus indicators easy to see.</p>
  </SettingsPage></PageFrame>;
}
