import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { readLabelPage, createLabel, updateLabel, deleteLabel } from './server/labels';
import { LABEL_BOUNDS, LABEL_COLORS } from './labels-config';
import type { PublishingActor } from './server/types';

const labelFields = {
  name: { type: 'string', minLength: 1, maxLength: LABEL_BOUNDS.maxNameCharacters.max },
  color: { type: 'string', enum: [...LABEL_COLORS] },
  confirmation: { type: 'string' },
};
export const labelToolDefinitions = [
  { name: 'list_post_labels', description: 'List post labels in the current workspace with usage counts (posts, templates, content-mix rules). Usage counts are omitted when your channel access is restricted. Use the returned page metadata to continue.', inputSchema: { type: 'object', properties: { page: { type: 'integer', minimum: 1, maximum: 100000 }, q: { type: 'string', maxLength: LABEL_BOUNDS.maxSearchCharacters.max } }, additionalProperties: false } },
  { name: 'create_post_label', description: 'Create a workspace post label. Confirmation must exactly match CREATE LABEL <name>.', inputSchema: { type: 'object', required: ['name', 'confirmation'], properties: labelFields, additionalProperties: false } },
  { name: 'update_post_label', description: 'Rename or recolour a label for the whole workspace; requires access to all channels. Confirmation must exactly match UPDATE LABEL <id>.', inputSchema: { type: 'object', required: ['id', 'name', 'confirmation'], properties: { id: { type: 'string', maxLength: 80 }, ...labelFields }, additionalProperties: false } },
  { name: 'delete_post_label', description: 'Delete a label. It is detached from posts, cleared from templates and removes content-mix rules that use it; posts and templates are kept. Requires access to all channels. Confirmation must exactly match DELETE LABEL <id>.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string', maxLength: 80 }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;
export const labelTools = new Set<string>(labelToolDefinitions.map(tool => tool.name));
export const labelWriteTools = new Set<string>(['create_post_label', 'update_post_label', 'delete_post_label']);
const listSchema = z.object({ page: z.number().int().safe().min(1).max(100000).optional(), q: z.string().max(LABEL_BOUNDS.maxSearchCharacters.max).optional() }).strict();

export async function executeLabelTool(actor: PublishingActor, name: string, args: unknown) {
  if (name === 'list_post_labels') {
    const parsed = listSchema.safeParse(args ?? {});
    if (!parsed.success) throw new OperationError('invalid_request', 'Choose valid label search details.');
    return readLabelPage(actor, parsed.data);
  }
  if (name === 'create_post_label') return createLabel(actor, args);
  if (name === 'update_post_label') return updateLabel(actor, args);
  if (name === 'delete_post_label') return deleteLabel(actor, args);
  throw new OperationError('invalid_request', 'Choose a supported label action.');
}
