import { OperationError } from '@/lib/operation-error';
import type { AiPort } from '../ai';

/** Google Gemini generateContent adapter. The Root endpoint is the models base URL; the model id
 * is appended as `/<model>:generateContent`. Failures never expose provider text. */
export function geminiPort(settings: { apiKey: string; endpoint: string; fetchImpl?: typeof fetch }): AiPort {
  const doFetch = settings.fetchImpl ?? fetch;
  return {
    async complete({ system, prompt, model, maxTokens, signal, image }) {
      const url = `${settings.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(model)}:generateContent`;
      let response: Response;
      try {
        response = await doFetch(url, {
          method: 'POST', signal, redirect: 'error', cache: 'no-store',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': settings.apiKey },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: image ? [{ inlineData: { mimeType: image.mimeType, data: image.base64 } }, { text: prompt }] : [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }),
        });
      } catch { throw new OperationError('upstream_failure', signal.aborted ? 'AI assist took too long to answer. Try again.' : 'AI assist could not be reached. Try again later.'); }
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new OperationError('upstream_failure', 'AI assist could not complete this request. Try again later.'); }
      let body: unknown;
      try { body = await response.json(); } catch { throw new OperationError('upstream_failure', 'AI assist returned an unreadable answer. Try again.'); }
      const candidates = (body as { candidates?: unknown })?.candidates;
      const parts = Array.isArray(candidates) ? (candidates[0] as { content?: { parts?: unknown } } | undefined)?.content?.parts : undefined;
      const text = Array.isArray(parts) ? parts.map(part => (part && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('') : '';
      if (!text.trim()) throw new OperationError('upstream_failure', 'AI assist returned an empty answer. Try again.');
      return text;
    },
  };
}
