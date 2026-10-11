import { requireRootApi } from '@/lib/auth';
import { activeEmailProvider, sendEmail } from '@/lib/email/send';
import { ok, route } from '@/lib/api';

/**
 * Send one test message to the signed-in root, with whatever is saved now, and
 * say exactly what happened — the only way to know an app password works
 * before an alert depends on it. Root only (404 for everyone else).
 */
export const POST = route(async () => {
  const auth = await requireRootApi();

  const provider = activeEmailProvider();
  const result = await sendEmail({
    to: auth.user.email,
    subject: 'MS Social Pilot — test email',
    text: 'This is a test message from the Configuration screen. Email sending works.',
    html: '<p>This is a test message from the Configuration screen. Email sending works.</p>',
    template: 'config-test',
    workspaceId: null,
  });

  return ok({ provider, status: result.status, error: result.error ?? null, to: auth.user.email });
});
