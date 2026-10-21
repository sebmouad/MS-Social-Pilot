import type { PlatformModule } from '../module';
/** Staged manifest. Do not add to PLATFORM_MODULES before the shared host registration and connection persistence land. */
export const instagramModule = {
  id: 'instagram', name: 'Instagram', description: 'Professional accounts linked to selected Pages. Adapter fixtures only; customer activation pending.',
  mark: { text: 'IG', color: '#c13584' }, health: { configuration: true, jobHistory: false, pendingQueues: [] },
  capabilities: { connection: 'unsupported', discovery: 'unsupported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'unsupported', inbox: 'supported', analytics: 'unsupported', ads: 'unsupported' },
  channelKinds: [{ kind: 'professional', label: 'Instagram' }], enabledKey: 'platforms.instagram.enabled',
  access: { includedByDefaultKey: 'platforms.instagram.includedByDefault', planFeaturesKey: 'platforms.instagram.planFeatures' },
  requiredSettings: ['instagram.appSecret'], settingsGroup: 'Instagram',
} as const satisfies PlatformModule;
