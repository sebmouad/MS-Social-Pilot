import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { readTemplatePage, createTemplate, updateTemplate, deleteTemplate } from './server/templates';
import { TEMPLATE_CEILINGS } from './templates-config';
import type { PublishingActor } from './server/types';

const templateFields = {
  name: { type: 'string', minLength: 1, maxLength: TEMPLATE_CEILINGS.name },
  category: { type: 'string', maxLength: TEMPLATE_CEILINGS.category },
  body: { type: 'string', minLength: 1, maxLength: TEMPLATE_CEILINGS.body },
  hashtags: { type: 'string', maxLength: TEMPLATE_CEILINGS.hashtags },
  firstComment: { type: 'string', maxLength: TEMPLATE_CEILINGS.firstComment },
  firstCommentDelayMinutes: { type: 'integer', minimum: 0, description: 'Whole minutes before the saved first comment is sent; 0 means immediately after publication.' },
  labelId: { type: ['string', 'null'], maxLength: 80 },
  confirmation: { type: 'string' },
};
export const templateToolDefinitions = [
  { name: 'list_post_templates', description: 'List templates in the current workspace. Search by name, category or message and use the returned page metadata to continue. Template fields do not include media or links.', inputSchema: { type: 'object', properties: { page: { type: 'integer', minimum: 1 }, q: { type: 'string', maxLength: TEMPLATE_CEILINGS.search } }, additionalProperties: false } },
  { name: 'create_post_template', description: 'Create a workspace-shared reusable post template. Stores message, category, hashtags, first comment and optional workspace label; never publishes a post. Confirmation must exactly match CREATE TEMPLATE <name>.', inputSchema: { type: 'object', required: ['name', 'body', 'confirmation'], properties: templateFields, additionalProperties: false } },
  { name: 'update_post_template', description: 'Update one current-workspace template. Confirmation must exactly match UPDATE TEMPLATE <id>.', inputSchema: { type: 'object', required: ['id', 'name', 'body', 'confirmation'], properties: { id: { type: 'string', maxLength: 80 }, ...templateFields }, additionalProperties: false } },
  { name: 'delete_post_template', description: 'Delete a reusable template in the current workspace; posts already created from it are unchanged. Confirmation must exactly match DELETE TEMPLATE <id>.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string', maxLength: 80 }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;
export const templateTools = new Set(templateToolDefinitions.map(tool => tool.name));
export const templateWriteTools = new Set(['create_post_template', 'update_post_template', 'delete_post_template']);
const listSchema = z.object({ page: z.number().int().min(1).optional(), q: z.string().max(TEMPLATE_CEILINGS.search).optional() }).strict();

export async function executeTemplateTool(actor: PublishingActor, name: string, args: unknown) {
  if (name === 'list_post_templates') {
    const parsed = listSchema.safeParse(args);
    if (!parsed.success) throw new OperationError('invalid_request', 'Choose valid template search details.');
    return readTemplatePage(actor, parsed.data);
  }
  if (name === 'create_post_template') return createTemplate(actor, args);
  if (name === 'update_post_template') return updateTemplate(actor, args);
  if (name === 'delete_post_template') return deleteTemplate(actor, args);
  throw new OperationError('invalid_request', 'Choose a supported template action.');
}
