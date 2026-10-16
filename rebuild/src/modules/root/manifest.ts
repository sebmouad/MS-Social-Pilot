/** Private installation tools. This is intentionally not registered as a customer module. */
export const rootManifest = {
  id: 'root',
  title: 'Root',
  sections: [
    { title: 'Control center', pages: [
      { title: 'Overview', href: '/root' },
      { title: 'Operations', href: '/root/operations' },
      { title: 'Activity', href: '/root/activity' },
    ] },
    { title: 'Installation', pages: [
      { title: 'Users', href: '/root/users' },
      { title: 'Workspaces', href: '/root/workspaces' },
      { title: 'Platforms', href: '/root/platforms' },
      { title: 'Runtime configuration', href: '/root/config' },
    ] },
  ],
} as const;
