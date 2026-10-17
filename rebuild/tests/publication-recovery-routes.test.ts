import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ viewer: vi.fn(), root: vi.fn(), status: vi.fn(), record: vi.fn(), finish: vi.fn(), adopt: vi.fn(), rootList: vi.fn(), rootRecord: vi.fn(), rootFinish: vi.fn(), rootAdopt: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: state.root }));
vi.mock('../src/modules/publishing/server/publication', () => ({ getPublicationStatus: state.status, recordPublicationOutcome: state.record, finishPublicationProjection: state.finish, adoptLegacyPublication: state.adopt }));
vi.mock('../src/server/root/publication-attempts', () => ({ listRootPublicationAttempts: state.rootList, recordRootPublicationOutcome: state.rootRecord, finishRootPublicationProjection: state.rootFinish, adoptRootLegacyPublication: state.rootAdopt }));
import * as customer from '../src/app/api/publishing/recovery/route';
import * as root from '../src/app/api/root/publication-attempts/route';

const customerActor = { user: { id: 'member' }, workspaceId: 'workspace' };
const sameOrigin = { origin: 'http://localhost' };
beforeEach(() => {
  vi.clearAllMocks(); state.viewer.mockResolvedValue(customerActor); state.root.mockResolvedValue({ id: 'root', isInstanceOwner: true });
  state.status.mockResolvedValue({ postId: 'post', operations: [], legacyProcessingCount: 0 }); state.record.mockResolvedValue({ state: 'receipt_recorded' }); state.finish.mockResolvedValue({ state: 'projected' }); state.adopt.mockResolvedValue({ state: 'uncertain' });
  state.rootList.mockResolvedValue({ timeZone: 'UTC', items: [], legacyProcessing: [], legacyTruncated: false }); state.rootRecord.mockResolvedValue({ state: 'receipt_recorded' }); state.rootFinish.mockResolvedValue({ state: 'projected' }); state.rootAdopt.mockResolvedValue({ state: 'uncertain' });
});

describe('publication recovery HTTP surfaces', () => {
  it('scopes customer status to one post and rejects extra query fields', async () => {
    const response = await customer.GET(new Request('http://localhost/api/publishing/recovery?postId=post'));
    expect(response.status).toBe(200); expect(state.status).toHaveBeenCalledWith({ userId: 'member', workspaceId: 'workspace' }, { postId: 'post' });
    const invalid = await customer.GET(new Request('http://localhost/api/publishing/recovery?postId=post&other=x'));
    expect(invalid.status).toBe(400); expect(state.status).toHaveBeenCalledTimes(1);
  });
  it('requires same-origin writes and passes external attestation to the shared service', async () => {
    const input = { action: 'record', postId: 'post', operationId: 'op', outcome: 'ABSENT', verifiedExternally: true, confirmation: 'RECORD PUBLICATION op ABSENT' };
    const denied = await customer.POST(new Request('http://localhost/api/publishing/recovery', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.example' }, body: JSON.stringify(input) }));
    expect(denied.status).toBe(403); expect(state.record).not.toHaveBeenCalled();
    const response = await customer.POST(new Request('http://localhost/api/publishing/recovery', { method: 'POST', headers: { ...sameOrigin, 'content-type': 'application/json' }, body: JSON.stringify(input) }));
    expect(response.status).toBe(200); expect(state.record).toHaveBeenCalledWith({ userId: 'member', workspaceId: 'workspace' }, expect.objectContaining({ postId: 'post', operationId: 'op', outcome: 'ABSENT', verifiedExternally: true }));
  });
  it('uses private Root route actions and exact confirmation namespaces', async () => {
    const response = await root.GET(new Request('http://localhost/api/root/publication-attempts'));
    expect(response.status).toBe(200); expect(state.rootList).toHaveBeenCalledWith('root');
    const finish = await root.POST(new Request('http://localhost/api/root/publication-attempts', { method: 'POST', headers: { ...sameOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'finish', operationId: 'op', confirmation: 'ROOT FINISH PUBLICATION op' }) }));
    expect(finish.status).toBe(200); expect(state.rootFinish).toHaveBeenCalledWith('root', { operationId: 'op', confirmation: 'ROOT FINISH PUBLICATION op' });
    const absent = await root.POST(new Request('http://localhost/api/root/publication-attempts', { method: 'POST', headers: { ...sameOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'op', outcome: 'ABSENT', verifiedExternally: true, confirmation: 'ROOT RECORD PUBLICATION op ABSENT' }) }));
    expect(absent.status).toBe(200); expect(state.rootRecord).toHaveBeenCalledWith('root', expect.objectContaining({ confirmation: 'ROOT RECORD PUBLICATION op ABSENT' }));
  });
});
