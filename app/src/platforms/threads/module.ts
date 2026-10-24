import type { PlatformModule } from '../module';
/** No customer activation until state, persistence, scope checks and journal host are integrated. */
export const threadsModule = {
  id: 'threads', name: 'Threads', description: 'Connect Threads accounts and publish posts.',
  mark: { text: 'TH', color: '#202020' }, health: { configuration: true, jobHistory: true, pendingQueues: [] },
  capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'unsupported', remoteDelete: 'unsupported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
  channelKinds: [{ kind: 'threads', label: 'Threads account' }], enabledKey: 'platforms.threads.enabled', access: { includedByDefaultKey: 'platforms.threads.includedByDefault', planFeaturesKey: 'platforms.threads.planFeatures' },
  requiredSettings: ['threads.appId', 'threads.appSecret'], settingsGroup: 'Threads',
} as const satisfies PlatformModule;
