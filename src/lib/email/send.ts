import { Resend } from 'resend';
import { Locale, EmailStatus } from '@prisma/client';

import { prisma } from '../prisma';
import { env } from '../env';

/**
 * Transactional email.
 *
 * Two rules shape this module:
 *
 * 1. **Sending must never break the thing that triggered it.** A failed
 *    invitation email should not roll back the invitation, and a failed
 *    "your post didn't publish" alert must not crash the worker mid-tick. So
 *    `sendEmail` never throws — it records the outcome and returns it.
 *
 * 2. **Every attempt is recorded.** When someone asks "why wasn't I told my
 *    posts stopped going out?", EmailLog answers it.
 *
 * With no RESEND_API_KEY the app runs normally and logs each message as
 * `skipped`, so local development needs no email provider.
 */

let client: Resend | null = null;

function resend(): Resend | null {
  if (!env.resendApiKey) return null;
  client ??= new Resend(env.resendApiKey);
  return client;
}

export interface SendResult {
  status: EmailStatus;
  providerId?: string;
  error?: string;
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  workspaceId?: string | null;
}): Promise<SendResult> {
  const outcome = await deliver(options);

  try {
    await prisma.emailLog.create({
      data: {
        workspaceId: options.workspaceId ?? null,
        to: options.to,
        template: options.template,
        subject: options.subject,
        providerId: outcome.providerId ?? null,
        status: outcome.status,
        error: outcome.error ?? null,
      },
    });
  } catch (error) {
    // Losing the log entry is not worth failing the send over.
    console.error('[email] could not write EmailLog', error);
  }

  return outcome;
}

async function deliver(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const provider = resend();

  if (!provider) {
    console.info(`[email] skipped (no RESEND_API_KEY): "${options.subject}" to ${options.to}`);
    return { status: EmailStatus.skipped, error: 'RESEND_API_KEY is not configured.' };
  }

  try {
    const { data, error } = await provider.emails.send({
      from: env.emailFrom,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      return { status: EmailStatus.failed, error: error.message };
    }
    return { status: EmailStatus.sent, providerId: data?.id };
  } catch (error) {
    return {
      status: EmailStatus.failed,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Whether email is configured at all — used to hide UI that would not work. */
export function emailEnabled(): boolean {
  return Boolean(env.resendApiKey);
}

export { Locale };
