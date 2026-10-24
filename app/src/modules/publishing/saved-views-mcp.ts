import { OperationError } from '@/lib/operation-error';
import { createSavedView, deleteSavedView, listSavedViews } from './server/saved-views';
import { SAVED_VIEW_BOUNDS, SAVED_VIEW_SCREENS } from './saved-views';
import type { PublishingActor } from './server/types';

export const savedViewToolDefinitions = [
  { name: 'list_saved_views', description: 'List your own saved Posts or Calendar filter views in the current workspace. Each view returns a relative address; opening it re-applies your current channel access.', inputSchema: { type: 'object', required: ['screen'], properties: { screen: { type: 'string', enum: [...SAVED_VIEW_SCREENS] } }, additionalProperties: false } },
  { name: 'create_saved_view', description: 'Save a named Posts or Calendar filter combination for yourself. query uses that screen\'s filter parameters (posts: view, status, channel, q, origin; calendar: view, status, channel); unknown or invalid parameters are refused.', inputSchema: { type: 'object', required: ['screen', 'name', 'query'], properties: { screen: { type: 'string', enum: [...SAVED_VIEW_SCREENS] }, name: { type: 'string', minLength: 1, maxLength: SAVED_VIEW_BOUNDS.maxName }, query: { type: 'string', maxLength: SAVED_VIEW_BOUNDS.maxQuery } }, additionalProperties: false } },
  { name: 'delete_saved_view', description: 'Remove one of your saved views. Confirmation must exactly match DELETE SAVED VIEW <id>.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string', maxLength: 80 }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;
export const savedViewTools = new Set<string>(savedViewToolDefinitions.map(tool => tool.name));
export const savedViewWriteTools = new Set<string>(['create_saved_view', 'delete_saved_view']);

export async function executeSavedViewTool(actor: PublishingActor, name: string, args: unknown) {
  if (name === 'list_saved_views') return listSavedViews(actor, args ?? {});
  if (name === 'create_saved_view') return createSavedView(actor, args);
  if (name === 'delete_saved_view') return deleteSavedView(actor, args);
  throw new OperationError('invalid_request', 'Choose a supported saved view action.');
}
