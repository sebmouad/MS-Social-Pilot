import { z } from 'zod';
import type { PublishingActor } from '../types';
import { requestPostExport, readPostExport } from './jobs';
import type { McpToolGroup } from '@/server/mcp/kit';
import { publishingActor } from '@/server/mcp/kit';
const request = z.discriminatedUnion('action', [
 z.object({ action: z.literal('create'), filters: z.unknown(), confirmation: z.string() }).strict(),
 z.object({ action: z.enum(['status', 'download']), id: z.string().min(1) }).strict(),
]);
/** Session REST, key REST, UI action and MCP all dispatch here. */
export async function postExportAction(actor: PublishingActor, raw: unknown) {
 const input = request.parse(raw);
 return input.action === 'create' ? requestPostExport(actor, input.filters, input.confirmation) : readPostExport(actor, input.id, input.action === 'download');
}
export async function postExportHttp(actor: PublishingActor, req: Request) { return Response.json(await postExportAction(actor, await req.json())); }
export const ASYNC_POST_EXPORT_MCP: readonly McpToolGroup[] = [{ id: 'publishing-export-jobs', tools: [{ name: 'posts_export_job', description: 'Prepare, inspect or download a private background Posts CSV. Create requires EXPORT POSTS confirmation; expiry and current access apply to every download.', inputSchema: { type: 'object', required: ['action'], properties: { action: { enum: ['create','status','download'] }, id: { type: 'string' }, filters: { type: 'object' }, confirmation: { type: 'string' } }, additionalProperties: false } }], features: { posts_export_job: 'publishing/posts' }, writeTools: ['posts_export_job'], selfLockedWrites: ['posts_export_job'], scope: { resourceTools: ['posts_export_job'] }, execute: (viewer, _name, args) => postExportAction(publishingActor(viewer), args) }];

/** Read-only key holders can inspect/download their own artifacts without a write grant. */
export const ASYNC_POST_EXPORT_READ_MCP: readonly McpToolGroup[] = [{
 id: 'publishing-export-status',
 tools: [{ name: 'posts_export_status', description: 'Inspect or download your private background Posts CSV and bounded attempt history; current scope and expiry apply.', inputSchema: { type: 'object', required: ['action','id'], properties: { action: { enum: ['status','download'] }, id: { type: 'string' } }, additionalProperties: false } }],
 features: { posts_export_status: 'publishing/posts' }, scope: { resourceTools: ['posts_export_status'] },
 execute: (viewer, _name, args) => { const input = z.object({ action: z.enum(['status','download']), id: z.string().min(1) }).strict().parse(args); return postExportAction(publishingActor(viewer), input); },
}];
