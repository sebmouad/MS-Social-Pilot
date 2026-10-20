import type { ModuleManifest } from '../types';
import { INTEGRATIONS_JOBS, INTEGRATIONS_PAGES, INTEGRATIONS_ROOT_PREFIX } from '../integrations/manifest';

export const settingsManifest = {
  id: 'settings',
  jobs: [
    { name: 'workspaceExports', label: 'Workspace ZIP exports', configKey: 'data.exportSchedule' },
    { name: 'purges', label: 'Data deletion recovery', configKey: 'data.purgeRecoverySchedule' },
    { name: 'notifications', label: 'Notification delivery', configKey: 'notifications.deliverySchedule' },
    ...INTEGRATIONS_JOBS,
  ],
  rootSettingsPrefixes: ['settings.', 'connections.', 'mcp.keys.', 'notifications.', 'sharing.', 'bio.', INTEGRATIONS_ROOT_PREFIX],
  rootSettingKeys: ['data.exportMaxJobs', 'data.exportExpiryHours', 'data.exportWorkerBatch', 'data.exportLeaseSeconds', 'data.exportSchedule', 'data.purgeRecoverySchedule', 'data.deleteTransactionTimeoutMs', 'data.maxArchiveBytes'],
  title: 'Settings',
  href: '/settings/connections',
  pages: [
    { id: 'settings/connections', title: 'Connections', href: '/settings/connections', description: 'Choose connected accounts and channels.' },
    { id: 'settings/team', title: 'Team', href: '/settings/team', description: 'Manage people and access.' },
    { id: 'settings/workspace', title: 'Workspace policies', href: '/settings/workspace', description: 'Set workspace time zone and contributor approval policy.' },
    { id: 'settings/sharing', title: 'Client links', href: '/settings/sharing', description: 'Share selected content and manage client reviews.' },
    { id: 'settings/bio', title: 'Link in bio', href: '/settings/bio', description: 'Manage your public profile and links.' },
    { id: 'settings/mcp', title: 'MCP API keys', href: '/settings/mcp', description: 'Manage scoped workspace integration keys.' },
    ...INTEGRATIONS_PAGES,
    { id: 'settings/account', title: 'Account', href: '/settings/account', description: 'Your profile and preferences.' },
    { id: 'settings/notifications', title: 'Notifications', href: '/settings/notifications', description: 'Choose your alerts and review notifications.' },
    { id: 'settings/data', title: 'Data and privacy', href: '/settings/data', description: 'Export or delete workspace data.' },
    { id: 'settings/appearance', title: 'Appearance', href: '/settings/appearance', description: 'Choose a comfortable theme.' },
  ],
} as const satisfies ModuleManifest;
