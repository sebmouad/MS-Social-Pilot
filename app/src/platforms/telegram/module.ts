import type { PlatformModule } from '../module';

/** Installed host; switched off by default until the owner verifies it live. Text messages to a channel only. */
export const telegramModule = {
  id: 'telegram', name: 'Telegram', description: 'Telegram channels connected with a bot token. Publish text messages.',
  mark: { text: 'Tg', color: '#229ed9' }, health: { configuration: true, jobHistory: false, pendingQueues: [] },
  capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'unsupported', remoteDelete: 'unsupported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
  channelKinds: [{ kind: 'telegram', label: 'Telegram channel' }], enabledKey: 'platforms.telegram.enabled',
  access: { includedByDefaultKey: 'platforms.telegram.includedByDefault', planFeaturesKey: 'platforms.telegram.planFeatures' },
  requiredSettings: ['telegram.policy'], settingsGroup: 'Telegram',
} as const satisfies PlatformModule;
