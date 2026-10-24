import type { Prisma } from '../../../../generated/client';

/** Account-owned compatibility storage, never an installation setting. Use exact keys: IDs may contain dots. */
export const appearanceModeKey = (userId: string) => `settings.appearance.user.${userId}.mode`;

/** Supplementary account-export hook. The caller owns authorization and the export transaction. */
export async function exportAccountAppearance(tx: Prisma.TransactionClient, userId: string) {
  const [users, mode] = await Promise.all([
    tx.$queryRaw<Array<{ theme: string }>>`SELECT theme FROM users WHERE id = ${userId}`,
    tx.appSetting.findUnique({ where: { key: appearanceModeKey(userId) }, select: { value: true, encrypted: true } }),
  ]);
  // Export stored choices, not Root defaults; do not decrypt corrupt/encrypted preference rows.
  return { theme: users[0]?.theme ?? null, mode: mode && !mode.encrypted ? mode.value : null };
}
