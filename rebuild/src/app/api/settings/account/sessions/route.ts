import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { hashLegacySessionToken, LEGACY_SESSION_COOKIE } from '@/server/auth';
import { auditAccountMutation } from '@/server/account-settings';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';

export const runtime = 'nodejs';

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
function errorResponse(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid session request.' }, { status: 400 });
  if (error instanceof Error && error.message.includes('NEXT_REDIRECT')) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  return NextResponse.json({ error: 'Could not update sessions.' }, { status: 500 });
}
async function sessionContext() {
  const viewer = await requireViewer({ feature: 'settings/account', channelScoped: true });
  const store = await cookies();
  const token = store.get(LEGACY_SESSION_COOKIE)?.value;
  const tokenHash = token ? hashLegacySessionToken(token) : null;
  if (!tokenHash) throw new Error('Current session unavailable.');
  return { viewer, tokenHash };
}

export async function GET() {
  try {
    const { viewer, tokenHash } = await sessionContext();
    const sessions = await prisma.session.findMany({ where: { userId: viewer.user.id, pending: null, expiresAt: { gt: new Date() } }, orderBy: { expiresAt: 'desc' }, select: { id: true, expiresAt: true, tokenHash: true } });
    return NextResponse.json({ sessions: sessions.map(({ id, expiresAt, tokenHash: hash }) => ({ id, expiresAt, current: hash === tokenHash })) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  try {
    const { viewer, tokenHash } = await sessionContext();
    const input = z.object({ id: z.string().min(1).max(100) }).strict().parse(await request.json());
    const changed = await prisma.$transaction(async tx => {
      const result = await tx.session.deleteMany({ where: { id: input.id, userId: viewer.user.id, pending: null, tokenHash: { not: tokenHash } } });
      if (result.count) await auditAccountMutation(tx, viewer.user.id, 'account.session_revoked', { sessionId: input.id });
      return result.count;
    });
    if (!changed) return NextResponse.json({ error: 'Other active session not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
