import { requireRootPage } from '@/server/config/access';
import { readConfig, runtimeConfig } from '@/server/config/store';
import { AVAILABILITY_CATALOG, CONFIG_BY_KEY, safeConfigShape } from '@/lib/config/registry';
import { ROOT_CONFIG_COPY, type RootConfigCopy } from '@/lib/config/root-config-copy';
import { RootFrame } from '@/server/root/RootFrame';
import { RootConfigForm } from './root-config-form';

export async function generateMetadata() {
  await requireRootPage();
  const copy = await runtimeConfig('root.configCopy').catch(() => ROOT_CONFIG_COPY);
  return { title: copy.metadataTitle };
}

export default async function RootConfigPage({ searchParams }: { searchParams: Promise<{ search?: string | string[] }> }) {
  await requireRootPage();
  // readConfig validates the same registry snapshot used by HTTP and MCP and masks secrets.
  // Registry defaults keep the recovery screen available if the store cannot be read.
  let values: Awaited<ReturnType<typeof readConfig>> | null = null;
  try { values = await readConfig(); } catch { /* Render a recoverable store state. */ }
  const copy = (values?.find(value => value.key === 'root.configCopy')?.value ?? ROOT_CONFIG_COPY) as RootConfigCopy;
  const searchLimit = Number(values?.find(value => value.key === 'root.configSearchMaxCharacters')?.value ?? CONFIG_BY_KEY.get('root.configSearchMaxCharacters')!.defaultValue);
  const search = (await searchParams)?.search;
  const initialSearch = typeof search === 'string' ? search.slice(0, searchLimit) : '';
  return <RootFrame active="/root/config">
    <div className="root-config">
      <header className="root-config__heading">
        <p className="root-config__eyebrow">{copy.eyebrow}</p>
        <h1>{copy.pageTitle}</h1>
        <p className="root-config__intro">{copy.intro}</p>
      </header>
      {values === null ? <p role="alert" className="root-config__empty">{copy.unavailable}</p> : <RootConfigForm key={`all:${initialSearch}`} initialSearch={initialSearch} definitions={safeConfigShape()} initialValues={values} availability={AVAILABILITY_CATALOG} groupByOwner copy={copy} />}
    </div>
  </RootFrame>;
}
