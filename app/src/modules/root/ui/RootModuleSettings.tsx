import { readRootConfig } from '@/modules/root/server/configuration';
import { headers } from 'next/headers';
import { rootCopyLocale } from '@/modules/root/server/admin/copy';
import { ROOT_INTERFACE_COPY, type RootInterfaceCatalog } from '@/lib/config/root-interface-copy';
import { PageHeader } from '@/components/PageHeader';
import { LinkTabs } from '@/components/Tabs';
import { ROOT_CONFIG_COPY, type RootConfigCopy } from '@/lib/config/root-config-copy';
import { RootAvailability } from './RootAvailability';
import { RootDiagnostics } from './RootDiagnostics';
import { RootJobHealth } from '@/modules/root/ui/RootJobHealth';
import { readConfig } from '@/server/config/store';
import { safeConfigShape, AVAILABILITY_CATALOG, CONFIG_BY_KEY } from '@/lib/config/registry';
import { RootFrame } from './RootFrame';
import { RootConfigForm } from '@/app/root/config/root-config-form';
import type { ReactNode } from 'react';
import { requireRootPage } from '@/server/config/access';

const PRODUCT_TABS = ['settings', 'availability', 'diagnostics', 'health'] as const;
const PLATFORM_TABS = ['settings', 'diagnostics', 'health'] as const;
type ModuleTab = (typeof PRODUCT_TABS)[number];

/** Module settings stay in the module's Root section; Root owns authorization and presentation. */
export async function RootModuleSettings({ kind, id, title, description, children, groupPrefix, tab }: {
  kind: 'product' | 'platform'; id: string; title: string; description: string; children?: ReactNode; groupPrefix?: string; tab?: string;
}) {
  const actor = await requireRootPage();
  const definitions = safeConfigShape().filter(setting => setting.owner.kind === kind && setting.owner.id === id)
    .sort((a, b) => Number(!a.key.startsWith('entitlements.')) - Number(!b.key.startsWith('entitlements.')));
  let values: Awaited<ReturnType<typeof readConfig>> | null = null;
  try { values = (await readRootConfig(actor.id)).values; } catch { /* Keep the Root navigation available during a store outage. */ }
  const locale = rootCopyLocale((await headers()).get('accept-language'));
  const interfaceCopy = ((values?.find(value => value.key === 'root.interfaceCopy')?.value ?? ROOT_INTERFACE_COPY) as RootInterfaceCatalog)[locale];
  const configCopy = (values?.find(value => value.key === 'root.configCopy')?.value ?? ROOT_CONFIG_COPY) as RootConfigCopy;
  const keys = new Set(definitions.map(definition => definition.key));
  const tabs = kind === 'product' ? PRODUCT_TABS : PLATFORM_TABS;
  const current: ModuleTab = (tabs as readonly string[]).includes(tab ?? '') ? (tab as ModuleTab) : 'settings';
  const base = kind === 'product' ? `/root/modules/${id}` : `/root/platforms/${id}`;
  const tabLabel = (name: ModuleTab) => name === 'settings' ? interfaceCopy.tabSettings : name === 'availability' ? interfaceCopy.tabAvailability : name === 'diagnostics' ? interfaceCopy.tabDiagnostics : interfaceCopy.tabHealth;
  const availability = {
    modules: AVAILABILITY_CATALOG.modules.filter(module => kind === 'product' && module.id === id),
    features: AVAILABILITY_CATALOG.features.filter(feature => kind === 'product' && feature.module === id),
  };
  return <RootFrame active={base}>
    <PageHeader module="root" title={title} description={<>{description}</>} />
    <LinkTabs label={interfaceCopy.sectionTabs} moreLabel={interfaceCopy.moreSections} activeId={current} items={tabs.map(name => ({ id: name, href: `${base}?tab=${name}`, label: tabLabel(name) }))} />
    {current === 'diagnostics' ? await RootDiagnostics({ scope: `${kind}:${id}` })
      : current === 'health' ? <>{children}{kind === 'product' ? await RootJobHealth({ moduleId: id }) : null}</>
      : current === 'availability' ? <div className="root-config"><RootAvailability modules={availability.modules} features={availability.features} copy={configCopy} /></div>
      : values === null ? <p role="alert" className="root-config__empty">{configCopy.unavailable}</p> : <div className="root-config">
        <RootConfigForm key={`${kind}:${id}`} definitions={definitions} initialValues={values.filter(value => keys.has(value.key))} interfaceCopy={interfaceCopy} searchMaxCharacters={Number(values.find(value => value.key === 'root.configSearchMaxCharacters')?.value ?? CONFIG_BY_KEY.get('root.configSearchMaxCharacters')!.defaultValue)} groupPrefix={groupPrefix} copy={configCopy} hideInventory availability={{
          modules: [], features: [],
        }} />
      </div>}
  </RootFrame>;
}
