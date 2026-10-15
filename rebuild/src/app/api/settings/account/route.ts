import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hashLegacyPassword, hashLegacySessionToken, LEGACY_SESSION_COOKIE, verifyLegacyPassword } from '@/server/auth';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';
import { accountPasswordPolicy, auditAccountMutation, validateNewPassword, validateProfileName } from '@/server/account-settings';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
function errorResponse(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid account request.' }, { status: 400 });
  if (error instanceof Error && error.message.includes('NEXT_REDIRECT')) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  return NextResponse.json({ error: 'Could not update account settings.' }, { status: 500 });
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  try {
    const viewer = await requireViewer({ feature: 'settings/account', channelScoped: true });
    const input = z.object({ name: z.string() }).strict().parse(await request.json());
    const name = validateProfileName(input.name);
    if (!name) return NextResponse.json({ error: 'Name must be between 1 and 100 characters.' }, { status: 400 });
    await prisma.$transaction(async tx => {
      const changed = await tx.user.updateMany({ where: { id: viewer.user.id, disabledAt: null }, data: { name } });
      if (changed.count !== 1) throw new Error('account unavailable');
      await auditAccountMutation(tx, viewer.user.id, 'account.profile_updated', { fields: ['name'] });
    });
    return NextResponse.json({ name });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  try {
    const viewer = await requireViewer({ feature: 'settings/account', channelScoped: true });
    const input = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string() }).strict().parse(await request.json());
    if (!validateNewPassword(input.newPassword)) return NextResponse.json({ error: `New password must be at least ${accountPasswordPolicy.minLength} characters and no more than ${accountPasswordPolicy.maxBytes} bytes.` }, { status: 400 });
    const user = await prisma.user.findUnique({ where: { id: viewer.user.id }, select: { passwordHash: true, disabledAt: true } });
    if (!user || user.disabledAt || !verifyLegacyPassword(input.currentPassword, user.passwordHash)) return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
    const passwordHash = hashLegacyPassword(input.newPassword);
    const store = await cookies();
    const token = store.get(LEGACY_SESSION_COOKIE)?.value;
    const tokenHash = token ? hashLegacySessionToken(token) : null;
    await prisma.$transaction(async tx => {
      const changed = await tx.user.updateMany({ where: { id: viewer.user.id, disabledAt: null, passwordHash: user.passwordHash }, data: { passwordHash } });
      if (changed.count !== 1) throw new Error('account changed concurrently');
      await tx.session.deleteMany({ where: { userId: viewer.user.id, ...(tokenHash ? { tokenHash: { not: tokenHash } } : {}) } });
      await auditAccountMutation(tx, viewer.user.id, 'account.password_changed', { otherSessionsRevoked: true });
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
