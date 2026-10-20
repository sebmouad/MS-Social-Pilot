import { OperationError } from '@/lib/operation-error';
import type { AiPort } from '../ai';

/** OpenAI Chat Completions adapter. Key and endpoint are Root settings; failures never expose provider text. */
export function openaiPort(settings: { apiKey: string; endpoint: string; fetchImpl?: typeof fetch }): AiPort {
  const doFetch = settings.fetchImpl ?? fetch;
  return {
    async complete({ system, prompt, model, maxTokens, signal }) {
      let response: Response;
      try {
        response = await doFetch(settings.endpoint, {
          method: 'POST', signal, redirect: 'error', cache: 'no-store',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
          body: JSON.stringify({ model, max_completion_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
        });
      } catch { throw new OperationError('upstream_failure', signal.aborted ? 'AI assist took too long to answer. Try again.' : 'AI assist could not be reached. Try again later.'); }
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new OperationError('upstream_failure', 'AI assist could not complete this request. Try again later.'); }
      let body: unknown;
      try { body = await response.json(); } catch { throw new OperationError('upstream_failure', 'AI assist returned an unreadable answer. Try again.'); }
      const choices = (body as { choices?: unknown })?.choices;
      const content = Array.isArray(choices) ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content : undefined;
      const text = typeof content === 'string' ? content : '';
      if (!text.trim()) throw new OperationError('upstream_failure', 'AI assist returned an empty answer. Try again.');
      return text;
    },
  };
}
