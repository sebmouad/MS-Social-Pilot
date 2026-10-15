import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { hashLegacySessionToken, isUsableLegacySession, LEGACY_SESSION_COOKIE } from '@/server/auth';
import { getSessionByTokenHash, listWorkspaces, prisma } from '@/server/data';
import { loadEntitlements } from '@/server/entitlements';
import { handleMcpMessage, type McpViewer } from '@/server/mcp/server';
import { runtimeConfig } from '@/server/config/store';
import { hit } from '@/server/rate-limit';

async function getViewer(): Promise<McpViewer | null> {
  if (await runtimeConfig('mcp.enabled') !== true) return null;
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
  const configuredRoles = await runtimeConfig('mcp.authenticatedRoles') as unknown;
  const roles = Array.isArray(configuredRoles) ? configuredRoles : ['owner', 'admin'];
  // Non-manager channel scope is not yet applied to every MCP query. Keep the
  // preview gate closed even if Root stores a broader future role policy.
  if (!membership || !['owner', 'admin'].includes(membership.role) || !roles.includes(membership.role)) return null;
  const entitlements = await loadEntitlements(user.id, membership.workspace.id);
  if (!entitlements) return null;
  const maxResultItems = await runtimeConfig('mcp.maxResultItems') as number;
  return { userId: user.id, workspaceId: membership.workspace.id, role: membership.role, workspace: membership.workspace, entitlements, maxResultItems };
}

function unauthenticated() {
  return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sign in to the rebuild app to use MCP.' } }, { status: 401 });
}

async function readBodyLimited(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Request body is too large.');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32003, message: 'Origin is not allowed.' } }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'JSON content type is required.' } }, { status: 415 });
  }
  const maxBytes = Number(await runtimeConfig('mcp.maxRequestBytes')) || 1_048_576;
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request body is too large.' } }, { status: 413 });
  }
  const viewer = await getViewer();
  if (!viewer) return unauthenticated();
  const requestsPerMinute = await runtimeConfig('mcp.requestsPerMinute') as number;
  if (!hit(`mcp:${viewer.workspaceId}:${viewer.userId}`, { limit: requestsPerMinute, windowMs: 60_000 }).allowed) {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32004, message: 'MCP request limit reached.' } }, { status: 429 });
  }
  let message: Record<string, unknown>;
  try {
    const rawBody = await readBodyLimited(request, maxBytes);
    const body: unknown = JSON.parse(rawBody);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } }, { status: 400 });
    message = body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'Request body is too large.') {
      return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: error.message } }, { status: 413 });
    }
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }, { status: 400 });
  }
  return handleMcpMessage(viewer, message);
}

export async function GET() {
  if (!await getViewer()) return unauthenticated();
  return NextResponse.json({ error: 'Send JSON-RPC requests with POST.' }, { status: 405, headers: { allow: 'POST' } });
}
