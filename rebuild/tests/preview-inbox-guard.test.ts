import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../generated/client';
import { preparePreviewInbox } from '../scripts/preview-inbox';

const confirmation = 'SEED_LOCAL_REBUILD_PREVIEW';
const input = { workspaceId: 'preview_workspace', targetId: 'preview_channel', userId: 'preview_user', now: new Date('2026-10-16T12:00:00Z') };

function mockDatabase(options: { target?: unknown; member?: unknown; existing?: unknown } = {}) {
  const prisma = {
    target: { findFirst: vi.fn().mockResolvedValue(options.target ?? null) },
    membership: { findUnique: vi.fn().mockResolvedValue(options.member ?? null) },
    conversation: { findUnique: vi.fn().mockResolvedValue(options.existing ?? null), upsert: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma: prisma as unknown as PrismaClient, mocks: prisma };
}

function setSafeEnvironment() {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('PREVIEW_SEED_CONFIRM', confirmation);
  vi.stubEnv('DATABASE_URL', 'postgresql://preview:preview@localhost/social_pilot_preview');
}

afterEach(() => vi.unstubAllEnvs());

describe('preparePreviewInbox safety guards', () => {
  it('refuses production and missing confirmation before any database reads', async () => {
    const { prisma, mocks } = mockDatabase();
    setSafeEnvironment();
    vi.stubEnv('NODE_ENV', 'production');
    await expect(preparePreviewInbox(prisma, input)).rejects.toThrow('Confirm isolated local preview seeding');
    expect(mocks.target.findFirst).not.toHaveBeenCalled();
    expect(mocks.membership.findUnique).not.toHaveBeenCalled();

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PREVIEW_SEED_CONFIRM', '');
    await expect(preparePreviewInbox(prisma, input)).rejects.toThrow('Confirm isolated local preview seeding');
    expect(mocks.target.findFirst).not.toHaveBeenCalled();
    expect(mocks.membership.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['remote host', 'postgresql://preview:preview@db.example.invalid/social_pilot_preview'],
    ['non-preview database', 'postgresql://preview:preview@localhost/social_pilot'],
    ['host override', 'postgresql://preview:preview@localhost/social_pilot_preview?host=192.0.2.1'],
    ['hostaddr override', 'postgresql://preview:preview@localhost/social_pilot_preview?hostaddr=192.0.2.1'],
    ['socket override', 'postgresql://preview:preview@localhost/social_pilot_preview?socket=%2Ftmp%2Fdb.sock'],
  ])('refuses %s before reading fixture rows', async (_label, databaseUrl) => {
    const { prisma, mocks } = mockDatabase();
    setSafeEnvironment();
    vi.stubEnv('DATABASE_URL', databaseUrl);
    await expect(preparePreviewInbox(prisma, input)).rejects.toThrow('isolated loopback preview database');
    expect(mocks.target.findFirst).not.toHaveBeenCalled();
    expect(mocks.membership.findUnique).not.toHaveBeenCalled();
    expect(mocks.conversation.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['workspace', { ...input, workspaceId: 'customer_workspace' }],
    ['target', { ...input, targetId: 'facebook_page_123' }],
    ['user', { ...input, userId: 'real_user_123' }],
    ['empty fixture suffix', { ...input, workspaceId: 'preview_' }],
  ])('rejects a non-fixture %s identifier before database reads', async (_label, unsafeInput) => {
    const { prisma, mocks } = mockDatabase();
    setSafeEnvironment();
    await expect(preparePreviewInbox(prisma, unsafeInput)).rejects.toThrow('preview_ fixture identifiers');
    expect(mocks.target.findFirst).not.toHaveBeenCalled();
    expect(mocks.membership.findUnique).not.toHaveBeenCalled();
    expect(mocks.conversation.findUnique).not.toHaveBeenCalled();
  });

  it('requires an enabled workspace channel with a fixture provider id and a workspace member', async () => {
    setSafeEnvironment();
    const disabledOrUnselected = mockDatabase({ member: { id: 'preview_membership' } });
    await expect(preparePreviewInbox(disabledOrUnselected.prisma, input)).rejects.toThrow('selected channel');
    expect(disabledOrUnselected.mocks.target.findFirst).toHaveBeenCalledWith({
      where: { id: input.targetId, workspaceId: input.workspaceId, enabled: true },
      select: { id: true, name: true, providerId: true },
    });
    expect(disabledOrUnselected.mocks.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_workspaceId: { userId: input.userId, workspaceId: input.workspaceId } }, select: { id: true },
    });
    expect(disabledOrUnselected.mocks.conversation.findUnique).not.toHaveBeenCalled();

    const noMember = mockDatabase({ target: { id: input.targetId, name: 'Fixture channel', providerId: 'preview_provider_channel' } });
    await expect(preparePreviewInbox(noMember.prisma, input)).rejects.toThrow('selected channel');
    expect(noMember.mocks.conversation.findUnique).not.toHaveBeenCalled();

    const nonFixtureProvider = mockDatabase({
      target: { id: input.targetId, name: 'Selected channel', providerId: 'customer_provider_channel' },
      member: { id: 'preview_membership' },
    });
    await expect(preparePreviewInbox(nonFixtureProvider.prisma, input)).rejects.toThrow('selected channel');
    expect(nonFixtureProvider.mocks.conversation.findUnique).not.toHaveBeenCalled();
  });

  it('refuses an occupied reserved conversation identifier before starting writes', async () => {
    setSafeEnvironment();
    const reservedId = `${input.workspaceId}_conversation_history`;
    const { prisma, mocks } = mockDatabase({
      target: { id: input.targetId, name: 'Fixture channel', providerId: 'preview_provider_channel' },
      member: { id: 'preview_membership' },
      existing: { targetId: 'preview_other_channel', remoteId: reservedId },
    });
    await expect(preparePreviewInbox(prisma, input)).rejects.toThrow('Reserved Inbox example identifier has unexpected data');
    expect(mocks.conversation.findUnique).toHaveBeenCalledWith({ where: { id: reservedId }, select: { targetId: true, remoteId: true } });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});
