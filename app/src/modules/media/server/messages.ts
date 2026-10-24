import { headers } from 'next/headers';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';
import { configOrDefault } from '@/server/config/config-or-default';
import { mediaMessagesSchema } from '../messages';

/** The request's language: French-speaking browsers get French. No request (worker, MCP client without a header) means English. */
async function requestLocale(): Promise<'en' | 'fr'> {
  try { return /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en'; } catch { return 'en'; }
}

/** `mediaMessage('Phrase {0}', value)`: unknown phrases fall back to themselves so a missing row never blanks a reply. */
export async function mediaMessage(phrase: string, ...values: Array<string | number>): Promise<string> {
  const catalog: Record<string, { en: string; fr: string }> = await configOrDefault('media.messages', mediaMessagesSchema);
  const text = catalog[phrase]?.[await requestLocale()] ?? phrase;
  return text.replace(/\{(\d+)\}/g, (token, index: string) => values[Number(index)] === undefined ? token : String(values[Number(index)]));
}

/** A safe product failure whose text comes from the Root catalog. */
export async function mediaError(code: OperationErrorCode, phrase: string, ...values: Array<string | number>): Promise<OperationError> {
  return new OperationError(code, await mediaMessage(phrase, ...values));
}
