vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ host: vi.fn(), providers: vi.fn(), policy: vi.fn() }));
vi.mock('../src/server/platforms/registry', () => ({ platformInbox: state.host, inboxPlatformIds: state.providers, platformFor: vi.fn() }));
import { inboxReplyPolicy } from '@/modules/inbox/server/policy';
import { inboxTargetWhere } from '@/modules/inbox/server/providers';

const request = { kind: 'message' as const, channelRemoteId: 'example-channel', lastInbound: null, timeZone: 'UTC' };
beforeEach(() => { vi.resetAllMocks(); state.host.mockResolvedValue({ replyPolicy: state.policy }); state.providers.mockResolvedValue(['facebook']); });

describe('provider-owned Inbox policy', () => {
  it('renders the selected module policy without assuming a network or reply window', async () => {
    const policy = { allowed: false, headline: 'Reply through the example channel portal.', detail: 'This provider handles replies in its portal.' };
    state.policy.mockResolvedValue(policy);
    expect(await inboxReplyPolicy('example-provider', request)).toEqual(policy);
    expect(state.host).toHaveBeenCalledWith('example-provider');
    expect(state.policy).toHaveBeenCalledWith(request);
  });
  it('denies replying when the module is unavailable', async () => {
    state.host.mockResolvedValue(null);
    expect((await inboxReplyPolicy('disabled-provider', request)).allowed).toBe(false);
    expect(state.policy).not.toHaveBeenCalled();
  });
  it('denies missing providers without invoking a host', async () => {
    expect((await inboxReplyPolicy(null, request)).allowed).toBe(false);
    expect(state.host).not.toHaveBeenCalled();
  });
});

describe('shared Inbox selection query', () => {
  it('requires selected resources, the same workspace, usable connections and supported modules', async () => {
    expect(await inboxTargetWhere('workspace-a', ['channel-allowed'])).toEqual({
      workspaceId: 'workspace-a', enabled: true, type: { in: ['page'] }, id: { in: ['channel-allowed'] },
      socialAccount: { is: { workspaceId: 'workspace-a', invalidatedAt: null, provider: { in: ['facebook'] } } },
    });
  });
  it('keeps disabled modules and empty resource grants as empty predicates', async () => {
    state.providers.mockResolvedValue([]);
    expect(await inboxTargetWhere('workspace-a', [])).toMatchObject({ type: { in: [] }, id: { in: [] }, socialAccount: { is: { provider: { in: [] } } } });
  });
});
