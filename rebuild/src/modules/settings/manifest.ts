import type { ModuleManifest } from '../types';

export const settingsManifest = {
  id: 'settings',
  jobs: [
    { name: 'purges', label: 'Data deletion recovery', configKey: 'data.purgeRecoverySchedule' },
    { name: 'notifications', label: 'Notification delivery', configKey: 'notifications.deliverySchedule' },
  ],
  rootSettingsPrefixes: ['settings.', 'connections.', 'mcp.keys.', 'notifications.'],
  rootSettingKeys: ['data.purgeRecoverySchedule', 'data.deleteTransactionTimeoutMs', 'data.maxArchiveBytes'],
  title: 'Settings',
  href: '/settings/connections',
  pages: [
    { id: 'settings/connections', title: 'Connections', href: '/settings/connections', description: 'Choose connected accounts and channels.' },
    { id: 'settings/team', title: 'Team', href: '/settings/team', description: 'Manage people and access.' },
    { id: 'settings/workspace', title: 'Workspace policies', href: '/settings/workspace', description: 'Set workspace time zone and contributor approval policy.' },
    { id: 'settings/mcp', title: 'MCP API keys', href: '/settings/mcp', description: 'Manage scoped workspace integration keys.' },
    { id: 'settings/account', title: 'Account', href: '/settings/account', description: 'Your profile and preferences.' },
    { id: 'settings/notifications', title: 'Notifications', href: '/settings/notifications', description: 'Choose your alerts and review notifications.' },
    { id: 'settings/data', title: 'Data and privacy', href: '/settings/data', description: 'Export or delete workspace data.' },
    { id: 'settings/appearance', title: 'Appearance', href: '/settings/appearance', description: 'Choose a comfortable theme.' },
  ],
} as const satisfies ModuleManifest;
