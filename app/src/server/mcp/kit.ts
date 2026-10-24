import { randomBytes } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '../data';
import type { McpViewer } from './types';

/**
 * Shared MCP host contract. Product modules declare tool groups with this shape in their own
 * mcp.ts; the host (server.ts) and scope policy only merge installed declarations.
 */
export type McpToolDefinition = { name: string; description: string; inputSchema: Record<string, unknown> };

export type McpResourceDeclaration = {
  uri: string; name: string; description: string; mimeType: 'application/json';
  /** Feature that must be entitled and readable; null for none. */
  feature: string | null;
  /** Read through this tool, with the same checks as calling it. */
  readTool: string; readArgs?: Record<string, unknown>;
  /** Listed and readable only for workspace owners and admins. */
  managerOnly?: boolean;
  /** Refuse with "Resource unavailable." before reading when feature/manager checks fail. */
  guardedRead?: boolean;
  /** Listed only while readTool is currently available in its group. */
  requiresAvailableTool?: boolean;
};

export type McpManagerRule = {
  tools: ReadonlySet<string>; message: string;
  /** Hide from tools/list for non-managers. */
  hideFromList?: boolean;
  /** Check before argument validation in tools/call. */
  beforeArguments?: boolean;
  /** Check again in the shared executor (also used by resource reads). */
  inExecutor?: boolean;
};

export type McpToolGroup = {
  id: string;
  tools: readonly McpToolDefinition[];
  /** Workspace feature that each tool requires. Every tool has one. */
  features: Readonly<Record<string, string>>;
  writeTools?: Iterable<string>;
  /** Writes whose service owns its workspace operation lock (no outer lock). */
  selfLockedWrites?: Iterable<string>;
  /** Reads that still run under the outer workspace operation lock. */
  lockedReads?: Iterable<string>;
  /** Writes that skip the shared purge-in-progress refusal (they own that check). */
  purgeCheckExempt?: Iterable<string>;
  managers?: readonly McpManagerRule[];
  /** Reviewed restricted-credential classification (see tool-policy.ts). */
  scope: { resourceTools?: readonly string[]; workspaceTools?: readonly string[]; resources?: readonly string[] };
  /** Wraps execution of the listed tools (error mapping). */
  errorBoundary?: { applies: (name: string) => boolean; wrap: <T>(run: () => Promise<T>) => Promise<T> };
  /** Run once per MCP message before handling. */
  init?: () => void;
  /** Current availability filter, used by tools/list, tools/call and resources/list. */
  available?: (viewer: McpViewer) => Promise<(name: string) => boolean>;
  /** Hide tools from tools/list without refusing calls. */
  listFilter?: (viewer: McpViewer) => Promise<(name: string) => boolean>;
  /** Extra tools/call refusal before argument validation. */
  beforeCall?: (viewer: McpViewer, name: string, isWrite: boolean) => void;
  execute: (viewer: McpViewer, name: string, args: Record<string, unknown>, cap: number) => Promise<unknown>;
  resources?: readonly McpResourceDeclaration[];
};

export const pageIdsFor = (viewer: McpViewer): string[] | undefined => viewer.permissions?.pageScope.all === false ? [...viewer.permissions.pageScope.ids] : undefined;
/** Independent Ads ceiling from the key; undefined (all/legacy keys) adds no account restriction, [] allows none. */
export const adsTargetIdsFor = (viewer: McpViewer): string[] | undefined => viewer.adAccountTargetScope ? (viewer.adAccountTargetScope.all ? undefined : [...viewer.adAccountTargetScope.ids]) : pageIdsFor(viewer);
export const adAccountIdsFor = (viewer: McpViewer): string[] | undefined => viewer.allowedAdAccountIds === undefined ? undefined : [...viewer.allowedAdAccountIds];
export const adsActorFor = (viewer: McpViewer) => ({ userId: viewer.userId, workspaceId: viewer.workspaceId, allowedTargetIds: adsTargetIdsFor(viewer), ...(viewer.allowedAdAccountIds === undefined ? {} : { allowedAdAccountIds: [...viewer.allowedAdAccountIds] }) });
/** Explicit actors: a bare viewer does not carry the key's resource ceiling into lifecycle services. */
export const publishingActor = (viewer: McpViewer) => {
  const allowedTargetIds = pageIdsFor(viewer);
  return { userId: viewer.userId, workspaceId: viewer.workspaceId, ...(allowedTargetIds === undefined ? {} : { allowedTargetIds }) };
};
export const inboxActor = (viewer: McpViewer) => {
  const allowedChannelIds = pageIdsFor(viewer);
  return { userId: viewer.userId, workspaceId: viewer.workspaceId, ...(allowedChannelIds === undefined ? {} : { allowedChannelIds }) };
};
export const analyticsActorFor = (viewer: McpViewer, cap: number) => ({ userId: viewer.userId, workspaceId: viewer.workspaceId, allowedChannelIds: pageIdsFor(viewer), ...(viewer.allowedAdAccountIds === undefined ? {} : { allowedAdAccountIds: viewer.allowedAdAccountIds }), ...(viewer.adAccountTargetScope ? { adAccountTargetScope: viewer.adAccountTargetScope } : {}), maxResultItems: cap });
export const canManageData = (viewer: McpViewer) => viewer.role === 'owner' || viewer.role === 'admin';

export function requireConfirmation(args: Record<string, unknown>, expected: string) {
  if (args.confirmation !== expected) throw new OperationError('invalid_request', `Confirmation required. Repeat the call with confirmation exactly: ${expected}`);
}

export function requiredString(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new OperationError('invalid_request', `${key} is required.`);
  return value.trim();
}

async function auditWrite(viewer: McpViewer, tool: string, detail: Record<string, unknown>) {
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`mcp_${randomBytes(12).toString('hex')}`}, ${viewer.userId}, 'mcp.write', ${JSON.stringify({ workspaceId: viewer.workspaceId, ...(viewer.apiKeyId ? { apiKeyId: viewer.apiKeyId } : {}), tool, ...detail })}::jsonb, NOW())`;
}

/** The service has returned an outcome. A secondary audit failure must not invite a duplicate write. */
export async function auditedReceipt<T extends Record<string, unknown>>(viewer: McpViewer, tool: string, detail: Record<string, unknown>, result: T) {
  try {
    await auditWrite(viewer, tool, detail);
    return { ...result, mcpAuditRecorded: true };
  } catch {
    // Deliberately exclude exception text, content, credentials and provider payloads.
    console.error('MCP action completed but its secondary audit record could not be saved.', { workspaceId: viewer.workspaceId, actorId: viewer.userId, tool });
    return { ...result, mcpAuditRecorded: false, warning: 'The action completed, but its MCP audit record could not be saved. Do not repeat the action; check its returned outcome and current state.' };
  }
}

export async function auditConfirmedAdsWrite(viewer: McpViewer, tool: string, detail: Record<string, unknown>) {
  try {
    await auditWrite(viewer, tool, detail);
    return true;
  } catch {
    console.error('MCP Ads creation succeeded but its audit record could not be saved.', { workspaceId: viewer.workspaceId, actorId: viewer.userId, tool, ...detail });
    return false;
  }
}

export function confirmedAdsReceipt(result: Record<string, unknown>, mcpAuditRecorded: boolean) {
  const auditRecorded = result.auditRecorded !== false;
  return {
    ...result,
    confirmedSuccess: true,
    auditRecorded,
    mcpAuditRecorded,
    ...(!auditRecorded || !mcpAuditRecorded ? {
      warning: 'Creation succeeded and the object is paused, but one or more audit records could not be saved. Do not submit this creation again.',
    } : {}),
  };
}
