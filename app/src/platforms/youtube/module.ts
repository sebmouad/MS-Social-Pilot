import type { PlatformModule } from '../module';

/** Installed host; switched off by default until the owner has created the Google OAuth client. */
export const youtubeModule = {
  id: 'youtube', name: 'YouTube', description: 'Channels managed by a Google account. Publish videos and delete them from the channel.',
  mark: { text: 'YT', color: '#ff0000' }, health: { configuration: true, jobHistory: false, pendingQueues: [] },
  capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'supported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
  channelKinds: [{ kind: 'youtube', label: 'YouTube channel' }], enabledKey: 'platforms.youtube.enabled',
  access: { includedByDefaultKey: 'platforms.youtube.includedByDefault', planFeaturesKey: 'platforms.youtube.planFeatures' },
  requiredSettings: ['youtube.clientId', 'youtube.clientSecret'], settingsGroup: 'YouTube',
} as const satisfies PlatformModule;
