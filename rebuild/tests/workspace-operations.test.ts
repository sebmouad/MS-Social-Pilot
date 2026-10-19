import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() }, workspaceDataPurge: { findUnique: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() },
  config: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), canUse: vi.fn(), canAccess: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: mocks.canUse }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: mocks.canAccess }));

import { crowdedDestinationPlatforms, applyUtm, aiAvoidWordList, isWithinBusinessHours, normalizeWorkspaceOperations, prepareCaptionLinks, spacingWarning, undoSendDelayMs, workspaceOperationsConfirmation, WORKSPACE_OPERATIONS_DEFAULTS } from '../src/modules/settings/workspace-operations';
import { workspaceOperationsCopy } from '../src/modules/settings/workspace-operations-copy';
import { readWorkspaceOperations, updateWorkspaceOperations } from '../src/modules/settings/server/workspace-operations';
import { executeWorkspacePolicyTool, workspacePolicyToolDefinitions, workspacePolicyWriteTools } from '../src/modules/settings/workspace-policy-mcp';

const actor = { userId: 'owner-1', workspaceId: 'workspace-1' };
const valid = { ...WORKSPACE_OPERATIONS_DEFAULTS, businessDays: [5, 1, 1], utmSource: ' example ', utmMedium: 'social', utmCampaignTemplate: '{month}-{target}', aiTone: 'friendly', aiBrandVoice: 'Warm and direct.', aiAvoidWords: 'cheap, cheap ,  ' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.user.findUnique.mockResolvedValue({ disabledAt: null });
  mocks.prisma.membership.findUnique.mockResolvedValue({ role: 'owner' });
  mocks.prisma.workspaceDataPurge.findUnique.mockResolvedValue(null);
  mocks.config.mockImplementation(async (key: string) => key === 'settings.teamOperationTimeoutMs' ? 10000 : 1000);
  mocks.entitlements.mockResolvedValue({ workspaceId: actor.workspaceId }); mocks.permissions.mockResolvedValue({}); mocks.canUse.mockReturnValue(true); mocks.canAccess.mockReturnValue(true);
  mocks.prisma.$queryRaw.mockResolvedValue([{ id: actor.workspaceId, suspendedAt: null, role: 'owner', disabledAt: null }]);
  mocks.prisma.$executeRaw.mockResolvedValue(1);
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => Promise<unknown>) => work(mocks.prisma));
});

describe('workspace operations domain rules (legacy parity)', () => {
  it('applies UTM tags like legacy without overwriting explicit tags', () => {
    const settings = { utmSource: 'facebook', utmMedium: 'social', utmCampaignTemplate: 'always-on' };
    expect(new URL(applyUtm('https://example.com/page?id=42', settings)).searchParams.get('utm_source')).toBe('facebook');
    expect(new URL(applyUtm('https://example.com?utm_source=newsletter', settings)).searchParams.get('utm_source')).toBe('newsletter');
    expect(applyUtm('https://example.com/page#section', settings)).toContain('#section');
    expect(applyUtm('not a url', settings)).toBe('not a url');
    expect(new URL(applyUtm('https://example.com', { ...settings, utmCampaignTemplate: '{month}-{target}' }, { targetName: 'Acme Store', date: new Date('2026-09-15T00:00:00Z') })).searchParams.get('utm_campaign')).toBe('2026-09-acme-store');
    expect(prepareCaptionLinks('Read https://example.com/a. Now', settings)).toContain('https://example.com/a?utm_source=facebook');
    expect(prepareCaptionLinks('Read https://example.com/a', { utmSource: null, utmMedium: null, utmCampaignTemplate: null })).toBe('Read https://example.com/a');
  });
  it('implements hours, spacing, undo and avoid-word helpers', () => {
    expect(isWithinBusinessHours({ businessDays: [], businessStart: 9, businessEnd: 18 }, 0, 3)).toBe(true);
    expect(isWithinBusinessHours({ businessDays: [1], businessStart: 9, businessEnd: 18 }, 1, 18)).toBe(false);
    expect(isWithinBusinessHours({ businessDays: [1], businessStart: 9, businessEnd: 18 }, 1, 9)).toBe(true);
    const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
    expect(spacingWarning({ spamGapMinutes: 20 }, [at(0), at(5), at(60)])).toBe(true);
    expect(spacingWarning({ spamGapMinutes: 0 }, [at(0), at(1), at(2)])).toBe(false);
    expect(spacingWarning({ spamGapMinutes: 20 }, [at(0), at(5)])).toBe(false);
    expect(undoSendDelayMs({ undoSendSeconds: 30 })).toBe(30000);
    expect(aiAvoidWordList(' cheap, deal ,cheap,, ')).toEqual(['cheap', 'deal']);
  });
  it('flags three or more simultaneous destinations of one platform only when spacing is on', () => {
    expect(crowdedDestinationPlatforms(20, ['a', 'a', 'b', 'a', null])).toEqual(['a']);
    expect(crowdedDestinationPlatforms(20, ['a', 'a', 'b'])).toEqual([]);
    expect(crowdedDestinationPlatforms(0, ['a', 'a', 'a'])).toEqual([]);
  });
  it('normalizes legacy rows and falls back per field on invalid stored values', () => {
    const out = normalizeWorkspaceOperations({ ...valid, spamGapMinutes: 9999, bestTimeMode: 'weird', utmSource: null, aiTone: '' });
    expect(out.spamGapMinutes).toBe(20); expect(out.bestTimeMode).toBe('suggest'); expect(out.utmSource).toBeNull(); expect(out.aiTone).toBeNull(); expect(out.businessDays).toEqual([1, 5]);
  });
  it('keeps English and French copy in step', () => {
    expect(Object.keys(workspaceOperationsCopy.fr).sort()).toEqual(Object.keys(workspaceOperationsCopy.en).sort());
    for (const value of Object.values(workspaceOperationsCopy.fr)) expect(value.length).toBeGreaterThan(0);
  });
});

describe('workspace operations service', () => {
  it('reads only for an active workspace manager', async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([{ ...valid, utmSource: 'example' }]);
    await expect(readWorkspaceOperations(actor)).resolves.toMatchObject({ ok: true, settings: { utmSource: 'example', businessDays: [1, 5] } });
    mocks.prisma.membership.findUnique.mockResolvedValueOnce({ role: 'editor' });
    await expect(readWorkspaceOperations(actor)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('rejects invalid values and wrong confirmations before any transaction', async () => {
    const confirmation = workspaceOperationsConfirmation(actor.workspaceId);
    await expect(updateWorkspaceOperations(actor, { settings: { ...valid, businessStart: 18, businessEnd: 9 }, confirmation })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateWorkspaceOperations(actor, { settings: { ...valid, undoSendSeconds: 61 }, confirmation })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateWorkspaceOperations(actor, { settings: { ...valid, extra: 1 }, confirmation })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateWorkspaceOperations(actor, { settings: valid, confirmation: workspaceOperationsConfirmation('other') })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('saves normalized values and audits without storing brand text', async () => {
    const result = await updateWorkspaceOperations(actor, { settings: valid, confirmation: workspaceOperationsConfirmation(actor.workspaceId) });
    expect(result).toMatchObject({ ok: true, settings: { utmSource: 'example', businessDays: [1, 5], aiTone: 'friendly' } });
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(2);
    const audit = JSON.stringify(mocks.prisma.$executeRaw.mock.calls[1]);
    expect(audit).toContain('workspace.operations_updated'); expect(audit).not.toContain('Warm and direct.');
  });
  it('refuses writes during erasure and for demoted members inside the transaction', async () => {
    const confirmation = workspaceOperationsConfirmation(actor.workspaceId);
    mocks.prisma.workspaceDataPurge.findUnique.mockResolvedValueOnce({ status: 'running' });
    await expect(updateWorkspaceOperations(actor, { settings: valid, confirmation })).rejects.toMatchObject({ code: 'conflict' });
    mocks.prisma.$queryRaw.mockResolvedValueOnce([{ id: actor.workspaceId, suspendedAt: null }]).mockResolvedValueOnce([{ role: 'contributor', disabledAt: null }]);
    await expect(updateWorkspaceOperations(actor, { settings: valid, confirmation })).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('exposes confirmed MCP read and write tools through the settings module', async () => {
    expect(workspacePolicyToolDefinitions.map(tool => tool.name)).toEqual(expect.arrayContaining(['get_workspace_operations', 'update_workspace_operations']));
    expect(workspacePolicyWriteTools.has('update_workspace_operations')).toBe(true);
    await expect(executeWorkspacePolicyTool(actor, 'get_workspace_operations', { extra: true })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeWorkspacePolicyTool(actor, 'update_workspace_operations', { settings: valid, confirmation: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
