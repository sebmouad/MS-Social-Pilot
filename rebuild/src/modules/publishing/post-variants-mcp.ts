import { OperationError } from '@/lib/operation-error';
import { postVariants } from './server/post-variants';
import type { PublishingActor } from './server/types';

export const variantToolDefinitions = [
  { name: 'list_post_variants', description: 'List a post’s per-language text variants and show which text each destination receives: the variant matching its effective language (its own locale, else the workspace default), else the default text.', inputSchema: { type: 'object', required: ['postId'], properties: { postId: { type: 'string', maxLength: 200 } }, additionalProperties: false } },
  { name: 'save_post_variant', description: 'Save a post’s text variant for one language (BCP 47 short tag such as en or fr-CA); replaces any variant for that language. Variants are text-only; media stays shared. Confirmation must exactly match ADD VARIANT <postId> <locale>.', inputSchema: { type: 'object', required: ['postId', 'locale', 'message', 'confirmation'], properties: { postId: { type: 'string', maxLength: 200 }, locale: { type: 'string', maxLength: 12 }, message: { type: 'string', maxLength: 100000 }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_post_variant', description: 'Remove a post’s text variant for one language; the destination falls back to the default text. Confirmation must exactly match REMOVE VARIANT <postId> <locale>.', inputSchema: { type: 'object', required: ['postId', 'locale', 'confirmation'], properties: { postId: { type: 'string', maxLength: 200 }, locale: { type: 'string', maxLength: 12 }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'set_destination_locale', description: 'Set or clear a destination’s own language (BCP 47 short tag, or null to follow the workspace default) used for variant selection. Confirmation must exactly match SET DESTINATION LOCALE <targetId>.', inputSchema: { type: 'object', required: ['targetId', 'confirmation'], properties: { targetId: { type: 'string', maxLength: 200 }, locale: { type: ['string', 'null'], maxLength: 12 }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;
export const variantTools = new Set<string>(variantToolDefinitions.map(tool => tool.name));
export const variantWriteTools = new Set<string>(['save_post_variant', 'delete_post_variant', 'set_destination_locale']);

export async function executeVariantTool(actor: PublishingActor, name: string, args: unknown) {
  const input = (args ?? {}) as Record<string, unknown>;
  if (name === 'list_post_variants') return postVariants(actor, { action: 'list', postId: input.postId });
  if (name === 'save_post_variant') return postVariants(actor, { action: 'add', postId: input.postId, locale: input.locale, message: input.message, confirmation: input.confirmation });
  if (name === 'delete_post_variant') return postVariants(actor, { action: 'remove', postId: input.postId, locale: input.locale, confirmation: input.confirmation });
  if (name === 'set_destination_locale') return postVariants(actor, { action: 'destination-locale', targetId: input.targetId, locale: input.locale ?? null, confirmation: input.confirmation });
  throw new OperationError('invalid_request', 'Choose a supported variant action.');
}
