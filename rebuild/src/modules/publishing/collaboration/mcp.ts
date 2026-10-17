import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import type { PublishingActor } from '../server/types';
import { collaborationCapabilities } from './ports';
import { readCollaborationLabels } from './server/label-choices';
import { assignLabels, readPostLabels } from './server/assignments';
import { createCustomField, deleteCustomField, readCustomFields, readPostFieldValues, setPostFieldValues, updateCustomField } from './server/custom-fields';
import { readContentMix, saveContentMix } from './server/content-mix';
import { addPostNote, deletePostNote, readPostNotes } from './server/notes';
import { readQueueSlots, replaceQueueSlots } from './server/queue-slots';
import { readRecycle, setRecycle } from './server/recycle';
import { readPostVersions, requestVersionRestore } from './server/versions';

const id = { type: 'string', minLength: 1, maxLength: 80 } as const;
const confirmation = { type: 'string', description: 'Exact confirmation text named in the tool description.' } as const;
const slot = { type: 'object', required: ['dayOfWeek', 'hour', 'minute'], properties: { dayOfWeek: { type: 'integer', minimum: 0, maximum: 6 }, hour: { type: 'integer', minimum: 0, maximum: 23 }, minute: { type: 'integer', minimum: 0, maximum: 59 } }, additionalProperties: false } as const;
const obj = (properties: object, required: string[] = []) => ({ type: 'object', required, properties, additionalProperties: false }) as const;

/** MCP tools for the collaboration slice. Not wired: the MCP host registers and routes them. */
export const collaborationToolDefinitions = [
  { name: 'get_post_labels', description: 'Read labels currently associated with one visible post.', inputSchema: obj({ postId: id }, ['postId']) },
  { name: 'list_post_label_choices', description: 'Paged workspace label choices for authorized post organization; continue while hasMore is true.', inputSchema: obj({ page: { type: 'integer', minimum: 1 } }) },
  { name: 'assign_post_labels', description: 'Add, remove or replace (mode add|remove|set) labels on up to the workspace bulk limit of posts, atomically. Posts must be visible and editable by you. Confirmation must exactly match "<MODE> LABELS ON <n> POST(S)", for example "ADD LABELS ON 3 POSTS".', inputSchema: obj({ postIds: { type: 'array', items: id, minItems: 1 }, labelIds: { type: 'array', items: id }, mode: { type: 'string', enum: ['add', 'remove', 'set'] }, confirmation }, ['postIds', 'labelIds', 'mode', 'confirmation']) },
  { name: 'list_custom_fields', description: 'List the workspace custom post fields (text or choice).', inputSchema: obj({}) },
  { name: 'create_custom_field', description: 'Create a custom post field; owners and admins with access to all channels. Confirmation must exactly match CREATE FIELD <name>.', inputSchema: obj({ name: { type: 'string' }, kind: { type: 'string', enum: ['text', 'choice'] }, options: { type: 'array', items: { type: 'string' } }, confirmation }, ['name', 'kind', 'confirmation']) },
  { name: 'update_custom_field', description: 'Rename or change a custom field. Refused while posts hold a value outside the new options. Confirmation must exactly match UPDATE FIELD <id>.', inputSchema: obj({ id, name: { type: 'string' }, kind: { type: 'string', enum: ['text', 'choice'] }, options: { type: 'array', items: { type: 'string' } }, confirmation }, ['id', 'name', 'kind', 'confirmation']) },
  { name: 'delete_custom_field', description: 'Delete a custom field and every value posts hold for it. Confirmation must exactly match DELETE FIELD <id>.', inputSchema: obj({ id, confirmation }, ['id', 'confirmation']) },
  { name: 'get_post_field_values', description: 'Custom field definitions with the values one post holds.', inputSchema: obj({ postId: id }, ['postId']) },
  { name: 'set_post_field_values', description: 'Set or clear (empty string) custom field values on a post. Confirmation must exactly match SET POST FIELDS <postId>.', inputSchema: obj({ postId: id, values: { type: 'object', additionalProperties: { type: 'string' } }, confirmation }, ['postId', 'values', 'confirmation']) },
  { name: 'list_post_notes', description: 'Internal team notes on a post, newest first, and the members who can be mentioned. Notes are never published.', inputSchema: obj({ postId: id, page: { type: 'integer', minimum: 1 } }, ['postId']) },
  { name: 'add_post_note', description: 'Add an internal note to a post. Mention members by id and include "@Name" in the text. Confirmation must exactly match ADD NOTE <postId>.', inputSchema: obj({ postId: id, body: { type: 'string' }, mentionIds: { type: 'array', items: id }, confirmation }, ['postId', 'body', 'confirmation']) },
  { name: 'delete_post_note', description: 'Delete a note you wrote, or any note as an editor or above. Confirmation must exactly match DELETE NOTE <noteId>.', inputSchema: obj({ noteId: id, confirmation }, ['noteId', 'confirmation']) },
  { name: 'list_post_versions', description: 'Saved versions of a post, newest first.', inputSchema: obj({ postId: id, page: { type: 'integer', minimum: 1 } }, ['postId']) },
  { name: 'restore_post_version', description: 'Apply an earlier version of a post as an ordinary save (validation and approvals apply). Only available when the host provides it. Confirmation must exactly match RESTORE VERSION <versionId>.', inputSchema: obj({ postId: id, versionId: id, confirmation }, ['postId', 'versionId', 'confirmation']) },
  { name: 'list_queue_times', description: 'Weekly queue times: shared times and the own times of your channels. dayOfWeek 0 is Sunday.', inputSchema: obj({ targetId: id }) },
  { name: 'replace_queue_times', description: 'Replace one timetable (targetId null for the shared one). Owners and admins only; shared times need access to all channels. Confirmation must exactly match "REPLACE QUEUE TIMES <targetId>" or "REPLACE QUEUE TIMES SHARED".', inputSchema: obj({ targetId: { anyOf: [id, { type: 'null' }] }, slots: { type: 'array', items: slot }, confirmation }, ['targetId', 'slots', 'confirmation']) },
  { name: 'get_content_mix', description: 'Weekly content-mix rules per channel or group with planned counts and ready drafts for the rolling window.', inputSchema: obj({}) },
  { name: 'save_content_mix', description: 'Replace the label rules of one channel or group. Owners and admins only; groups need access to all channels. Confirmation must exactly match SAVE CONTENT MIX <targetId or groupId>.', inputSchema: obj({ scope: obj({ targetId: id, groupId: id }), rules: { type: 'array', items: obj({ labelId: id, perWeek: { type: 'integer', minimum: 1 } }, ['labelId', 'perWeek']) }, confirmation }, ['scope', 'rules', 'confirmation']) },
  { name: 'get_post_recycle', description: 'Recycle (repeat) settings of a post. Only available when the host runs recycling.', inputSchema: obj({ postId: id }, ['postId']) },
  { name: 'set_post_recycle', description: 'Turn repeating on or off, set interval, repeat limit and alternate wordings. Confirmation must exactly match SET RECYCLE <postId>.', inputSchema: obj({ postId: id, enabled: { type: 'boolean' }, everyDays: { type: 'integer', minimum: 1 }, limit: { type: ['integer', 'null'], minimum: 1 }, variants: { type: 'array', items: { type: 'string' } }, confirmation }, ['postId', 'enabled', 'confirmation']) },
] as const;

export const collaborationTools = new Set<string>(collaborationToolDefinitions.map(tool => tool.name));
export const collaborationWriteTools = new Set<string>(['assign_post_labels', 'create_custom_field', 'update_custom_field', 'delete_custom_field', 'set_post_field_values', 'add_post_note', 'delete_post_note', 'restore_post_version', 'replace_queue_times', 'save_content_mix', 'set_post_recycle']);

/** Tools the host should advertise now: abilities that need a host port are absent until it is registered. */
export function availableCollaborationTools() {
  const caps = collaborationCapabilities();
  return collaborationToolDefinitions.filter(tool => (tool.name !== 'restore_post_version' || caps.versionRestore) && (!['list_queue_times', 'replace_queue_times'].includes(tool.name) || caps.queueTimes) && (!['get_content_mix', 'save_content_mix'].includes(tool.name) || caps.contentMix) && (!['get_post_recycle', 'set_post_recycle'].includes(tool.name) || caps.recycle));
}

async function dispatchCollaborationTool(actor: PublishingActor, name: string, args: unknown, maxResultItems?: number) {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'get_post_labels': return readPostLabels(actor, a.postId);
    case 'list_post_label_choices': {
      if (Object.keys(a).some(key => key !== 'page') || (a.page !== undefined && (!Number.isSafeInteger(a.page) || Number(a.page) < 1 || Number(a.page) > 100000))) throw new OperationError('invalid_request', 'Choose a valid label page.');
      const configured = await runtimeConfig('publishing.labelPageSize');
      if (!Number.isSafeInteger(configured) || configured < 1) throw new OperationError('unavailable', 'Labels are temporarily unavailable.');
      const pageSize = Math.min(configured, maxResultItems ?? configured), page = Number(a.page ?? 1);
      const result = await readCollaborationLabels(actor);
      return { labels: result.labels.slice((page - 1) * pageSize, page * pageSize), page, pageSize, hasMore: result.labels.length > page * pageSize, total: result.labels.length };
    }
    case 'assign_post_labels': return assignLabels(actor, args);
    case 'list_custom_fields': return { fields: await readCustomFields(actor) };
    case 'create_custom_field': return createCustomField(actor, args);
    case 'update_custom_field': return updateCustomField(actor, args);
    case 'delete_custom_field': return deleteCustomField(actor, args);
    case 'get_post_field_values': return readPostFieldValues(actor, a.postId);
    case 'set_post_field_values': return setPostFieldValues(actor, args);
    case 'list_post_notes': return readPostNotes(actor, args);
    case 'add_post_note': return addPostNote(actor, args);
    case 'delete_post_note': return deletePostNote(actor, args);
    case 'list_post_versions': return readPostVersions(actor, args);
    case 'restore_post_version': return requestVersionRestore(actor, args);
    case 'list_queue_times': return readQueueSlots(actor, args);
    case 'replace_queue_times': return replaceQueueSlots(actor, args);
    case 'get_content_mix': return readContentMix(actor);
    case 'save_content_mix': return saveContentMix(actor, args);
    case 'get_post_recycle': return readRecycle(actor, args);
    case 'set_post_recycle': return setRecycle(actor, args);
    default: throw new OperationError('invalid_request', 'Choose a supported collaboration action.');
  }
}

/** Host result ceilings never silently shorten a complete field directory or mutation receipt. */
export async function executeCollaborationTool(actor: PublishingActor, name: string, args: unknown, maxResultItems?: number) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new OperationError('invalid_request', 'Enter valid action details.');
  const a = args as Record<string, unknown>;
  const keys = name === 'list_custom_fields' || name === 'get_content_mix' ? [] : ['get_post_field_values', 'get_post_labels'].includes(name) ? ['postId'] : null;
  if (keys && Object.keys(a).some(key => !keys.includes(key))) throw new OperationError('invalid_request', 'Choose valid action details.');
  if (maxResultItems !== undefined && (!Number.isSafeInteger(maxResultItems) || maxResultItems < 1)) throw new OperationError('unavailable', 'This action is temporarily unavailable.');
  if (maxResultItems !== undefined && collaborationWriteTools.has(name) && ['postIds', 'labelIds', 'mentionIds'].some(key => Array.isArray(a[key]) && a[key].length > maxResultItems)) throw new OperationError('invalid_request', 'The selection exceeds the current result limit.');
  const result = await dispatchCollaborationTool(actor, name, args, maxResultItems);
  if (maxResultItems !== undefined && !collaborationWriteTools.has(name) && result && typeof result === 'object') {
    for (const value of Object.values(result)) if (Array.isArray(value) && value.length > maxResultItems) throw new OperationError('invalid_request', 'The complete result exceeds the current result limit. Narrow the request or ask an administrator to raise the limit.');
  }
  return result;
}
