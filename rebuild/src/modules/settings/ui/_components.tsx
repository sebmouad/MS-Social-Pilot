import { SettingsCopyProvider } from './copy-context';
import type { SettingsUiCopy } from './copy-catalog';
import { settingsUiCopy } from './copy-catalog';
import type { ReactNode } from 'react';
import type { FeatureId } from '@/lib/product';
import styles from './settings.module.css';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/Badge';
import { LinkTabs } from '@/components/Tabs';
import { readSectionsCopy } from './copy-server';
import { SECTION_TABS, sectionOf, type SectionTabKey } from './section-tabs';
import { fill } from './shell-copy';

export { styles };
export type { SectionTabKey };

/** Link tabs of the section a tab belongs to (async server component, so pages stay synchronous when they have no tabs). */
export async function SectionTabs({ tab, locale, title }: { tab: SectionTabKey; locale: 'en' | 'fr'; title: string }) {
  const sections = await readSectionsCopy(locale);
  const items = SECTION_TABS[sectionOf(tab)];
  return <LinkTabs items={items.map(item => ({ id: item.key, href: item.href, label: sections.tabs[item.key] }))} activeId={tab} label={fill(sections.tabsLabel, { section: title })} moreLabel="…" maxVisible={items.length} />;
}

export function SettingsPage({ title, description, children, copy = settingsUiCopy, locale = 'en', tab }: {
  copy?: SettingsUiCopy;
  locale?: 'en' | 'fr';
  active: FeatureId;
  title: string;
  description: string;
  /** Tab of the section this page belongs to; omit on pages without tabs. The section list itself lives in the shell. */
  tab?: SectionTabKey;
  children: ReactNode;
}) {
  const tabs = tab ? <SectionTabs tab={tab} locale={locale} title={title} /> : null;
  return <SettingsCopyProvider copy={copy}><div className={styles['settings-page']} data-module="settings">
    <PageHeader module="settings" title={title} description={description} tabs={tabs} />
    {children}
  </div></SettingsCopyProvider>;
}

export function SettingsPanel({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return <section className={styles['settings-panel']}><div className={styles['settings-panel__heading']}><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div></div>{children}</section>;
}

export function Status({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warning' | 'neutral' }) {
  return <Badge tone={tone === "good" ? "success" : tone}>{children}</Badge>;
}
