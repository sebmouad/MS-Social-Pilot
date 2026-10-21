import { headers } from 'next/headers';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';
import { configOrDefault } from '@/server/config/config-or-default';
import { sharingMessagesSchema } from '../messages';

/** The request's language: French-speaking browsers get French. No request (worker, MCP client without a header) means English. */
async function requestLocale(): Promise<'en' | 'fr'> {
  try { return /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en'; } catch { return 'en'; }
}

/** `sharingMessage('Phrase {0}', value)`: unknown phrases fall back to themselves so a missing row never blanks a reply. */
export async function sharingMessage(phrase: string, ...values: Array<string | number>): Promise<string> {
  const catalog: Record<string, { en: string; fr: string }> = await configOrDefault('sharing.messages', sharingMessagesSchema);
  const text = catalog[phrase]?.[await requestLocale()] ?? phrase;
  return text.replace(/\{(\d+)\}/g, (token, index: string) => values[Number(index)] === undefined ? token : String(values[Number(index)]));
}

/** A safe product failure whose text comes from the Root catalog. */
export async function sharingError(code: OperationErrorCode, phrase: string, ...values: Array<string | number>): Promise<OperationError> {
  return new OperationError(code, await sharingMessage(phrase, ...values));
}
