import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));
vi.mock('resend', () => ({ Resend: class {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { emailLog: { create: vi.fn() } } }));

const config = {
  emailProvider: 'auto',
  smtpHost: 'smtp.gmail.com',
  smtpPort: 465,
  smtpUser: 'me@example.com',
  smtpPassword: null as string | null,
  resendApiKey: null as string | null,
  emailFrom: 'me@example.com',
};
vi.mock('@/lib/env', () => ({ env: new Proxy({}, { get: (_t, key: string) => config[key as keyof typeof config] }) }));

const { activeEmailProvider, emailEnabled, explainSmtpError, sendEmail } = await import('@/lib/email/send');

describe('email through SMTP (Gmail app password)', () => {
  beforeEach(() => {
    Object.assign(config, { emailProvider: 'auto', smtpPassword: null, resendApiKey: null, smtpPort: 465 });
    sendMail.mockReset();
    createTransport.mockClear();
  });

  it('picks SMTP when its password is set, Resend otherwise, nothing when neither', () => {
    expect(activeEmailProvider()).toBeNull();
    expect(emailEnabled()).toBe(false);
    config.resendApiKey = 're_key';
    expect(activeEmailProvider()).toBe('resend');
    config.smtpPassword = 'abcd efgh ijkl mnop';
    expect(activeEmailProvider()).toBe('smtp');
    config.emailProvider = 'resend';
    expect(activeEmailProvider()).toBe('resend');
  });

  it('refuses an explicit SMTP choice that is not filled in', () => {
    config.emailProvider = 'smtp';
    expect(activeEmailProvider()).toBeNull();
  });

  it('sends through the SMTP server with SSL on port 465', async () => {
    config.smtpPassword = 'app-password';
    sendMail.mockResolvedValue({ messageId: '<id@gmail>' });
    const result = await sendEmail({ to: 'a@example.com', subject: 'S', html: '<p>H</p>', text: 'H', template: 't' });
    expect(result).toEqual({ status: 'sent', providerId: '<id@gmail>' });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'me@example.com', pass: 'app-password' } }),
    );
  });

  it('explains a refused sign-in in plain words', async () => {
    config.smtpPassword = 'wrong';
    sendMail.mockRejectedValue(Object.assign(new Error('535-5.7.8 Username and Password not accepted'), { code: 'EAUTH', responseCode: 535 }));
    const result = await sendEmail({ to: 'a@example.com', subject: 'S', html: 'H', text: 'H', template: 't' });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/app password, not your Google password/);
  });

  it('explains an unreachable server', () => {
    expect(explainSmtpError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toMatch(/Could not reach the mail server/);
  });
});
