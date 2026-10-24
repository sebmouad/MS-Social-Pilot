/** Tabs inside one Settings section (design v2 S13). Labels come from the Root catalog `settings.sectionsCopy`. */
export const SECTION_TABS = {
  channels: [{ key: 'channelsAccounts', href: '/settings/channels' }, { key: 'channelsGroups', href: '/settings/channels/groups' }],
  sharing: [{ key: 'sharingLinks', href: '/settings/sharing' }, { key: 'sharingBio', href: '/settings/sharing/bio' }],
  integrations: [{ key: 'integrationsAssistants', href: '/settings/integrations' }, { key: 'integrationsKeys', href: '/settings/integrations/keys' }, { key: 'integrationsWebhooks', href: '/settings/integrations/webhooks' }],
  account: [{ key: 'accountProfile', href: '/settings/account' }, { key: 'accountSecurity', href: '/settings/account/security' }, { key: 'accountAppearance', href: '/settings/account/appearance' }, { key: 'accountNotifications', href: '/settings/account/notifications' }],
} as const;
export type SectionTabKey = (typeof SECTION_TABS)[keyof typeof SECTION_TABS][number]['key'];
export const sectionOf = (tab: SectionTabKey): keyof typeof SECTION_TABS => (Object.keys(SECTION_TABS) as Array<keyof typeof SECTION_TABS>).find(section => SECTION_TABS[section].some(item => item.key === tab))!;
