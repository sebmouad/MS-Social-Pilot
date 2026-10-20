import { cookies } from 'next/headers';
import { z } from 'zod';
import { MODE_COOKIE, THEME_COOKIE, THEMES, MODES, isThemeId, isModeId, type ModeId } from '@/lib/themes';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { auditAccountMutation } from '@/server/account-settings';
import { authorizeAccountSession, type AccountActor } from './account';

export const appearanceConfirmation = 'UPDATE APPEARANCE';
export async function readAppearance(actor: AccountActor, currentMode?: unknown) {
  await authorizeAccountSession(actor, false, 'settings/appearance');
  const [user, defaultTheme, defaultMode] = await Promise.all([
    prisma.$queryRaw<Array<{ theme: string }>>`SELECT theme FROM users WHERE id = ${actor.userId} AND "disabledAt" IS NULL`,
    runtimeConfig('theme.default'), runtimeConfig('theme.defaultMode'),
  ]);
  if (!user[0]) throw new OperationError('not_found', 'Account unavailable.');
  return { theme: isThemeId(user[0].theme) ? user[0].theme : defaultTheme, mode: isModeId(currentMode) ? currentMode : defaultMode, modePersistence: 'cookie' as const, themes: THEMES.map(t => t.id), modes: MODES.map(m => m.id) };
}
export async function updateAppearance(actor: AccountActor, input: unknown) {
  await authorizeAccountSession(actor, true, 'settings/appearance');
  const parsed = z.object({ theme: z.custom<string>(isThemeId), mode: z.custom<ModeId>(isModeId), confirmation: z.literal(appearanceConfirmation) }).strict().safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Choose a valid theme and mode and confirm the change.');
  const { theme, mode } = parsed.data;
  const cookieMaxAge = await runtimeConfig('settings.appearanceCookieMaxAgeSeconds');
  await prisma.$transaction(async tx => {
    // The compatibility Prisma model omits this existing legacy users column.
    const changed = await tx.$executeRaw`UPDATE users SET theme = ${theme}, "updatedAt" = NOW() WHERE id = ${actor.userId} AND "disabledAt" IS NULL`;
    if (changed !== 1) throw new OperationError('conflict', 'Account unavailable.');
    await auditAccountMutation(tx, actor.userId, 'account.appearance_updated', { theme, mode, modePersistence: 'cookie' });
  });
  return { theme, mode, modePersistence: 'cookie' as const, cookieMaxAge };
}
/** Mode has no database column. Both transports apply the same browser cookies; only theme is stored per user. */
export async function appearanceSession(actor: AccountActor, input?: unknown) {
  const jar = await cookies();
  if (input === undefined) return readAppearance(actor, jar.get(MODE_COOKIE)?.value);
  const saved = await updateAppearance(actor, input);
  const options = { path: '/', sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', maxAge: saved.cookieMaxAge };
  jar.set(THEME_COOKIE, saved.theme, options);
  jar.set(MODE_COOKIE, saved.mode, options);
  return { theme: saved.theme, mode: saved.mode, modePersistence: saved.modePersistence };
}
