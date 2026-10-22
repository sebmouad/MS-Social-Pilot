import type { PlatformModule } from '../module';
export const pinterestModule = {
  id: 'pinterest', name: 'Pinterest', description: 'Boards and image Pins.',
  mark: { text: 'P', color: '#bd081c' },
  health: { configuration: true, jobHistory: true, pendingQueues: [] },
  capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'supported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
  channelKinds: [{ kind: 'pinterest', label: 'Pinterest' }], enabledKey: 'platforms.pinterest.enabled',
  access: { includedByDefaultKey: 'platforms.pinterest.includedByDefault', planFeaturesKey: 'platforms.pinterest.planFeatures' },
  requiredSettings: ['pinterest.clientId', 'pinterest.clientSecret'], settingsGroup: 'Pinterest',
} as const satisfies PlatformModule;
