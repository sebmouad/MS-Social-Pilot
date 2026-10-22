import type { PlatformModule } from '../module';

/** Installed host; switched off by default until the owner verifies it live. Text posts only. */
export const blueskyModule = {
  id: 'bluesky', name: 'Bluesky', description: 'Bluesky accounts connected with an app password. Publish text posts.',
  mark: { text: 'Bs', color: '#0085ff' }, health: { configuration: true, jobHistory: false, pendingQueues: [] },
  capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'unsupported', remoteDelete: 'unsupported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
  channelKinds: [{ kind: 'bluesky', label: 'Bluesky account' }], enabledKey: 'platforms.bluesky.enabled',
  access: { includedByDefaultKey: 'platforms.bluesky.includedByDefault', planFeaturesKey: 'platforms.bluesky.planFeatures' },
  requiredSettings: ['bluesky.policy'], settingsGroup: 'Bluesky',
} as const satisfies PlatformModule;
