import type { ModuleManifest } from '../types';
import { INTEGRATIONS_JOBS, INTEGRATIONS_PAGES, INTEGRATIONS_ROOT_PREFIX } from '../integrations/manifest';
import { HISTORY_PAGES, HISTORY_ROOT_PREFIX } from '../history/manifest';

export const settingsManifest = {
  id: 'settings',
  area: 'settings',
  health: { configuration: true, jobHistory: true, pendingQueues: ['workspaceExports'] },
  jobs: [
    { name: 'workspaceExports', label: 'Workspace ZIP exports', configKey: 'data.exportSchedule' },
    { name: 'purges', label: 'Data deletion recovery', configKey: 'data.purgeRecoverySchedule' },
    { name: 'notifications', label: 'Notification delivery', configKey: 'notifications.deliverySchedule' },
    { name: 'retention', label: 'Old-records pruning', configKey: 'retention.schedule' },
    { name: 'sharingDeadlines', label: 'Share-link client deadlines', configKey: 'sharing.deadlineSchedule' },
    ...INTEGRATIONS_JOBS,
  ],
  rootSettingsPrefixes: ['settings.', 'connections.', 'mcp.keys.', 'mcp.personKeys.', 'notifications.', 'sharing.', 'bio.', INTEGRATIONS_ROOT_PREFIX, HISTORY_ROOT_PREFIX],
  rootSettingKeys: ['data.exportMaxJobs', 'data.exportExpiryHours', 'data.exportWorkerBatch', 'data.exportLeaseSeconds', 'data.exportSchedule', 'data.purgeRecoverySchedule', 'data.deleteTransactionTimeoutMs', 'data.maxArchiveBytes'],
  title: 'Settings',
  href: '/settings/workspace',
  /**
   * Design v2 B6: Settings is seven sections (the in-content list); Groups, Link in bio, Webhooks, API keys, Security,
   * Appearance and Notifications are tabs inside a section. Old routes stay valid as 308 redirects.
   */
  redirects: [
    { from: '/settings/connections', to: '/settings/channels' },
    { from: '/settings/profiles', to: '/settings/channels/groups' },
    { from: '/settings/bio', to: '/settings/sharing/bio' },
    { from: '/settings/mcp', to: '/settings/integrations' },
    { from: '/settings/webhooks', to: '/settings/integrations/webhooks' },
    { from: '/settings/appearance', to: '/settings/account/appearance' },
    { from: '/settings/notifications/*', to: '/settings/account/notifications/*' },
  ],
  pages: [
    { id: 'settings/workspace', title: 'Workspace', href: '/settings/workspace', description: 'Name, time zone, approvals, posting hours and defaults.', tabOrder: 1 },
    { id: 'settings/connections', title: 'Channels', href: '/settings/channels', description: 'Choose connected accounts and channels.', tabOrder: 2 },
    { id: 'settings/team', title: 'Team', href: '/settings/team', description: 'Manage people and access.', tabOrder: 3 },
    { id: 'settings/sharing', title: 'Sharing', href: '/settings/sharing', description: 'Share selected content and manage client reviews.', tabOrder: 4 },
    { id: 'settings/bio', title: 'Link in bio', href: '/settings/sharing/bio', description: 'Manage your public profile and links.', navigation: false, palette: true },
    { id: 'settings/mcp', title: 'Integrations', href: '/settings/integrations', description: 'Manage AI assistants, API keys and webhooks.', tabOrder: 5 },
    ...INTEGRATIONS_PAGES,
    { id: 'settings/account', title: 'Account', href: '/settings/account', description: 'Your profile and preferences.', tabOrder: 6 },
    { id: 'settings/notifications', title: 'Notifications', href: '/settings/account/notifications', description: 'Choose your alerts and review notifications.', navigation: false, palette: true },
    { id: 'settings/data', title: 'Data and privacy', href: '/settings/data', description: 'Export or delete workspace data.', tabOrder: 7 },
    ...HISTORY_PAGES,
    { id: 'settings/appearance', title: 'Appearance', href: '/settings/account/appearance', description: 'Choose a comfortable theme.', navigation: false, palette: true },
  ],
} as const satisfies ModuleManifest;
