/**
 * Developer integrations are a feature of the Settings product module: webhooks are managed by workspace owners and
 * admins next to the MCP API keys. Settings' manifest spreads these declarations so the module owns its navigation
 * entry, its worker job and its Root setting keys; there is no separate module id.
 */
export const WEBHOOKS_FEATURE_ID = 'settings/webhooks' as const;

export const INTEGRATIONS_PAGES = [
  { id: WEBHOOKS_FEATURE_ID, title: 'Webhooks', href: '/settings/webhooks', description: 'Send signed events to Zapier, Make or your own server.' },
] as const;

export const INTEGRATIONS_JOBS = [
  { name: 'webhooks', label: 'Webhook delivery', configKey: 'integrations.webhooks.deliverySchedule' },
] as const;

export const INTEGRATIONS_ROOT_PREFIX = 'integrations.' as const;
