import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/client';
import { exportAccountSupplementaryData, deleteAccountSupplementaryData } from '../src/server/data-control/account';

describe('supplementary account data hooks', () => {
  it('exports stored appearance and safe credential metadata using exact user scope', async () => {
    const tx = {
      $queryRaw: vi.fn(async (sql: TemplateStringsArray) => String(sql).includes('SELECT theme') ? [{ theme: 'warm' }] : [{ id: 'metadata' }]),
      appSetting: { findUnique: vi.fn().mockResolvedValue({ value: 'dark', encrypted: false }) },
    };
    const result = await exportAccountSupplementaryData(tx as unknown as Prisma.TransactionClient, 'a.b%_');
    expect(result).toEqual({ appearance: { theme: 'warm', mode: 'dark' }, personCredentials: [{ id: 'metadata' }], oauthGrants: [{ id: 'metadata' }], legacyOauthGrants: [{ id: 'metadata' }] });
    expect(tx.appSetting.findUnique).toHaveBeenCalledWith({ where: { key: 'settings.appearance.user.a.b%_.mode' }, select: { value: true, encrypted: true } });
    for (const [sql, ...args] of tx.$queryRaw.mock.calls as unknown as [TemplateStringsArray, ...unknown[]][]) {
      expect(args).toEqual(['a.b%_']);
      expect(sql.join('')).not.toMatch(/tokenHash|tokenPrefix|codeHash|codeChallenge|password|SELECT \*/);
    }
  });
  it('does not export encrypted preference payloads or substitute installation defaults', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]), appSetting: { findUnique: vi.fn().mockResolvedValue({ value: 'ciphertext', encrypted: true }) } };
    expect((await exportAccountSupplementaryData(tx as unknown as Prisma.TransactionClient, 'missing')).appearance).toEqual({ theme: null, mode: null });
  });
  it('deletes only the exact account preference in the caller transaction', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1), appSetting: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    expect(await deleteAccountSupplementaryData(tx as unknown as Prisma.TransactionClient, 'a.b%_')).toEqual({ count: 1 });
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual(['a.b%_']);
    expect(tx.appSetting.deleteMany).toHaveBeenCalledWith({ where: { key: 'settings.appearance.user.a.b%_.mode' } });
  });
});
