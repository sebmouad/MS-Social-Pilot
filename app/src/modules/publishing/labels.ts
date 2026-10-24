import { z } from 'zod';
import { LABEL_BOUNDS, LABEL_COLORS } from './labels-config';

const clean = (max: number) => z.string().trim().max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Control characters are not allowed.');
export const LABEL_ID_SCHEMA = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
export const LABEL_COLOR_SCHEMA = z.enum(LABEL_COLORS);
export const LABEL_SEARCH_SCHEMA = z.object({ q: clean(LABEL_BOUNDS.maxSearchCharacters.max).optional(), page: z.number().int().safe().min(1).max(100000).optional() }).strict();
export const LABEL_INPUT_SCHEMA = z.object({
  name: clean(LABEL_BOUNDS.maxNameCharacters.max).refine(value => value.length > 0, 'Enter a name.'),
  color: LABEL_COLOR_SCHEMA.default('blue'),
}).strict();
export type LabelInput = z.infer<typeof LABEL_INPUT_SCHEMA>;
export type LabelUsage = { posts: number; templates: number; contentMixRules: number };
/** `usage` is null when the caller's channel scope hides part of the workspace-wide picture. */
export type LabelRecord = { id: string; name: string; color: string; createdAt: Date; usage: LabelUsage | null };
export const LABEL_CREATE_SCHEMA = LABEL_INPUT_SCHEMA.extend({ confirmation: z.string() }).strict();
export const LABEL_UPDATE_SCHEMA = LABEL_INPUT_SCHEMA.extend({ id: LABEL_ID_SCHEMA, confirmation: z.string() }).strict();
export const LABEL_DELETE_SCHEMA = z.object({ id: LABEL_ID_SCHEMA, confirmation: z.string() }).strict();

export const createLabelConfirmation = (name: string) => `CREATE LABEL ${name.trim()}`;
export const updateLabelConfirmation = (id: string) => `UPDATE LABEL ${id}`;
export const deleteLabelConfirmation = (id: string) => `DELETE LABEL ${id}`;

/** Plain-language consequence of removing a label, shared by UI, API and MCP text. */
export function describeLabelRemoval(usage: LabelUsage | null): string {
  if (!usage) return 'Removing a label detaches it from every post in the workspace, clears it from templates, and removes content-mix rules that use it. Posts, templates and their content are kept.';
  return `Removing this label detaches it from ${usage.posts} post${usage.posts === 1 ? '' : 's'}, clears it from ${usage.templates} template${usage.templates === 1 ? '' : 's'}, and removes ${usage.contentMixRules} content-mix rule${usage.contentMixRules === 1 ? '' : 's'}. Posts, templates and their content are kept.`;
}
