import { Resend } from 'resend';
import nodemailer, { type Transporter } from 'nodemailer';
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
 * Two providers: SMTP (Gmail with an app password, or any mail server) and
 * Resend. With neither configured the app runs normally and logs each message
 * as `skipped`, so local development needs no email provider.
 */

let client: Resend | null = null;
let smtp: { key: string; transport: Transporter } | null = null;

export type EmailProvider = 'smtp' | 'resend' | null;

/** Which provider sends, from the setting and what is configured. */
export function activeEmailProvider(): EmailProvider {
  const smtpReady = Boolean(env.smtpHost && env.smtpUser && env.smtpPassword);
  const choice = env.emailProvider;
  if (choice === 'smtp') return smtpReady ? 'smtp' : null;
  if (choice === 'resend') return env.resendApiKey ? 'resend' : null;
  if (smtpReady) return 'smtp';
  return env.resendApiKey ? 'resend' : null;
}

function smtpTransport(): Transporter {
  const key = [env.smtpHost, env.smtpPort, env.smtpUser, env.smtpPassword].join('|');
  if (!smtp || smtp.key !== key) {
    smtp = {
      key,
      transport: nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpPort === 465,
        auth: { user: env.smtpUser, pass: env.smtpPassword ?? '' },
      }),
    };
  }
  return smtp.transport;
}

/**
 * A plain-language reason for an SMTP failure — the raw server reply is kept
 * too, but "535-5.7.8 Username and Password not accepted" helps nobody.
 */
export function explainSmtpError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string; responseCode?: number }) ?? {};
  if (code.code === 'EAUTH' || code.responseCode === 535) {
    return `Sign-in refused by the mail server. For Gmail, use an app password, not your Google password. (${raw})`;
  }
  if (code.code === 'ECONNECTION' || code.code === 'ETIMEDOUT' || code.code === 'ESOCKET') {
    return `Could not reach the mail server. Check the server and port. (${raw})`;
  }
  return raw;
}

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
  const active = activeEmailProvider();

  if (!active) {
    console.info(`[email] skipped (no email provider): "${options.subject}" to ${options.to}`);
    return { status: EmailStatus.skipped, error: 'No email provider is configured (SMTP or Resend).' };
  }

  if (active === 'smtp') {
    try {
      const info = await smtpTransport().sendMail({
        from: env.emailFrom,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      return { status: EmailStatus.sent, providerId: info.messageId };
    } catch (error) {
      return { status: EmailStatus.failed, error: explainSmtpError(error) };
    }
  }

  const provider = resend()!;

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
  return activeEmailProvider() !== null;
}

export { Locale };
