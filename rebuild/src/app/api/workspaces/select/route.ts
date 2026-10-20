import { requestOrigin } from '@/server/request-origin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hashLegacySessionToken, isUsableLegacySession, LEGACY_SESSION_COOKIE } from '@/server/auth';
import { getSessionByTokenHash, listWorkspaces } from '@/server/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const selectionSchema = z.object({ workspaceId: z.string().min(1).max(200) }).strict();
const workspaceCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });

  let input: z.infer<typeof selectionSchema>;
  try {
    input = selectionSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid workspace selection.' }, { status: 400 });
  }

  const jar = await cookies();
  const token = jar.get(LEGACY_SESSION_COOKIE)?.value;
  const tokenHash = token ? hashLegacySessionToken(token) : null;
  if (!tokenHash) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });

  const session = await getSessionByTokenHash(tokenHash);
  if (!isUsableLegacySession(session, undefined)) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });

  const workspaces = await listWorkspaces(session.userId);
  if (!workspaces.some(item => item.workspace.id === input.workspaceId)) {
    return NextResponse.json({ error: 'Workspace not found.' }, { status: 404 });
  }

  jar.set('sp_workspace', input.workspaceId, workspaceCookieOptions);
  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
