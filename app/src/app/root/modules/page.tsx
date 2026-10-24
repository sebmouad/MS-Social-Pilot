import { Badge } from '@/components/Badge';
import { ModuleGlyph } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { ModuleHealth } from './ModuleHealth';
import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/modules/root/ui/RootFrame';
import { moduleManifests } from '@/modules';
import { safeConfigShape } from '@/lib/config/registry';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Product modules · Root' };

export default async function RootModulesPage() {
  await requireRootPage();
  const definitions = safeConfigShape();
  return <RootFrame active="/root/modules">
    <PageHeader module="root" title="Product modules" description={<>Manage each installed module's availability, feature controls and settings in its own section. Workspace permissions and plans still apply.</>} />
    {await ModuleHealth({})}
    <div className="root-control__module-grid">{moduleManifests.map(module => <section className="root-control__panel" key={module.id}>
      <PageHeader level={2} module={module.id} title={module.title} />
      <p>{module.pages.length} registered {module.pages.length === 1 ? 'feature' : 'features'} · {definitions.filter(setting => setting.owner.kind === 'product' && setting.owner.id === module.id).length} controls</p>
      <ul className="root-control__capabilities">{module.pages.map(page => <li key={page.id}><Badge tone="module" module={module.id} icon={<ModuleGlyph id={module.id} size={14} />}>{page.title}</Badge></li>)}</ul>
      <a className="ui-button ui-button--secondary ui-button--sm" href={`/root/modules/${module.id}`}>Manage {module.title}</a>
    </section>)}</div>
  </RootFrame>;
}
