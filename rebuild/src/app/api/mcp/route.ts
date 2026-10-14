import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { hashLegacySessionToken, isUsableLegacySession, LEGACY_SESSION_COOKIE } from '@/server/auth';
import { getSessionByTokenHash, listWorkspaces, prisma } from '@/server/data';
import { loadEntitlements } from '@/server/entitlements';
import { handleMcpMessage, type McpViewer } from '@/server/mcp/server';

async function getViewer(): Promise<McpViewer | null> {
  const jar = await cookies();
  const token = jar.get(LEGACY_SESSION_COOKIE)?.value;
  const hash = token ? hashLegacySessionToken(token) : null;
  if (!hash) return null;
  const session = await getSessionByTokenHash(hash);
  if (!isUsableLegacySession(session, undefined)) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } });
  if (!user) return null;
  const workspaces = await listWorkspaces(user.id);
  const selected = jar.get('sp_workspace')?.value;
  const membership = workspaces.find(item => item.workspace.id === selected) ?? workspaces.find(item => item.role === 'owner' || item.role === 'admin') ?? workspaces[0];
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) return null;
  const entitlements = await loadEntitlements(user.id, membership.workspace.id);
  if (!entitlements) return null;
  return { userId: user.id, workspaceId: membership.workspace.id, workspace: membership.workspace, entitlements };
}

function unauthenticated() {
  return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sign in to the rebuild app to use MCP.' } }, { status: 401 });
}

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return unauthenticated();
  let message: Record<string, unknown>;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } }, { status: 400 });
    message = body as Record<string, unknown>;
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }, { status: 400 });
  }
  return handleMcpMessage(viewer, message);
}

export async function GET() {
  if (!await getViewer()) return unauthenticated();
  return NextResponse.json({ error: 'Send JSON-RPC requests with POST.' }, { status: 405, headers: { allow: 'POST' } });
}
