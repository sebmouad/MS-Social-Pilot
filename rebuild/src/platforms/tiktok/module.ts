import type { PlatformModule } from '../module';

/** Installed host; switched off by default until the owner has created the TikTok developer app. */
export const tiktokModule = {
  id: 'tiktok', name: 'TikTok', description: 'TikTok accounts. Publish videos through the Content Posting API.',
  mark: { text: 'TT', color: '#010101' }, health: { configuration: true, jobHistory: false, pendingQueues: [] },
  capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'unsupported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
  channelKinds: [{ kind: 'tiktok', label: 'TikTok account' }], enabledKey: 'platforms.tiktok.enabled',
  access: { includedByDefaultKey: 'platforms.tiktok.includedByDefault', planFeaturesKey: 'platforms.tiktok.planFeatures' },
  requiredSettings: ['tiktok.clientKey', 'tiktok.clientSecret'], settingsGroup: 'TikTok',
} as const satisfies PlatformModule;
