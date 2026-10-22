import { headers } from 'next/headers';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_INTERFACE_COPY } from '@/lib/config/root-interface-copy';
import { rootCopyLocale } from '@/modules/root/server/admin/copy';
import { RootInterfaceProvider } from './RootInterface';
import type { ReactNode } from 'react';
import { AppShell } from '@/components';
import { requireRootPage } from '@/server/config/access';
import { shellChrome } from '@/modules/shell/server/chrome';
import { rootAreas, rootActiveHref } from './root-areas';
import { RootPageGlyph } from './RootNavIcons';
import './root-directory.css';
import '../../../app/root/root-control-center.css';
import '../../../app/root/root-nav.css';
import '../../../app/root/config/root-config.css';

export async function RootFrame({ active, children, controls }: { active: string; children: ReactNode; controls?: ReactNode }) {
  const actor = await requireRootPage();
  const locale = rootCopyLocale((await headers()).get('accept-language'));
  const catalog = await runtimeConfig('root.interfaceCopy').catch(() => ROOT_INTERFACE_COPY);
  const copy = catalog[locale];
  const current = rootActiveHref(active);
  const areas = rootAreas({ overview: copy.areaOverview, people: copy.areaPeople, modules: copy.areaModules, operations: copy.areaOperations, activity: copy.areaActivity });
  const sidebar = <nav className="root-directory-nav" aria-label={copy.areasLabel}>
    {areas.map(area => { const AreaIcon = area.icon; return <details key={area.id} open={area.pages.some(page => current === page.href)}>
      <summary><span className="root-nav-glyph" aria-hidden="true"><AreaIcon size={17} stroke={1.75} /></span>{area.label}</summary>
      {area.pages.map(page => <a key={page.href} href={page.href} aria-current={current === page.href ? 'page' : undefined} className={current === page.href ? 'is-active' : undefined}><span className="root-nav-glyph"><RootPageGlyph href={page.href} /></span>{page.title}</a>)}
    </details>; })}
  </nav>;
  const { copy: shellChromeCopy, policy } = await shellChrome();
  return <RootInterfaceProvider copy={copy}><AppShell activeModule="settings" enabledModules={[]} enabledFeatures={[]} rootAccess installationMode copy={shellChromeCopy} policy={policy} userName={actor.name} workspaceName={shellChromeCopy.installation} sidebar={<>{sidebar}{controls}</>}>
    <div className="root-directory">{children}</div>
  </AppShell></RootInterfaceProvider>;
}
