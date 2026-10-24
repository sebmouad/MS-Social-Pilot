import { describe, expect, it, vi } from 'vitest';
import { createApiMailTransport } from '@/server/mail/api-transport';
import { createTransactionalMailService } from '@/server/mail';
import { MAIL_CONFIG, MAIL_TRANSPORT_SCHEMA } from '@/server/mail/config';

const config = MAIL_TRANSPORT_SCHEMA.parse({
  provider: 'api', apiEndpoint: 'https://mail.example/emails', apiKey: 're_secret', enabled: true, publicOrigin: 'https://social.example', smtpHost: '', smtpPort: 587,
  smtpSecure: false, smtpRequireTls: true, smtpUsername: '', smtpPassword: '', fromAddress: 'noreply@social.example', fromName: 'MS Social Pilot',
  connectionTimeoutMs: 10000, socketTimeoutMs: 30000, subjectMaxCharacters: 200, bodyMaxBytes: 4096,
  recipientMaxCharacters: 320, workspaceIdMaxCharacters: 128, templateMaxCharacters: 100, providerIdMaxCharacters: 255,
});
const message = { from: { name: 'MS Social Pilot', address: 'noreply@social.example' }, to: 'person@example.test', subject: 'Hello', text: 'Body' };
const reply = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('mail HTTP API provider (G6)', () => {
  it('registers provider, endpoint and a secret key with Resend-compatible defaults', () => {
    const byKey = new Map(MAIL_CONFIG.map(definition => [definition.key, definition]));
    expect(byKey.get('mail.provider')).toMatchObject({ kind: 'select', defaultValue: 'smtp' });
    expect(byKey.get('mail.apiKey')?.kind).toBe('secret');
    expect(byKey.get('mail.apiEndpoint')?.schema.safeParse('http://insecure.example').success).toBe(false);
  });

  it('posts a bearer-authenticated JSON message and returns the provider id', async () => {
    const send = reply(200, { id: 'msg_1' });
    const info = await createApiMailTransport(config, send as unknown as typeof fetch).sendMail(message);
    expect(info).toEqual({ accepted: ['person@example.test'], rejected: [], messageId: 'msg_1' });
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://mail.example/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_secret');
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ['person@example.test'], subject: 'Hello', text: 'Body' });
    expect(init.redirect).toBe('error');
  });

  it('treats a definitive client refusal as rejected and rate limits or server errors as unconfirmed', async () => {
    expect(await createApiMailTransport(config, reply(422) as unknown as typeof fetch).sendMail(message)).toEqual({ accepted: [], rejected: ['person@example.test'] });
    await expect(createApiMailTransport(config, reply(429) as unknown as typeof fetch).sendMail(message)).rejects.toThrow();
    await expect(createApiMailTransport(config, reply(502) as unknown as typeof fetch).sendMail(message)).rejects.toThrow();
  });

  it('requires an endpoint, a key and a sender when enabled', () => {
    for (const patch of [{ apiKey: '' }, { apiEndpoint: 'http://x.example' }, { fromAddress: '' }]) expect(MAIL_TRANSPORT_SCHEMA.safeParse({ ...config, ...patch }).success).toBe(false);
  });

  it('is ready without SMTP settings and never reports sent when the provider is unconfirmed', async () => {
    const values: Record<string, unknown> = Object.fromEntries(Object.entries(config).map(([key, value]) => [`mail.${key}`, value]));
    let status = 502;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'x' }), { status }));
    const record = vi.fn(async () => undefined);
    const mail = createTransactionalMailService({
      readConfig: async key => values[key], readSecret: async key => String(values[key] ?? ''), record,
      createTransport: transportConfig => createApiMailTransport(transportConfig, fetchImpl as unknown as typeof fetch) as never,
    });
    expect(await mail.mailReady()).toBe(true);
    const input = { to: 'person@example.test', subject: 'Hello', text: 'Body', template: 'test_template' };
    expect((await mail.sendTransactionalMail(input)).status).toBe('uncertain');
    status = 200;
    expect(await mail.sendTransactionalMail(input)).toMatchObject({ status: 'sent', deliveryId: 'x' });
  });
});
