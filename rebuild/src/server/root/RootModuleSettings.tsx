import { ROOT_CONFIG_COPY, type RootConfigCopy } from '@/lib/config/root-config-copy';
import { RootDiagnostics } from './RootDiagnostics';
import { RootJobHealth } from '@/server/jobs/RootJobHealth';
import { readConfig } from '@/server/config/store';
import { safeConfigShape, AVAILABILITY_CATALOG } from '@/lib/config/registry';
import { RootFrame } from './RootFrame';
import { RootConfigForm } from '@/app/root/config/root-config-form';
import type { ReactNode } from 'react';
import { requireRootPage } from '@/server/config/access';

/** Module settings stay in the module's Root section; Root owns authorization and presentation. */
export async function RootModuleSettings({ kind, id, title, description, children, groupPrefix }: {
  kind: 'product' | 'platform'; id: string; title: string; description: string; children?: ReactNode; groupPrefix?: string;
}) {
  await requireRootPage();
  const definitions = safeConfigShape().filter(setting => setting.owner.kind === kind && setting.owner.id === id)
    .sort((a, b) => Number(!a.key.startsWith('entitlements.')) - Number(!b.key.startsWith('entitlements.')));
  let values: Awaited<ReturnType<typeof readConfig>> | null = null;
  try { values = await readConfig(); } catch { /* Keep the Root navigation available during a store outage. */ }
  const keys = new Set(definitions.map(definition => definition.key));
  return <RootFrame active={kind === 'product' ? `/root/modules/${id}` : `/root/platforms/${id}`}>
    <header className="root-control__heading"><p className="root-config__eyebrow">Root · {kind === 'product' ? 'Product modules' : 'Platform modules'}</p><h1>{title}</h1><p>{description}</p></header>
    {children}
    {await RootDiagnostics({ scope: `${kind}:${id}` })}
    {kind === 'product' ? await RootJobHealth({ moduleId: id }) : null}
    {values === null ? <section className="root-control__notice" role="alert"><h2>Module settings unavailable</h2><p>Settings could not be loaded. Reload this module to try again.</p></section> : <div className="root-config">
      <RootConfigForm key={`${kind}:${id}`} definitions={definitions} initialValues={values.filter(value => keys.has(value.key))} groupPrefix={groupPrefix} copy={(values.find(value => value.key === 'root.configCopy')?.value ?? ROOT_CONFIG_COPY) as RootConfigCopy} availability={{
        modules: AVAILABILITY_CATALOG.modules.filter(module => kind === 'product' && module.id === id),
        features: AVAILABILITY_CATALOG.features.filter(feature => kind === 'product' && feature.module === id),
      }} />
    </div>}
  </RootFrame>;
}
