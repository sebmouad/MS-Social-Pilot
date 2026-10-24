import type { PlatformModule } from '../module';
export const linkedinModule = {
  id: 'linkedin', name: 'LinkedIn', description: 'Member feeds and administered company Pages.',
  mark: { text: 'in', color: '#0a66c2' },
  health: { configuration: true, jobHistory: true, pendingQueues: [] },
  capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'unsupported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
  channelKinds: [{ kind: 'linkedin', label: 'LinkedIn' }], enabledKey: 'platforms.linkedin.enabled',
  access: { includedByDefaultKey: 'platforms.linkedin.includedByDefault', planFeaturesKey: 'platforms.linkedin.planFeatures' },
  requiredSettings: ['linkedin.clientId', 'linkedin.clientSecret'], settingsGroup: 'LinkedIn',
} as const satisfies PlatformModule;
