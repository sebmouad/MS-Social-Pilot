import { OperationError } from '@/lib/operation-error';
import type { AiPort } from '../ai';

/** Anthropic Messages API adapter. The key and endpoint are Root settings; failures never expose provider text. */
export function anthropicPort(settings: { apiKey: string; endpoint: string; fetchImpl?: typeof fetch }): AiPort {
  const doFetch = settings.fetchImpl ?? fetch;
  return {
    async complete({ system, prompt, model, maxTokens, signal }) {
      let response: Response;
      try {
        response = await doFetch(settings.endpoint, {
          method: 'POST', signal, redirect: 'error', cache: 'no-store',
          headers: { 'content-type': 'application/json', 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
        });
      } catch { throw new OperationError('upstream_failure', signal.aborted ? 'AI assist took too long to answer. Try again.' : 'AI assist could not be reached. Try again later.'); }
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new OperationError('upstream_failure', 'AI assist could not complete this request. Try again later.'); }
      let body: unknown;
      try { body = await response.json(); } catch { throw new OperationError('upstream_failure', 'AI assist returned an unreadable answer. Try again.'); }
      const content = (body as { content?: unknown })?.content;
      const text = Array.isArray(content) ? content.map(part => (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('') : '';
      if (!text.trim()) throw new OperationError('upstream_failure', 'AI assist returned an empty answer. Try again.');
      return text;
    },
  };
}
