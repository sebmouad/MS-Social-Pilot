import { describe, expect, it, vi } from 'vitest';
import { MAIL_CONFIG } from '@/server/mail/config';
import { createTransactionalMailService } from '@/server/mail';

const base = {
  enabled: true, publicOrigin: 'https://social.example', smtpHost: 'smtp.example', smtpPort: 587,
  smtpSecure: false, smtpRequireTls: true, smtpUsername: 'smtp-user', smtpPassword: 'top-secret',
  fromAddress: 'noreply@social.example', fromName: 'MS Social Pilot', connectionTimeoutMs: 10000,
  socketTimeoutMs: 30000, subjectMaxCharacters: 200, bodyMaxBytes: 1024,
  recipientMaxCharacters: 320, workspaceIdMaxCharacters: 128, templateMaxCharacters: 100, providerIdMaxCharacters: 255,
};
const input = { to: 'person@example.test', subject: 'Invitation', text: 'Join the workspace', template: 'workspace_invitation', workspaceId: 'workspace-1' };

function service(options: { config?: Partial<typeof base>; send?: () => Promise<any>; record?: () => Promise<void> } = {}) {
  const config = { ...base, ...options.config };
  const readConfig = vi.fn(async (key: string) => config[key.replace('mail.', '') as keyof typeof config]);
  const readSecret = vi.fn(async () => config.smtpPassword);
  const sendMail = vi.fn(options.send ?? (async () => ({ accepted: [input.to], rejected: [], messageId: 'delivery-1' })));
  const close = vi.fn();
  const record = vi.fn(options.record ?? (async () => undefined));
  const createTransport = vi.fn(() => ({ sendMail, close }));
  return { mail: createTransactionalMailService({ readConfig, readSecret, createTransport, record }), sendMail, close, record, createTransport };
}

describe('transactional mail', () => {
  it('exposes the complete shared mail config tuple', () => {
    expect(MAIL_CONFIG.map((definition) => definition.key)).toEqual([
      'mail.recipientMaxCharacters', 'mail.workspaceIdMaxCharacters', 'mail.templateMaxCharacters', 'mail.providerIdMaxCharacters',
      'mail.enabled', 'mail.publicOrigin', 'mail.smtpHost', 'mail.smtpPort', 'mail.smtpSecure', 'mail.smtpRequireTls',
      'mail.smtpUsername', 'mail.smtpPassword', 'mail.fromAddress', 'mail.fromName', 'mail.connectionTimeoutMs',
      'mail.socketTimeoutMs', 'mail.subjectMaxCharacters', 'mail.bodyMaxBytes',
    ]);
    expect(MAIL_CONFIG.find((definition) => definition.key === 'mail.smtpPassword')?.kind).toBe('secret');
  });

  it('applies Root recipient, workspace, template and receipt limits', async () => {
    for (const config of [{ recipientMaxCharacters: 3 }, { workspaceIdMaxCharacters: 3 }, { templateMaxCharacters: 3 }]) {
      const harness = service({ config });
      expect(await harness.mail.sendTransactionalMail(input)).toEqual({ status: 'unavailable' });
      expect(harness.createTransport).not.toHaveBeenCalled();
    }
    const harness = service({ config: { providerIdMaxCharacters: 3 } });
    expect(await harness.mail.sendTransactionalMail(input)).toEqual({ status: 'sent' });
    expect(harness.record).toHaveBeenCalledWith(expect.objectContaining({ providerId: undefined, status: 'sent' }));
  });

  it('reports disabled or invalid configuration as unavailable without SMTP IO', async () => {
    const disabled = service({ config: { enabled: false } });
    expect(await disabled.mail.mailReady()).toBe(false);
    expect(await disabled.mail.sendTransactionalMail(input)).toEqual({ status: 'unavailable' });
    expect(disabled.createTransport).not.toHaveBeenCalled();

    const invalid = service({ config: { smtpHost: 'https://smtp.example', smtpSecure: false, smtpRequireTls: false } });
    expect(await invalid.mail.mailReady()).toBe(false);
    expect(await invalid.mail.sendTransactionalMail(input)).toEqual({ status: 'unavailable' });
    expect(invalid.createTransport).not.toHaveBeenCalled();
  });

  it('uses a validated public origin and returns sent only for an accepted recipient with a durable receipt', async () => {
    const harness = service();
    expect(await harness.mail.mailReady()).toBe(true);
    expect(await harness.mail.publicMailOrigin()).toBe('https://social.example');
    expect(await harness.mail.sendTransactionalMail(input)).toEqual({ status: 'sent', deliveryId: 'delivery-1' });
    expect(harness.sendMail).toHaveBeenCalledOnce();
    expect(harness.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent', providerId: 'delivery-1', to: input.to }));
    expect(harness.close).toHaveBeenCalled();
  });

  it('returns failed for an explicit recipient refusal', async () => {
    const harness = service({ send: async () => ({ accepted: [], rejected: [input.to], messageId: 'nope' }) });
    expect(await harness.mail.sendTransactionalMail(input)).toEqual({ status: 'failed' });
    expect(harness.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'recipient_refused' }));
  });

  it('masks provider exceptions and refuses oversize bodies before transport creation', async () => {
    const harness = service({ send: async () => { throw new Error('smtp token=top-secret body=private text'); } });
    expect(await harness.mail.sendTransactionalMail(input)).toEqual({ status: 'uncertain' });
    expect(harness.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'delivery_unconfirmed' }));
    expect(JSON.stringify(harness.record.mock.calls)).not.toContain('top-secret');
    expect(JSON.stringify(harness.record.mock.calls)).not.toContain('private text');

    const large = service();
    expect(await large.mail.sendTransactionalMail({ ...input, text: 'x'.repeat(1025) })).toEqual({ status: 'unavailable' });
    expect(large.createTransport).not.toHaveBeenCalled();
  });

  it('returns uncertain if SMTP acceptance cannot be persisted', async () => {
    const harness = service({ record: async () => { throw new Error('database connection details'); } });
    expect(await harness.mail.sendTransactionalMail(input)).toEqual({ status: 'uncertain' });
  });
});
