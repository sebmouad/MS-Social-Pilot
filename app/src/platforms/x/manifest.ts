import type { PlatformModule } from '../module';
export const xModule = {
  id: 'x', name: 'X', description: 'Connect X accounts and publish posts.', mark: { text: 'X', color: '#14171a' },
  health: { configuration: true, jobHistory: true, pendingQueues: [] },
  capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'supported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
  channelKinds: [{ kind: 'x', label: 'X' }], enabledKey: 'platforms.x.enabled', access: { includedByDefaultKey: 'platforms.x.includedByDefault', planFeaturesKey: 'platforms.x.planFeatures' },
  requiredSettings: ['x.clientId', 'x.clientSecret'], settingsGroup: 'X',
} as const satisfies PlatformModule;
