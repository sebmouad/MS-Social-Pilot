import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/server/root/RootFrame';
import { moduleManifests } from '@/modules';
import { safeConfigShape } from '@/lib/config/registry';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Product modules · Root' };

export default async function RootModulesPage() {
  await requireRootPage();
  const definitions = safeConfigShape();
  return <RootFrame active="/root/modules">
    <header className="root-control__heading"><p className="root-config__eyebrow">Root · Product modules</p><h1>Product modules</h1><p>Manage each installed module's availability, feature controls and settings in its own section. Workspace permissions and plans still apply.</p></header>
    <div className="root-control__module-grid">{moduleManifests.map(module => <section className="root-control__panel" key={module.id}>
      <h2><a href={`/root/modules/${module.id}`}>{module.title}</a></h2>
      <p>{module.pages.length} registered {module.pages.length === 1 ? 'feature' : 'features'} · {definitions.filter(setting => setting.owner.kind === 'product' && setting.owner.id === module.id).length} controls</p>
      <ul>{module.pages.map(page => <li key={page.id}>{page.title}</li>)}</ul>
      <a className="ui-button ui-button--secondary ui-button--sm" href={`/root/modules/${module.id}`}>Manage {module.title}</a>
    </section>)}</div>
  </RootFrame>;
}
