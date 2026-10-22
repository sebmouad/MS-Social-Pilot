import type { PlatformModule } from '../module';
/** No customer activation until state, persistence, scope checks and journal host are integrated. */
export const threadsModule = {
  id: 'threads', name: 'Threads', description: 'Staged Threads adapter; customer connection and publishing remain unavailable.',
  mark: { text: 'TH', color: '#202020' }, health: { configuration: true, jobHistory: false, pendingQueues: [] },
  capabilities: { connection: 'unsupported', discovery: 'unsupported', publishing: 'unsupported', remoteStatus: 'unsupported', remoteDelete: 'unsupported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
  channelKinds: [], enabledKey: 'platforms.threads.enabled', access: { includedByDefaultKey: 'platforms.threads.includedByDefault', planFeaturesKey: 'platforms.threads.planFeatures' },
  requiredSettings: ['threads.appId', 'threads.appSecret'], settingsGroup: 'Threads',
} as const satisfies PlatformModule;
