import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { TEMPLATE_CEILINGS } from './templates-config';

const clean = (max: number) => z.string().trim().max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Control characters are not allowed.');
export const TEMPLATE_ID_SCHEMA = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
export const TEMPLATE_SEARCH_SCHEMA = z.object({ q: clean(TEMPLATE_CEILINGS.search).optional(), page: z.number().int().min(1).max(100000).optional() }).strict();
export const TEMPLATE_INPUT_SCHEMA = z.object({
  name: clean(TEMPLATE_CEILINGS.name).refine(value => value.length > 0, 'Enter a name.'),
  category: clean(TEMPLATE_CEILINGS.category).default(''),
  body: clean(TEMPLATE_CEILINGS.body).refine(value => value.length > 0, 'Enter a message.'),
  hashtags: clean(TEMPLATE_CEILINGS.hashtags).default(''),
  firstComment: clean(TEMPLATE_CEILINGS.firstComment).default(''),
  labelId: z.string().max(80).nullable().default(null),
}).strict();
export type TemplateInput = z.infer<typeof TEMPLATE_INPUT_SCHEMA>;
export type TemplateRecord = TemplateInput & { id: string; createdAt: Date; updatedAt: Date };
export const TEMPLATE_CREATE_SCHEMA = TEMPLATE_INPUT_SCHEMA.extend({ confirmation: z.string() }).strict();
export const TEMPLATE_UPDATE_SCHEMA = TEMPLATE_INPUT_SCHEMA.extend({ id: TEMPLATE_ID_SCHEMA, confirmation: z.string() }).strict();
export const TEMPLATE_DELETE_SCHEMA = z.object({ id: TEMPLATE_ID_SCHEMA, confirmation: z.string() }).strict();

export const createTemplateConfirmation = (name: string) => `CREATE TEMPLATE ${name}`;
export const updateTemplateConfirmation = (id: string) => `UPDATE TEMPLATE ${id}`;
export const deleteTemplateConfirmation = (id: string) => `DELETE TEMPLATE ${id}`;

export function parseTemplateInput(input: unknown): TemplateInput {
  const checked = TEMPLATE_INPUT_SCHEMA.safeParse(input);
  if (!checked.success) throw new OperationError('invalid_request', 'Choose valid template details.');
  return checked.data;
}
