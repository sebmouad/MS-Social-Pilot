import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { hashLegacySessionToken, isUsableLegacySession, LEGACY_SESSION_COOKIE } from '@/server/auth';
import { getSessionByTokenHash, listWorkspaces, prisma } from '@/server/data';
import { loadEntitlements } from '@/server/entitlements';
import { handleMcpMessage, type McpViewer } from '@/server/mcp/server';
import { runtimeConfig } from '@/server/config/store';
import { hit } from '@/server/rate-limit';
import { loadPermissions } from '@/server/permissions/loader';
import type { ScopedPermissions } from '@/server/permissions';

type ApiKeyRow = { id: string; workspaceId: string; createdById: string; readFeatures: string[]; writeFeatures: string[] };

function restrictPermissions(permissions: ScopedPermissions, readFeatures: string[], writeFeatures: string[]): ScopedPermissions {
  const reads = new Set(readFeatures);
  const writes = new Set(writeFeatures);
  const features = Object.fromEntries(Object.entries(permissions.features).map(([feature, access]) => [feature, {
    read: access.read && reads.has(feature),
    write: access.write && reads.has(feature) && writes.has(feature),
  }])) as ScopedPermissions['features'];
  const modules = Object.fromEntries(Object.entries(permissions.modules).map(([module, access]) => {
    const childFeatures = Object.entries(features).filter(([feature]) => feature.startsWith(`${module}/`)).map(([, feature]) => feature);
    return [module, { read: access.read && childFeatures.some(feature => feature.read), write: access.write && childFeatures.some(feature => feature.write) }];
  })) as ScopedPermissions['modules'];
  return { ...permissions, features, modules, visibleFeatures: permissions.visibleFeatures.filter(feature => reads.has(feature)), visibleModules: permissions.visibleModules.filter(module => modules[module].read) };
}

async function getViewer(): Promise<McpViewer | null> {
  if (await runtimeConfig('mcp.enabled') !== true) return null;
  const jar = await cookies();
  const token = jar.get(LEGACY_SESSION_COOKIE)?.value;
  const hash = token ? hashLegacySessionToken(token) : null;
  if (!hash) return null;
  const session = await getSessionByTokenHash(hash);
  if (!isUsableLegacySession(session, undefined)) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, isInstanceOwner: true } });
  if (!user) return null;
  const workspaces = await listWorkspaces(user.id);
  const selected = jar.get('sp_workspace')?.value;
  const membership = workspaces.find(item => item.workspace.id === selected) ?? workspaces.find(item => item.role === 'owner' || item.role === 'admin') ?? workspaces[0];
  const configuredRoles = await runtimeConfig('mcp.authenticatedRoles') as unknown;
  const roles = Array.isArray(configuredRoles) ? configuredRoles : ['owner', 'admin'];
  if (!membership || !roles.includes(membership.role)) return null;
  const entitlements = await loadEntitlements(user.id, membership.workspace.id);
  const permissions = await loadPermissions(user.id, membership.workspace.id);
  if (!entitlements || !permissions) return null;
  const maxResultItems = await runtimeConfig('mcp.maxResultItems') as number;
  return { userId: user.id, workspaceId: membership.workspace.id, role: membership.role, workspace: membership.workspace, entitlements, permissions, maxResultItems, isInstanceOwner: user.isInstanceOwner };
}

async function getBearerViewer(request: Request): Promise<McpViewer | null> {
  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer\s+(mcp_[A-Za-z0-9_-]{40,})$/);
  if (!match || await runtimeConfig('mcp.enabled') !== true) return null;
  const tokenHash = createHash('sha256').update(match[1]).digest('hex');
  const rows = await prisma.$queryRaw<ApiKeyRow[]>`
    SELECT id, "workspaceId", "createdById", "readFeatures", "writeFeatures"
    FROM mcp_api_keys
    WHERE "tokenHash" = ${tokenHash} AND "revokedAt" IS NULL AND "expiresAt" > NOW()
    LIMIT 1
  `;
  const key = rows[0];
  if (!key) return null;
  const user = await prisma.user.findUnique({ where: { id: key.createdById }, select: { id: true, disabledAt: true } });
  if (!user || user.disabledAt) return null;
  const membership = (await listWorkspaces(user.id)).find(item => item.workspace.id === key.workspaceId);
  if (!membership) return null;
  const configuredRoles = await runtimeConfig('mcp.authenticatedRoles') as unknown;
  const roles = Array.isArray(configuredRoles) ? configuredRoles : ['owner', 'admin'];
  if (!roles.includes(membership.role)) return null;
  const entitlements = await loadEntitlements(user.id, key.workspaceId);
  const currentPermissions = await loadPermissions(user.id, key.workspaceId);
  if (!entitlements || !currentPermissions) return null;
  const maxResultItems = await runtimeConfig('mcp.maxResultItems') as number;
  await prisma.$executeRaw`UPDATE mcp_api_keys SET "lastUsedAt" = NOW() WHERE id = ${key.id}`;
  return { userId: user.id, workspaceId: key.workspaceId, role: membership.role, workspace: membership.workspace, entitlements, permissions: restrictPermissions(currentPermissions, key.readFeatures, key.writeFeatures), maxResultItems, apiKeyId: key.id };
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
  const viewer = request.headers.has('authorization') ? await getBearerViewer(request) : await getViewer();
  if (!viewer) return unauthenticated();
  const requestsPerMinute = await runtimeConfig(viewer.apiKeyId ? 'mcp.keys.requestsPerMinute' : 'mcp.requestsPerMinute') as number;
  const rateKey = viewer.apiKeyId ? `mcp:key:${viewer.apiKeyId}` : `mcp:${viewer.workspaceId}:${viewer.userId}`;
  if (!hit(rateKey, { limit: requestsPerMinute, windowMs: 60_000 }).allowed) {
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

export async function GET(request: Request) {
  const viewer = request.headers.has('authorization') ? await getBearerViewer(request) : await getViewer();
  if (!viewer) return unauthenticated();
  return NextResponse.json({ error: 'Send JSON-RPC requests with POST.' }, { status: 405, headers: { allow: 'POST' } });
}
