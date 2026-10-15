import { requireRootPage } from '@/server/config/access';
import { readConfig } from '@/server/config/store';
import { safeConfigShape, AVAILABILITY_CATALOG } from '@/lib/config/registry';
import { RootFrame } from '@/server/root/RootFrame';
import { RootConfigForm } from './root-config-form';
import { RootJobHealth } from '@/server/jobs/RootJobHealth';
import './root-config.css';

export const metadata = { title: 'Runtime configuration' };

export default async function RootConfigPage() {
  // Root access is checked before rendering the shared shell. This route must
  // not depend on workspace membership: an installation owner may have none.
  await requireRootPage();
  const [definitions, values] = [safeConfigShape(), await readConfig()];
  return <RootFrame active="/root/config">
    <div className="root-config">
      <header className="root-config__heading">
        <p className="root-config__eyebrow">Root · Installation</p>
        <h1>Runtime configuration</h1>
        <p className="root-config__intro">Operational settings are validated against a versioned registry. Each option states whether rebuilt runtime paths consume it yet.</p>
      </header>
      <RootConfigForm definitions={definitions} initialValues={values} availability={AVAILABILITY_CATALOG} />
      <RootJobHealth />
    </div>
  </RootFrame>;
}
