import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PAGES } from '@/lib/product';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';

export const runtime = 'nodejs';
const featureIds = PAGES.map(page => page.id);
const scopeList = z.array(z.enum(featureIds as [string, ...string[]])).max(featureIds.length);
const createSchema = z.object({ name: z.string().trim().min(1).max(100), readFeatures: scopeList, writeFeatures: scopeList, expiresInDays: z.number().int().positive() });

type KeyRow = { id: string; name: string; tokenPrefix: string; readFeatures: string[]; writeFeatures: string[]; expiresAt: Date; revokedAt: Date | null; createdAt: Date; lastUsedAt: Date | null };
class ActiveKeyLimitError extends Error {}

async function manager() {
  const viewer = await requireViewer({ feature: 'settings/mcp' });
  if (viewer.membership.role !== 'owner' && viewer.membership.role !== 'admin') throw new Error('Only workspace owners and admins can manage MCP keys.');
  return viewer;
}
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
function errorResponse(error: unknown, fallback: string) {
  if (error instanceof ActiveKeyLimitError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid MCP key request.' }, { status: 400 });
  if (error instanceof Error && error.message.includes('NEXT_REDIRECT')) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  if (error instanceof Error && error.message.includes('owners and admins')) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
async function audit(actorId: string, action: string, detail: Record<string, unknown>) {
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`mcp_key_${randomBytes(12).toString('hex')}`}, ${actorId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
}

export async function GET() {
  try {
    const viewer = await manager();
    const keys = await prisma.$queryRaw<KeyRow[]>`
      SELECT id, name, "tokenPrefix", "readFeatures", "writeFeatures", "expiresAt", "revokedAt", "createdAt", "lastUsedAt"
      FROM mcp_api_keys WHERE "workspaceId" = ${viewer.workspaceId} ORDER BY "createdAt" DESC
    `;
    return NextResponse.json({ keys }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return errorResponse(error, 'Could not load MCP keys.'); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  try {
    const viewer = await manager();
    const input = createSchema.parse(await request.json());
    const maxActive = await runtimeConfig('mcp.keys.maxActivePerWorkspace') as number;
    const maxLifetimeDays = await runtimeConfig('mcp.keys.maxLifetimeDays') as number;
    if (input.expiresInDays > maxLifetimeDays) return NextResponse.json({ error: `Key lifetime cannot exceed ${maxLifetimeDays} days.` }, { status: 400 });
    if (!input.readFeatures.length || input.writeFeatures.some(feature => !input.readFeatures.includes(feature))) return NextResponse.json({ error: 'Select at least one read feature; write features must also be selected for reading.' }, { status: 400 });
    if (input.readFeatures.some(feature => !canUseFeature(viewer.entitlements, feature) || !canAccessFeature(viewer.permissions, feature, 'read')) || input.writeFeatures.some(feature => !canUseFeature(viewer.entitlements, feature) || !canAccessFeature(viewer.permissions, feature, 'write'))) {
      return NextResponse.json({ error: 'Selected scopes exceed your current workspace permissions.' }, { status: 403 });
    }
    const id = `mcpkey_${randomBytes(12).toString('hex')}`;
    const token = `mcp_${randomBytes(32).toString('base64url')}`;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const tokenPrefix = token.slice(0, 12);
    const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${viewer.workspaceId}))::text`;
      const activeRows = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM mcp_api_keys WHERE "workspaceId" = ${viewer.workspaceId} AND "revokedAt" IS NULL AND "expiresAt" > NOW()
      `;
      if (Number(activeRows[0]?.count ?? 0) >= maxActive) throw new ActiveKeyLimitError(`This workspace has reached its limit of ${maxActive} active MCP keys.`);
      await tx.$executeRaw`
        INSERT INTO mcp_api_keys (id, "workspaceId", "createdById", name, "tokenHash", "tokenPrefix", "readFeatures", "writeFeatures", "expiresAt", "createdAt")
        VALUES (${id}, ${viewer.workspaceId}, ${viewer.user.id}, ${input.name}, ${tokenHash}, ${tokenPrefix},
          ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(input.readFeatures)}::jsonb)),
          ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(input.writeFeatures)}::jsonb)), ${expiresAt}, NOW())
      `;
      await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`mcp_key_${randomBytes(12).toString('hex')}`}, ${viewer.user.id}, 'mcp.key_created', ${JSON.stringify({ workspaceId: viewer.workspaceId, keyId: id, name: input.name, readFeatures: input.readFeatures, writeFeatures: input.writeFeatures, expiresAt: expiresAt.toISOString() })}::jsonb, NOW())`;
    });
    return NextResponse.json({ key: { id, name: input.name, tokenPrefix, readFeatures: input.readFeatures, writeFeatures: input.writeFeatures, expiresAt }, token }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) { return errorResponse(error, 'Could not create MCP key.'); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 });
  try {
    const viewer = await manager();
    const input = z.object({ id: z.string().min(1).max(100) }).parse(await request.json());
    const changed = await prisma.$executeRaw`
      UPDATE mcp_api_keys SET "revokedAt" = NOW() WHERE id = ${input.id} AND "workspaceId" = ${viewer.workspaceId} AND "revokedAt" IS NULL
    `;
    if (!changed) return NextResponse.json({ error: 'Active MCP key not found.' }, { status: 404 });
    await audit(viewer.user.id, 'mcp.key_revoked', { workspaceId: viewer.workspaceId, keyId: input.id });
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error, 'Could not revoke MCP key.'); }
}
