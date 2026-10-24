import type { MailTransportConfig } from './config';

type SendInput = { from: { name: string; address: string }; to: string; subject: string; text: string; html?: string };
type SendInfo = { accepted: string[]; rejected: string[]; messageId?: string };

/**
 * HTTP API delivery shaped like the SMTP transport so the shared service keeps one outcome model.
 * A definitive client refusal rejects the recipient; timeouts, rate limits and server errors throw
 * (the service records them as unconfirmed and never retries on its own).
 */
export function createApiMailTransport(config: MailTransportConfig, fetchImpl: typeof fetch = fetch) {
  const controller = new AbortController();
  return {
    async sendMail(input: SendInput): Promise<SendInfo> {
      const response = await fetchImpl(config.apiEndpoint, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(config.connectionTimeoutMs + config.socketTimeoutMs)]),
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: `${input.from.name.replace(/[<>"\r\n]/g, '')} <${input.from.address}>`, to: [input.to], subject: input.subject, text: input.text, ...(input.html === undefined ? {} : { html: input.html }) }),
      });
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) return { accepted: [], rejected: [input.to] };
      if (!response.ok) throw new Error('mail_api_error');
      const body: unknown = await response.json().catch(() => null);
      const id = body && typeof body === 'object' && typeof (body as { id?: unknown }).id === 'string' ? (body as { id: string }).id : undefined;
      return { accepted: [input.to], rejected: [], ...(id ? { messageId: id } : {}) };
    },
    close() { controller.abort(); },
  };
}
