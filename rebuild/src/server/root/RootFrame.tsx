import type { ReactNode } from 'react';
import { AppShell } from '@/components';
import { requireRootPage } from '@/server/config/access';
import './root-directory.css';

const sections = [
  { href: '/root/users', title: 'Users' },
  { href: '/root/workspaces', title: 'Workspaces' },
  { href: '/root/config', title: 'Runtime configuration' },
] as const;

export async function RootFrame({ active, children }: { active: string; children: ReactNode }) {
  const actor = await requireRootPage();
  const sidebar = <nav className="root-directory-nav" aria-label="Root sections"><p className="shell-subnav__label">Installation</p>
    {sections.map(section => <a key={section.href} href={section.href} aria-current={active === section.href ? 'page' : undefined} className={active === section.href ? 'is-active' : undefined}>{section.title}</a>)}
  </nav>;
  return <AppShell activeModule="settings" enabledModules={[]} enabledFeatures={[]} rootAccess installationMode userName={actor.name} workspaceName="Installation" sidebar={sidebar}>
    <div className="root-directory">{children}</div>
  </AppShell>;
}
