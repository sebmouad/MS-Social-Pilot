import { WorkspaceRole } from '@prisma/client';
import { z } from 'zod';

import { prisma } from './prisma';
import { hashToken, randomToken } from './crypto';
import { AuthError, ForbiddenError } from './auth';
import { scopeOf, type PageScope } from './page-access';
import { ensureSettings } from './settings';
import { errors } from './errors';
import { enabledModules, type ModuleKey } from './modules';

/**
 * Keys for the public API and the MCP endpoint.
 *
 * A key acts as the person who made it, in the workspace it was made in, with
 * that person's role and Page access as they stand *now* — demote someone and
 * their keys are demoted with them; remove them and their keys stop working.
 * A key adds one limit of its own: `read` keys cannot change anything.
 *
 * Shown once at creation and stored as a sha256, like sessions and share links.
 */

export const API_SCOPES = ['read', 'write'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const apiTokenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(API_SCOPES).default('read'),
});

const PREFIX = 'msp_';

export async function createApiToken(options: {
  workspaceId: string;
  userId: string;
  name: string;
  scope: ApiScope;
}): Promise<{ id: string; token: string }> {
  const token = `${PREFIX}${randomToken(32)}`;
  const row = await prisma.apiToken.create({
    data: {
      workspaceId: options.workspaceId,
      userId: options.userId,
      name: options.name,
      scope: options.scope,
      tokenHash: hashToken(token),
      prefix: token.slice(0, PREFIX.length + 6),
    },
  });
  return { id: row.id, token };
}

/** Refuse a call into a module root switched off for this key's owner. */
export function assertApiModule(ctx: Pick<ApiContext, 'modules'>, module: ModuleKey): void {
  if (!ctx.modules.includes(module)) throw errors.moduleOff();
}

export interface ApiContext {
  tokenId: string;
  scope: ApiScope;
  user: { id: string; name: string; email: string };
  workspace: { id: string; name: string; timezone: string; requiresApproval: boolean; defaultLocale: string };
  role: WorkspaceRole;
  pageScope: PageScope;
  /** The modules root left on for this key's owner (`src/lib/modules.ts`). */
  modules: ModuleKey[];
}

/** The caller behind `Authorization: Bearer msp_…`, or a 401. */
export async function requireApiToken(request: Request, need: ApiScope = 'read'): Promise<ApiContext> {
  await ensureSettings();
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(msp_[A-Za-z0-9_-]{20,80})$/.exec(header.trim());
  if (!match) throw new AuthError('Send an API key as "Authorization: Bearer msp_…".');

  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(match[1]!) },
    include: { user: true, workspace: true },
  });
  if (!row || row.revokedAt || row.user.disabledAt) throw new AuthError('That API key is not valid.');
  if (row.workspace.suspendedAt) throw errors.workspaceSuspended();
  // Root turned developer features off: keys stop working, without being revoked.
  if (!row.workspace.developerFeatures) throw errors.developerFeaturesOff();

  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: row.userId, workspaceId: row.workspaceId } },
    include: { pages: { select: { targetId: true } } },
  });
  if (!membership) throw new AuthError('That API key belongs to someone no longer in the workspace.');

  const scope = row.scope as ApiScope;
  if (need === 'write' && scope !== 'write') throw new ForbiddenError('This API key can only read.');

  // At most once a minute: a busy integration should not write on every call.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }

  return {
    tokenId: row.id,
    scope,
    user: { id: row.user.id, name: row.user.name, email: row.user.email },
    workspace: {
      id: row.workspace.id,
      name: row.workspace.name,
      timezone: row.workspace.timezone,
      requiresApproval: row.workspace.requiresApproval,
      defaultLocale: row.workspace.defaultLocale,
    },
    role: membership.role,
    pageScope: scopeOf(membership),
    modules: enabledModules(row.workspace.disabledModules, membership.disabledModules),
  };
}
