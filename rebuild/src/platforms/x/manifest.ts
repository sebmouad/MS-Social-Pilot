import type { PlatformModule } from '../module';
export const xModule = {
  id: 'x', name: 'X', description: 'Staged X protocol adapter; shared connection host integration remains required.', mark: { text: 'X', color: '#14171a' },
  health: { configuration: true, jobHistory: false, pendingQueues: [] },
  capabilities: { connection: 'unsupported', discovery: 'unsupported', publishing: 'unsupported', remoteStatus: 'unsupported', remoteDelete: 'unsupported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
  channelKinds: [{ kind: 'x', label: 'X' }], enabledKey: 'platforms.x.enabled', access: { includedByDefaultKey: 'platforms.x.includedByDefault', planFeaturesKey: 'platforms.x.planFeatures' },
  requiredSettings: ['x.clientId', 'x.clientSecret'], settingsGroup: 'X',
} as const satisfies PlatformModule;
