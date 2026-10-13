import { vi } from 'vitest';

/** Exercise real delivery accounting and EmailLog writes without contacting a provider. */
export async function stubReportEmailProvider() {
  const { env } = await import('../../src/lib/env');
  const { default: nodemailer } = await import('nodemailer');
  vi.spyOn(env, 'emailProvider', 'get').mockReturnValue('smtp');
  vi.spyOn(env, 'smtpHost', 'get').mockReturnValue('mail.example.test');
  vi.spyOn(env, 'smtpUser', 'get').mockReturnValue('report@example.test');
  vi.spyOn(env, 'smtpPassword', 'get').mockReturnValue('fake-test-credential');
  vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
    sendMail: vi.fn(async () => ({ messageId: 'test-report-message' })),
  } as unknown as ReturnType<typeof nodemailer.createTransport>);
}
