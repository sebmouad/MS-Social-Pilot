import { moduleManifests } from '@/modules';
import { PLATFORM_MODULES } from '@/platforms';

/** Root administers modules; it is intentionally not a customer module. */
export const rootManifest = {
  id: 'root',
  title: 'Root',
  sections: [
    { title: 'Shared controls', pages: [
      { title: 'Overview', href: '/root' },
      { title: 'Users', href: '/root/users' },
      { title: 'Registration / Invitations', href: '/root/registration' },
      { title: 'Workspaces', href: '/root/workspaces' },
      { title: 'Plans', href: '/root/plans' },
      { title: 'Privileges', href: '/root/privileges' },
      { title: 'Access lifecycle', href: '/root/lifecycle' },
      { title: 'Sessions', href: '/root/sessions' },
      { title: 'Connections', href: '/root/connections' },
      { title: 'Errors', href: '/root/errors' },
      { title: 'Backup records', href: '/root/backups' },
      { title: 'Operations', href: '/root/operations' },
      { title: 'Activity', href: '/root/activity' },
      { title: 'Shared configuration', href: '/root/config' },
    ] },
    { title: 'Product modules', pages: [
      { title: 'All product modules', href: '/root/modules' },
      ...moduleManifests.map(module => ({ title: module.title, href: `/root/modules/${module.id}` })),
    ] },
    { title: 'Platform modules', pages: [
      { title: 'All platform modules', href: '/root/platforms' },
      ...PLATFORM_MODULES.map(module => ({ title: module.name, href: `/root/platforms/${module.id}` })),
    ] },
  ],
} as const;
