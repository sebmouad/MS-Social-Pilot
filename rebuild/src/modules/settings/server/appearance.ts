import { cookies } from 'next/headers';
import { appearanceModeKey as modeKey } from './appearance-data';
import { z } from 'zod';
import { MODE_COOKIE, THEME_COOKIE, THEMES, MODES, isThemeId, isModeId, type ModeId } from '@/lib/themes';
import { OperationError } from '@/lib/operation-error';
import { prisma, getSessionByTokenHash } from '@/server/data';
import { hashLegacySessionToken, isUsableLegacySession, LEGACY_SESSION_COOKIE } from '@/server/auth';
import { runtimeConfig } from '@/server/config/store';
import { auditAccountMutation } from '@/server/account-settings';
import { authorizeAccountSession, type AccountActor } from './account';

export const appearanceConfirmation = 'UPDATE APPEARANCE';
async function storedAppearance(userId: string) {
  const [user, savedMode, defaultTheme, defaultMode] = await Promise.all([
    prisma.$queryRaw<Array<{ theme: string }>>`SELECT theme FROM users WHERE id = ${userId} AND "disabledAt" IS NULL`,
    prisma.appSetting.findUnique({ where: { key: modeKey(userId) }, select: { value: true } }),
    runtimeConfig('theme.default'), runtimeConfig('theme.defaultMode'),
  ]);
  if (!user[0]) throw new OperationError('not_found', 'Account unavailable.');
  return { theme: isThemeId(user[0].theme) ? user[0].theme : defaultTheme, mode: isModeId(savedMode?.value) ? savedMode.value : defaultMode };
}

/** Layout reads only the identity in a validated session, without redirecting public pages. */
export async function initialAppearance() {
  const jar = await cookies();
  const cachedTheme = jar.get(THEME_COOKIE)?.value;
  const cachedMode = jar.get(MODE_COOKIE)?.value;
  let account: Awaited<ReturnType<typeof storedAppearance>> | undefined;
  if (!isThemeId(cachedTheme) || !isModeId(cachedMode)) {
    const token = jar.get(LEGACY_SESSION_COOKIE)?.value;
    const hash = token ? hashLegacySessionToken(token) : null;
    const session = hash ? await getSessionByTokenHash(hash) : null;
    if (isUsableLegacySession(session, undefined)) account = await storedAppearance(session.userId);
  }
  return {
    theme: isThemeId(cachedTheme) ? cachedTheme : account?.theme ?? await runtimeConfig('theme.default'),
    mode: isModeId(cachedMode) ? cachedMode : account?.mode ?? await runtimeConfig('theme.defaultMode'),
  };
}

export async function readAppearance(actor: AccountActor) {
  await authorizeAccountSession(actor, false, 'settings/appearance');
  return { ...await storedAppearance(actor.userId), modePersistence: 'account' as const, themes: THEMES.map(t => t.id), modes: MODES.map(m => m.id) };
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
    const key = modeKey(actor.userId);
    await tx.appSetting.upsert({ where: { key }, create: { key, value: mode, encrypted: false, updatedAt: new Date() }, update: { value: mode, encrypted: false, updatedAt: new Date() } });
    await auditAccountMutation(tx, actor.userId, 'account.appearance_updated', { theme, mode, modePersistence: 'account' });
  });
  return { theme, mode, modePersistence: 'account' as const, cookieMaxAge };
}
/** REST and session MCP share account persistence and refresh the fast browser cache. */
export async function appearanceSession(actor: AccountActor, input?: unknown) {
  const jar = await cookies();
  if (input === undefined) return readAppearance(actor);
  const saved = await updateAppearance(actor, input);
  const options = { path: '/', sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', maxAge: saved.cookieMaxAge };
  jar.set(THEME_COOKIE, saved.theme, options);
  jar.set(MODE_COOKIE, saved.mode, options);
  return { theme: saved.theme, mode: saved.mode, modePersistence: saved.modePersistence };
}
