import { OperationError } from '@/lib/operation-error';
import { deleteAsset, importFromUrl, readLibrary, type MediaDeps } from './server/library';
import type { ToolActor } from './server/access';

export const mediaToolDefinitions = [
  { name: 'list_media_library', description: 'List images and videos in the current workspace media library with storage usage against the workspace quota. A member limited to some channels sees usage only as used or unused, not which posts hold an asset.', inputSchema: { type: 'object', properties: { kind: { enum: ['image', 'video'] }, q: { type: 'string', maxLength: 500 }, usage: { enum: ['used', 'unused'] }, page: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'import_media_from_url', description: 'Import one public image or video into the workspace library. Only public https addresses are fetched; private networks are refused, and size, type and quota limits are enforced. Confirmation must exactly match IMPORT MEDIA <url>.', inputSchema: { type: 'object', required: ['url', 'confirmation'], properties: { url: { type: 'string', maxLength: 2048 }, name: { type: 'string', maxLength: 180 }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_media_asset', description: 'Delete one library asset. Refused while any post uses it unless allowInUse is true, and never while a using post is scheduled, publishing or awaiting approval. Requires access to all channels. Confirmation must exactly match DELETE MEDIA <id>, or DELETE IN-USE MEDIA <id> with allowInUse.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string', maxLength: 80 }, allowInUse: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;
export const mediaTools = new Set<string>(mediaToolDefinitions.map(tool => tool.name));
export const mediaWriteTools = new Set<string>(['import_media_from_url', 'delete_media_asset']);

export async function executeMediaTool(actor: ToolActor, name: string, args: unknown, deps: MediaDeps = {}) {
  if (name === 'list_media_library') return readLibrary(actor, args ?? {}, deps);
  if (name === 'import_media_from_url') return importFromUrl(actor, args, deps);
  if (name === 'delete_media_asset') return deleteAsset(actor, args, deps);
  throw new OperationError('invalid_request', 'Choose a supported media action.');
}
