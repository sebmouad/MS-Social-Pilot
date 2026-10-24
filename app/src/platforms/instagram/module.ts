import type { PlatformModule } from '../module';
/** Installed host; remains disabled by default pending live-provider verification. */
export const instagramModule = {
  id: 'instagram', name: 'Instagram', description: 'Professional accounts linked to selected Pages. Publishing, comments and performance.',
  mark: { text: 'IG', color: '#c13584' }, health: { configuration: true, jobHistory: false, pendingQueues: [] },
  capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'unsupported', inbox: 'supported', analytics: 'supported', ads: 'unsupported' },
  channelKinds: [{ kind: 'instagram', label: 'Instagram' }], enabledKey: 'platforms.instagram.enabled',
  access: { includedByDefaultKey: 'platforms.instagram.includedByDefault', planFeaturesKey: 'platforms.instagram.planFeatures' },
  requiredSettings: ['instagram.appSecret'], settingsGroup: 'Instagram',
} as const satisfies PlatformModule;
