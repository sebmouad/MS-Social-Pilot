import type { PlatformModule } from '../module';
export const mastodonModule = {
  id: 'mastodon', name: 'Mastodon', description: 'Mastodon accounts on the configured server.',
  mark: { text: 'M', color: '#6364ff' }, health: { configuration: true, jobHistory: false, pendingQueues: [] },
  capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'supported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
  channelKinds: [{ kind: 'mastodon', label: 'Mastodon account' }], enabledKey: 'platforms.mastodon.enabled', access: { includedByDefaultKey: 'platforms.mastodon.includedByDefault', planFeaturesKey: 'platforms.mastodon.planFeatures' }, requiredSettings: ['mastodon.instanceUrl', 'mastodon.clientId', 'mastodon.clientSecret'], settingsGroup: 'Mastodon',
} as const satisfies PlatformModule;
