import type { PlatformModule } from '../module';
export const mastodonModule = {
  id: 'mastodon', name: 'Mastodon', description: 'Independent Mastodon server accounts. Integration pending.',
  mark: { text: 'M', color: '#6364ff' }, health: { configuration: true, jobHistory: false, pendingQueues: [] },
  capabilities: { connection: 'unsupported', discovery: 'unsupported', publishing: 'unsupported', remoteStatus: 'unsupported', remoteDelete: 'unsupported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
  channelKinds: [], enabledKey: 'platforms.mastodon.enabled', access: { includedByDefaultKey: 'platforms.mastodon.includedByDefault', planFeaturesKey: 'platforms.mastodon.planFeatures' }, requiredSettings: [], settingsGroup: 'Mastodon',
} as const satisfies PlatformModule;
