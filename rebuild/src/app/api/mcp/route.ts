import { requestOrigin } from '@/server/request-origin';
import { authenticatePersonBearer } from '@/modules/settings/person-keys/service';
import { authenticateBearerHeader } from '@/server/mcp/bearer';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { hashLegacySessionToken, isUsableLegacySession, LEGACY_SESSION_COOKIE } from '@/server/auth';
import { getSessionByTokenHash, listWorkspaces, prisma } from '@/server/data';
import { loadEntitlements } from '@/server/entitlements';
import { handleMcpMessage, type McpIdentity, type McpViewer, type McpInstallationViewer } from '@/server/mcp/server';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { hit } from '@/server/rate-limit';
import { loadPermissions } from '@/server/permissions/loader';

type RequestScope = 'automatic' | 'workspace' | 'installation';

function json(payload: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set('cache-control', 'no-store');
  return NextResponse.json(payload, { ...init, headers });
}

function requestScope(request: Request): RequestScope {
  const values = new URL(request.url).searchParams.getAll('scope');
  if (!values.length) return 'automatic';
  if (values.length !== 1 || !['workspace', 'installation'].includes(values[0])) throw new OperationError('invalid_request', 'Choose workspace or installation MCP scope.');
  return values[0] as RequestScope;
}

async function getViewer(scope: RequestScope): Promise<McpIdentity | null> {
  if (await runtimeConfig('mcp.enabled') !== true) return null;
  const jar = await cookies();
  const token = jar.get(LEGACY_SESSION_COOKIE)?.value;
  const hash = token ? hashLegacySessionToken(token) : null;
  if (!hash) return null;
  const session = await getSessionByTokenHash(hash);
  if (!isUsableLegacySession(session, undefined)) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, isInstanceOwner: true, disabledAt: true } });
  if (!user || user.disabledAt) return null;
  const maxResultItems = await runtimeConfig('mcp.maxResultItems') as number;
  const installation: McpInstallationViewer | null = user.isInstanceOwner ? { scope: 'installation', userId: user.id, isInstanceOwner: true, maxResultItems } : null;
  if (scope === 'installation') return installation;
  const fallback = scope === 'automatic' ? installation : null;
  const workspaces = await listWorkspaces(user.id);
  const selected = jar.get('sp_workspace')?.value;
  const membership = workspaces.find(item => item.workspace.id === selected) ?? workspaces.find(item => item.role === 'owner' || item.role === 'admin') ?? workspaces[0];
  const roles: readonly string[] = await runtimeConfig('mcp.authenticatedRoles');
  if (!membership || !roles.includes(membership.role)) return fallback;
  const entitlements = await loadEntitlements(user.id, membership.workspace.id, { allowInstallationInspection: false });
  const permissions = await loadPermissions(user.id, membership.workspace.id);
  if (!entitlements || !permissions) return fallback;
  return { scope: 'workspace', userId: user.id, workspaceId: membership.workspace.id, role: membership.role, workspace: membership.workspace, entitlements, permissions, maxResultItems, isInstanceOwner: scope === 'workspace' ? false : user.isInstanceOwner };
}

async function getRequestViewer(request: Request): Promise<McpIdentity | null> {
  const scope = requestScope(request);
  // A supplied bearer always determines authentication; never fall back to cookies.
  if (request.headers.has('authorization')) {
    if (scope === 'installation') return null;
    const authorization = request.headers.get('authorization');
    // Person credentials never flow through the workspace authenticator, even when invalid.
    if (authorization?.startsWith('Bearer mcp_person_')) return scope === 'workspace' ? null : authenticatePersonBearer(authorization);
    return getBearerViewer(request);
  }
  return getViewer(scope);
}

function getBearerViewer(request: Request): Promise<McpViewer | null> {
  return authenticateBearerHeader(request.headers.get('authorization'));
}

function unauthenticated() {
  return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sign in to use MCP.' } }, { status: 401 });
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
  try { return await handlePost(request); }
  catch (error) {
    const failure = operationFailure(error, 'The MCP response could not be confirmed. Check the current state before repeating a write.');
    return json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: failure.error } }, { status: failure.status });
  }
}

async function handlePost(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== requestOrigin(request)) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32003, message: 'Origin is not allowed.' } }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'JSON content type is required.' } }, { status: 415 });
  }
  const maxBytes = await runtimeConfig('mcp.maxRequestBytes');
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request body is too large.' } }, { status: 413 });
  }
  let viewer: McpIdentity | null;
  try { viewer = await getRequestViewer(request); }
  catch (error) { const failure = operationFailure(error, 'MCP access could not be checked. Please try again.'); return json({ jsonrpc: '2.0', id: null, error: { code: failure.code === 'invalid_request' ? -32600 : -32603, message: failure.error } }, { status: failure.status }); }
  if (!viewer) return unauthenticated();
  const requestsPerMinute = await runtimeConfig(viewer.scope === 'person' || viewer.apiKeyId ? 'mcp.keys.requestsPerMinute' : 'mcp.requestsPerMinute') as number;
  const rateKey = viewer.scope === 'person' ? `mcp:person-key:${viewer.personKeyId}` : viewer.apiKeyId ? `mcp:key:${viewer.apiKeyId}` : viewer.scope === 'installation' ? `mcp:installation:${viewer.userId}` : `mcp:${viewer.workspaceId}:${viewer.userId}`;
  if (!hit(rateKey, { limit: requestsPerMinute, windowMs: 60_000 }).allowed) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32004, message: 'MCP request limit reached.' } }, { status: 429 });
  }
  let message: Record<string, unknown>;
  try {
    const rawBody = await readBodyLimited(request, maxBytes);
    const body: unknown = JSON.parse(rawBody);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } }, { status: 400 });
    message = body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'Request body is too large.') {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: error.message } }, { status: 413 });
    }
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }, { status: 400 });
  }
  return handleMcpMessage(viewer, message);
}

export async function GET(request: Request) {
  try {
    const viewer = await getRequestViewer(request);
    if (!viewer) return unauthenticated();
    return json({ error: 'Send JSON-RPC requests with POST.' }, { status: 405, headers: { allow: 'POST' } });
  } catch (error) {
    const failure = operationFailure(error, 'MCP access could not be checked. Please try again.');
    return json({ error: failure.error }, { status: failure.status });
  }
}
