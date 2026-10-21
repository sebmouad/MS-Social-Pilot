import { mediaError } from './server/messages';
import { auditedReceipt, pageIdsFor, type McpToolGroup } from '@/server/mcp/kit';
import { deleteAsset, importFromUrl, readLibrary, type MediaDeps } from './server/library';
import type { ToolActor } from './server/access';
import { MEDIA_FEATURE_ID } from './manifest';
import { MEDIA_BOUNDS } from './config';

export const mediaToolDefinitions = [
  { name: 'list_media_library', description: 'List images and videos in the current workspace media library with storage usage against the workspace quota. Filter by kind, usage (used or unused) and literal file-name search; continue with page while hasMore is true. A member limited to some channels sees usage only as used or unused, not which posts hold an asset.', inputSchema: { type: 'object', properties: { kind: { enum: ['image', 'video'] }, q: { type: 'string', maxLength: MEDIA_BOUNDS.maxSearchCharacters.max }, usage: { enum: ['used', 'unused'] }, page: { type: 'integer', minimum: 1, maximum: MEDIA_BOUNDS.pageNumberMax.max } }, additionalProperties: false } },
  { name: 'import_media_from_url', description: 'Import one public image or video into the workspace library. Only public https addresses are fetched; private networks are refused, and size, type and quota limits are enforced. Confirmation must exactly match IMPORT MEDIA <url>.', inputSchema: { type: 'object', required: ['url', 'confirmation'], properties: { url: { type: 'string', maxLength: MEDIA_BOUNDS.importUrlMaxCharacters.max }, name: { type: 'string', maxLength: MEDIA_BOUNDS.assetNameMaxCharacters.max }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_media_asset', description: 'Delete one library asset. Refused while any post uses it unless allowInUse is true, and never while a using post is scheduled, publishing or awaiting approval. Requires access to all channels. Confirmation must exactly match DELETE MEDIA <id>, or DELETE IN-USE MEDIA <id> with allowInUse.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string', maxLength: MEDIA_BOUNDS.identifierMaxCharacters.max }, allowInUse: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;
export const mediaTools = new Set<string>(mediaToolDefinitions.map(tool => tool.name));
export const mediaWriteTools = new Set<string>(['import_media_from_url', 'delete_media_asset']);

export async function executeMediaTool(actor: ToolActor, name: string, args: unknown, deps: MediaDeps = {}) {
  if (name === 'list_media_library') return readLibrary(actor, args ?? {}, deps);
  if (name === 'import_media_from_url') return importFromUrl(actor, args, deps);
  if (name === 'delete_media_asset') return deleteAsset(actor, args, deps);
  throw await mediaError('invalid_request', 'Choose a supported media action.');
}

/**
 * MCP tool group of the media library. Every tool is workspace-wide (a library asset is not a
 * channel resource), so a credential restricted to selected channels cannot list, import or delete.
 * Writes need the exact confirmation, which the service re-checks; the service owns its workspace lock.
 */
export const MEDIA_MCP: readonly McpToolGroup[] = [{
  id: 'media-library',
  tools: mediaToolDefinitions,
  features: { list_media_library: MEDIA_FEATURE_ID, import_media_from_url: MEDIA_FEATURE_ID, delete_media_asset: MEDIA_FEATURE_ID },
  writeTools: [...mediaWriteTools],
  selfLockedWrites: [...mediaWriteTools],
  scope: { workspaceTools: [...mediaTools] },
  resources: [
    { uri: 'msp://media/library', name: 'Media library', description: 'First page of workspace images and videos with storage usage. Continue pages with list_media_library.', mimeType: 'application/json', feature: MEDIA_FEATURE_ID, readTool: 'list_media_library' },
  ],
  execute: async (viewer, name, args, cap) => {
    const actor: ToolActor = { userId: viewer.userId, workspaceId: viewer.workspaceId, ...(pageIdsFor(viewer) ? { allowedTargetIds: pageIdsFor(viewer)! } : {}) };
    const result = await executeMediaTool(actor, name, args);
    if (name === 'list_media_library') {
      const page = result as Awaited<ReturnType<typeof readLibrary>>;
      const limit = Math.max(1, cap);
      return page.items.length > limit ? { ...page, items: page.items.slice(0, limit), hasMore: true, truncatedByCredential: true } : page;
    }
    if (name === 'import_media_from_url') {
      const imported = result as Awaited<ReturnType<typeof importFromUrl>>;
      return auditedReceipt(viewer, name, { assetId: imported.id, kind: imported.kind, size: imported.size }, imported);
    }
    const removed = result as Awaited<ReturnType<typeof deleteAsset>>;
    return auditedReceipt(viewer, name, { assetId: removed.id, affectedPosts: removed.affectedPosts }, removed);
  },
}];
