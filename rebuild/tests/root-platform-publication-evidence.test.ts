import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ active: vi.fn(), evidence: vi.fn(), execute: vi.fn(), limit: 100, configFailure: false }));
vi.mock('../src/server/root/operations', () => ({ requireActiveRoot: state.active }));
vi.mock('@/platforms', () => ({ PLATFORM_MODULES: [{ id: 'installed_but_disabled' }, { id: 'another' }] }));
vi.mock('../src/server/platforms/publication-recovery', () => ({ installedPublicationRecovery: (provider: string) => provider === 'installed_but_disabled' ? { readEvidence: state.evidence, executeRootAction: state.execute } : undefined }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async () => { if (state.configFailure) throw new Error('database unavailable'); return state.limit; } }));
import { readRootPlatformPublicationEvidence, runRootPlatformPublicationAction } from '../src/server/root/platform-publication-evidence';
import { OperationError } from '../src/lib/operation-error';

const panel = { title: 'Upload receipts', description: 'Known receipt identifiers.', columns: [{ key: 'operationId', label: 'Operation' }, { key: 'remoteId', label: 'Remote receipt' }], items: [{ operationId: 'op_1', remoteId: 'media_1' }], truncated: false };
beforeEach(() => { vi.clearAllMocks(); state.limit = 100; state.configFailure = false; state.active.mockResolvedValue(undefined); state.evidence.mockResolvedValue(panel); state.execute.mockResolvedValue({ ok: true, actionId: 'module_action', subjectId: 'row_1', operationId: 'receipt_1', state: 'confirmed', message: 'Action receipt recorded.' }); });

describe('Root platform publication evidence service', () => {
  it('rechecks active Root and reads an installed platform even when customer access is disabled', async () => {
    expect(await readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled', operationId: 'op_1', resultCap: 4 })).toEqual({ providerId: 'installed_but_disabled', ...panel });
    expect(state.active).toHaveBeenCalledWith('root');
    expect(state.evidence).toHaveBeenCalledWith('op_1', 5);
  });
  it('aggregates installed module panels under one global cap', async () => {
    state.evidence.mockResolvedValueOnce({ ...panel, items: [{ operationId: '1', remoteId: null }, { operationId: '2', remoteId: null }], truncated: false });
    const result = await readRootPlatformPublicationEvidence('root', { resultCap: 1 });
    expect(result).toEqual({ providers: [{ providerId: 'installed_but_disabled', ...panel, items: [{ operationId: '1', remoteId: null }], truncated: true }], truncated: true });
    expect(state.evidence).toHaveBeenCalledWith(undefined, 2);
  });
  it('uses the consumed Root limit by default and clamps a requested limit to it', async () => {
    await readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled' });
    expect(state.evidence).toHaveBeenCalledWith(undefined, 101);
    state.limit = 3;
    state.evidence.mockClear();
    state.evidence.mockResolvedValueOnce({ ...panel, items: Array.from({ length: 4 }, (_, index) => ({ operationId: `op_${index}`, remoteId: null })) });
    const result = await readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled', resultCap: 9 });
    expect(state.evidence).toHaveBeenCalledWith(undefined, 4);
    expect(result).toMatchObject({ items: [{ operationId: 'op_0', remoteId: null }, { operationId: 'op_1', remoteId: null }, { operationId: 'op_2', remoteId: null }], truncated: true });
  });
  it('fails closed when the Root evidence limit is invalid or unavailable', async () => {
    state.limit = 0;
    await expect(readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled' })).rejects.toMatchObject({ code: 'unavailable' });
    state.limit = 100; state.configFailure = true;
    await expect(readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled' })).rejects.toMatchObject({ code: 'unavailable' });
    expect(state.evidence).not.toHaveBeenCalled();
  });
  it.each([
    { providerId: 'not installed' }, { providerId: 'installed_but_disabled', operationId: 'contains space' },
    { providerId: 'installed_but_disabled', resultCap: 0 }, { providerId: 'installed_but_disabled', extra: true },
    { operationId: 'op_1' },
  ])('rejects invalid input before calling a platform hook: %j', async input => {
    await expect(readRootPlatformPublicationEvidence('root', input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.evidence).not.toHaveBeenCalled();
  });
  it('drops undeclared values and masks hook errors', async () => {
    state.evidence.mockResolvedValueOnce({ ...panel, items: [{ operationId: 'op_safe', remoteId: null, unexpected: 'secret' }] });
    expect(await readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled' })).toEqual({ providerId: 'installed_but_disabled', ...panel, items: [{ operationId: 'op_safe', remoteId: null }] });
    state.evidence.mockRejectedValueOnce(new Error('token=private'));
    await expect(readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled' })).rejects.toMatchObject({ code: 'upstream_failure', message: 'Platform publication evidence could not be loaded.' });
  });
  it('accepts receipt IDs up to the provider integrity bound and rejects larger values', async () => {
    const remoteId = 'r'.repeat(2048);
    state.evidence.mockResolvedValueOnce({ ...panel, items: [{ operationId: 'op_safe', remoteId }] });
    const result = await readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled' });
    expect('items' in result && result.items[0].remoteId).toBe(remoteId);
    state.evidence.mockResolvedValueOnce({ ...panel, items: [{ operationId: 'op_safe', remoteId: `${remoteId}r` }] });
    await expect(readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled' })).rejects.toMatchObject({ code: 'upstream_failure' });
  });
  it('does not read evidence if active Root verification fails', async () => {
    state.active.mockRejectedValueOnce(new OperationError('forbidden', 'Installation-owner access is required.'));
    await expect(readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.evidence).not.toHaveBeenCalled();
  });
  it('validates and returns only module actions attached to visible evidence rows', async () => {
    const withActions = { ...panel, rowIdKey: 'operationId', actions: [
      { rowId: 'op_1', actionId: 'module_action', subjectId: 'row_1', label: 'Resolve row', description: 'Review the stored row.', acknowledgmentLabel: 'I checked this row', confirmation: 'RESOLVE op_1' },
      { rowId: 'op_2', actionId: 'module_action', subjectId: 'row_2', label: 'Resolve row', description: 'Review the stored row.', acknowledgmentLabel: 'I checked this row', confirmation: 'RESOLVE op_2' },
    ] };
    state.evidence.mockResolvedValueOnce(withActions);
    const result = await readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled', resultCap: 1 });
    expect(result).toMatchObject({ rowIdKey: 'operationId', actions: [withActions.actions[0]] });
    state.evidence.mockResolvedValueOnce({ ...withActions, rowIdKey: 'missing' });
    await expect(readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled' })).rejects.toMatchObject({ code: 'upstream_failure' });
    state.evidence.mockResolvedValueOnce({ ...withActions, actions: [{ ...withActions.actions[0], rowId: 'not_returned' }] });
    expect(await readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled' })).toMatchObject({ actions: [] });
    state.evidence.mockResolvedValueOnce({ ...withActions, actions: [{ ...withActions.actions[0], label: '' }] });
    await expect(readRootPlatformPublicationEvidence('root', { providerId: 'installed_but_disabled' })).rejects.toMatchObject({ code: 'upstream_failure' });
  });
  it('dispatches only strict module action input after active Root verification and validates receipts', async () => {
    const input = { providerId: 'installed_but_disabled', actionId: 'module_action', subjectId: 'row_1', confirmation: 'MODULE CONFIRM', acknowledged: true };
    expect(await runRootPlatformPublicationAction('root', input)).toMatchObject({ state: 'confirmed', ok: true, operationId: 'receipt_1' });
    expect(state.execute).toHaveBeenCalledWith('root', { actionId: 'module_action', subjectId: 'row_1', confirmation: 'MODULE CONFIRM', acknowledged: true });
    state.execute.mockResolvedValueOnce({ ok: false, actionId: 'module_action', subjectId: 'row_1', operationId: 'receipt_2', state: 'needs_review', message: 'Review receipt.' });
    expect(await runRootPlatformPublicationAction('root', input)).toMatchObject({ state: 'needs_review', ok: false });
    state.execute.mockResolvedValueOnce({ ok: true, actionId: 'other_action', subjectId: 'row_1', operationId: 'receipt_3', state: 'confirmed', message: 'Done.' });
    await expect(runRootPlatformPublicationAction('root', input)).rejects.toMatchObject({ code: 'upstream_failure' });
    await expect(runRootPlatformPublicationAction('root', { ...input, rowId: 'client_remote_id' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
