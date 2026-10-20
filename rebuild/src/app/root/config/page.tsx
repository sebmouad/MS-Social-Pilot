import { requireRootPage } from '@/server/config/access';
import { readConfig } from '@/server/config/store';
import { safeConfigShape } from '@/lib/config/registry';
import { RootFrame } from '@/server/root/RootFrame';
import { RootConfigForm } from './root-config-form';

export const metadata = { title: 'Shared configuration · Root' };

export default async function RootConfigPage({ searchParams }: { searchParams?: Promise<{ search?: string | string[] }> } = {}) {
  // Root access is checked before rendering the shared shell. This route must
  // not depend on workspace membership: an installation owner may have none.
  await requireRootPage();
  const search = (await searchParams)?.search;
  const initialSearch = typeof search === 'string' ? search.slice(0, 2000) : '';
  const definitions = safeConfigShape().filter(setting => setting.owner.kind === 'shared');
  let values: Awaited<ReturnType<typeof readConfig>> | null = null;
  try { values = await readConfig(); } catch { /* Render a recoverable store state. */ }
  const keys = new Set(definitions.map(definition => definition.key));
  return <RootFrame active="/root/config">
    <div className="root-config">
      <header className="root-config__heading">
        <p className="root-config__eyebrow">Root · Installation</p>
        <h1>Shared configuration</h1>
        <p className="root-config__intro">Installation-wide infrastructure controls. Product and platform settings live in their module sections in the sidebar. Every setting is validated and states whether runtime paths consume it.</p>
      </header>
      {values === null ? <p role="alert" className="root-config__empty">Shared settings could not be loaded. Reload to try again.</p> : <RootConfigForm key={`shared:${initialSearch}`} initialSearch={initialSearch} definitions={definitions} initialValues={values.filter(value => keys.has(value.key))} availability={{ modules: [], features: [] }} />}
    </div>
  </RootFrame>;
}
