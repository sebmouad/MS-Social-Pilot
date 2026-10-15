import { requireRootPage } from '@/server/config/access';
import { readConfig } from '@/server/config/store';
import { safeConfigShape, AVAILABILITY_CATALOG } from '@/lib/config/registry';
import { RootConfigForm } from './root-config-form';
import './root-config.css';

export const metadata = { title: 'Runtime configuration' };

export default async function RootConfigPage() {
  await requireRootPage();
  const [definitions, values] = [safeConfigShape(), await readConfig()];
  return <main className="root-config">
    <a className="root-config__back" href="/home">← Back to Social Pilot</a>
    <p className="root-config__eyebrow">Root · Installation</p>
    <h1>Runtime configuration</h1>
    <p className="root-config__intro">Operational settings are validated against a versioned registry. Each option states whether rebuilt runtime paths consume it yet.</p>
    <RootConfigForm definitions={definitions} initialValues={values} availability={AVAILABILITY_CATALOG} />
  </main>;
}
