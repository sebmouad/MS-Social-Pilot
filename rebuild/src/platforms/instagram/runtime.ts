import { assertInstagramSource } from './source-binding';
import { instagramContainerJournal } from './container-journal';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { instagramPolicySchema } from './config';
import { createInstagramAdapter, createInstagramCollector } from './adapter';
export async function configuredInstagramPolicy() {
  return instagramPolicySchema.parse(await runtimeConfig('instagram.policy'));
}
export async function configuredInstagramAdapter(locale: 'en' | 'fr' = 'en', signal?: AbortSignal) {
  const [policy, appSecret] = await Promise.all([configuredInstagramPolicy(), runtimeSecret('instagram.appSecret')]);
  const adapter = createInstagramAdapter(policy, { locale, journalFactory: instagramContainerJournal, ...(signal ? { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }) } : {}), ...(appSecret ? { appSecret } : {}) });
  const check = (accessToken: string, remoteTargetId?: string, requiredScopes = policy.readScopes, publication?: import('@/platforms/types').PublishRequest['publication']) => assertInstagramSource({ accessToken, remoteTargetId, requiredScopes, workspaceId: publication?.workspaceId, targetId: publication?.targetId });
  return {
    ...adapter,
    publish: async (request: import('@/platforms/types').PublishRequest) => { await check(request.credential.accessToken, request.target.id, policy.publishScopes, request.publication); return adapter.publish!(request); },
    publishFirstComment: async (request: import('@/platforms/types').FirstCommentRequest) => { await check(request.credential.accessToken, undefined, policy.commentScopes); return adapter.publishFirstComment!(request); },
    getRemoteStatus: async (request: import('@/platforms/types').RemoteStatusRequest) => { await check(request.credential.accessToken, request.target.id); return adapter.getRemoteStatus!(request); },
    listComments: async (request: import('@/platforms/types').InboxCommentsRequest) => { await check(request.credential.accessToken, request.targetId, policy.commentScopes); return adapter.listComments!(request); },
    listInbox: async (request: import('@/platforms/types').InboxRequest) => { await check(request.credential.accessToken, request.targetId, policy.commentScopes); return adapter.listInbox!(request); },
    replyToInbox: async (request: import('@/platforms/types').InboxActionRequest) => { await check(request.credential.accessToken, request.targetId, policy.commentScopes); return adapter.replyToInbox!(request); },
    hideInboxItem: async (request: import('@/platforms/types').InboxActionRequest & { hidden: boolean }) => { await check(request.credential.accessToken, request.targetId, policy.commentScopes); return adapter.hideInboxItem!(request); },
    deleteInboxItem: async (request: import('@/platforms/types').InboxActionRequest) => { await check(request.credential.accessToken, request.targetId, policy.commentScopes); return adapter.deleteInboxItem!(request); },
  };
}
export async function configuredInstagramCollector(signal?: AbortSignal) {
  const [policy, appSecret] = await Promise.all([configuredInstagramPolicy(), runtimeSecret('instagram.appSecret')]);
  const collector = createInstagramCollector(policy, { ...(signal ? { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }) } : {}), ...(appSecret ? { appSecret } : {}) });
  return {
    profile: async (...args: Parameters<typeof collector.profile>) => { await assertInstagramSource({ accessToken: args[0].accessToken, remoteTargetId: args[1], requiredScopes: policy.readScopes }); return collector.profile(...args); },
    account: async (...args: Parameters<typeof collector.account>) => { await assertInstagramSource({ accessToken: args[0].credential.accessToken, remoteTargetId: args[0].targetId, requiredScopes: policy.insightScopes }); return collector.account(...args); },
    post: async (...args: Parameters<typeof collector.post>) => { await assertInstagramSource({ accessToken: args[0].accessToken, requiredScopes: policy.insightScopes }); return collector.post(...args); },
    media: async (...args: Parameters<typeof collector.media>) => { await assertInstagramSource({ accessToken: args[0].accessToken, remoteTargetId: args[1], requiredScopes: policy.insightScopes }); return collector.media(...args); },
  };
}

/** Credentials returned here are server-only and must be encrypted by connection persistence. */
export async function configuredInstagramDiscovery() {
  const { createSelectedInstagramDiscovery } = await import('./discovery');
  const [policy, appSecret] = await Promise.all([configuredInstagramPolicy(), runtimeSecret('instagram.appSecret')]);
  return createSelectedInstagramDiscovery(policy, { ...(appSecret ? { appSecret } : {}) });
}
