import { headers } from 'next/headers';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_INTERFACE_COPY } from '@/lib/config/root-interface-copy';
import { rootCopyLocale } from '@/modules/root/server/admin/copy';
import { RootInterfaceProvider } from './RootInterface';
import type { ReactNode } from 'react';
import { AppShell } from '@/components';
import { requireRootPage } from '@/server/config/access';
import { rootManifest } from '@/modules/root/manifest';
import { RootPageGlyph } from '../../app/root/root-nav-icons';
import './root-directory.css';
import '../../app/root/root-control-center.css';
import '../../app/root/root-nav.css';
import '../../app/root/config/root-config.css';

export async function RootFrame({ active, children, controls }: { active: string; children: ReactNode; controls?: ReactNode }) {
  const actor = await requireRootPage();
  const locale = rootCopyLocale((await headers()).get('accept-language'));
  const catalog = await runtimeConfig('root.interfaceCopy').catch(() => ROOT_INTERFACE_COPY);
  const sidebar = <nav className="root-directory-nav" aria-label="Root sections">
    {rootManifest.sections.map(section => <details key={section.title} open={section.pages.some(page => active === page.href)}>
      <summary>{section.title}</summary>
      {section.pages.map(page => <a key={page.href} href={page.href} aria-current={active === page.href ? 'page' : undefined} className={active === page.href ? 'is-active' : undefined}><span className="root-nav-glyph"><RootPageGlyph href={page.href} /></span>{page.title}</a>)}
    </details>)}
  </nav>;
  return <RootInterfaceProvider copy={catalog[locale]}><AppShell activeModule="settings" enabledModules={[]} enabledFeatures={[]} rootAccess installationMode userName={actor.name} workspaceName="Installation" sidebar={<>{sidebar}{controls}</>}>
    <div className="root-directory">{children}</div>
  </AppShell></RootInterfaceProvider>;
}
