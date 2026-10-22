/** Compose into Settings; no separate product permission or provider coupling. */
export const CHAT_CHANNELS_FEATURE = 'settings/notifications' as const;
export const CHAT_CHANNELS_PAGE = { id: CHAT_CHANNELS_FEATURE, href: '/settings/account/notifications/chat-channels', title: 'Team chat alerts' } as const;
