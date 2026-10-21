import { SettingsCopyProvider } from './copy-context';
import type { SettingsUiCopy } from './copy-catalog';
import { settingsUiCopy } from './copy-catalog';
import type { ReactNode } from 'react';
import type { FeatureId } from '@/lib/product';
import styles from './settings.module.css';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/Badge';

export { styles };

export function SettingsPage({ active, title, description, children, copy = settingsUiCopy, locale = 'en' }: {
  copy?: SettingsUiCopy;
  locale?: 'en' | 'fr';
  active: FeatureId;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return <SettingsCopyProvider copy={copy}><div className={styles['settings-page']} data-module="settings">
    <PageHeader module="settings" title={title} description={description} />
    {children}
  </div></SettingsCopyProvider>;
}

export function SettingsPanel({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return <section className={styles['settings-panel']}><div className={styles['settings-panel__heading']}><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div></div>{children}</section>;
}

export function Status({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warning' | 'neutral' }) {
  return <Badge tone={tone === "good" ? "success" : tone}>{children}</Badge>;
}
