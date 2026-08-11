import { Locale } from '@prisma/client';

import { env } from '../env';
import enMessages from '../../../messages/en.json';
import frMessages from '../../../messages/fr.json';

/**
 * Email rendering.
 *
 * Emails are built here rather than through next-intl's request-scoped
 * helpers, because most of them are sent by the *worker* — a process with no
 * HTTP request and therefore no request locale. The recipient's stored locale
 * is passed in explicitly instead, and the catalogues are imported directly.
 *
 * The markup is deliberately plain: inline styles, a table-free single column,
 * no external images. Anything cleverer is a liability across Outlook, Gmail
 * and Apple Mail, and these are short functional messages.
 */

const CATALOGUES: Record<Locale, unknown> = {
  [Locale.en]: enMessages,
  [Locale.fr]: frMessages,
};

/** Look up a dotted key, interpolating {placeholders}. */
function translate(locale: Locale, key: string, params: Record<string, string | number> = {}): string {
  const catalogue = CATALOGUES[locale] ?? CATALOGUES[Locale.en];

  const raw = key.split('.').reduce<unknown>((node, part) => {
    if (typeof node === 'object' && node !== null && part in node) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, catalogue);

  if (typeof raw !== 'string') return key;

  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface Block {
  heading: string;
  body: string;
  /** Extra paragraphs beneath the body. */
  details?: string[];
  cta?: { label: string; url: string };
  footer?: string;
}

function layout(block: Block): { html: string; text: string } {
  const paragraphs = [block.body, ...(block.details ?? [])].filter(Boolean);

  const html = `
<div style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;">
    <div style="font-size:13px;font-weight:600;color:#3563e9;margin-bottom:18px;">MS Social Pilot</div>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35;color:#0f172a;font-weight:600;">${escapeHtml(
      block.heading,
    )}</h1>
    ${paragraphs
      .map(
        (paragraph) =>
          `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(paragraph)}</p>`,
      )
      .join('')}
    ${
      block.cta
        ? `<p style="margin:22px 0 0;"><a href="${escapeAttribute(block.cta.url)}" style="display:inline-block;background:#3563e9;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:8px;">${escapeHtml(
            block.cta.label,
          )}</a></p>`
        : ''
    }
    ${
      block.footer
        ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#94a3b8;">${escapeHtml(
            block.footer,
          )}</p>`
        : ''
    }
  </div>
</div>`.trim();

  const text = [
    block.heading,
    '',
    ...paragraphs,
    ...(block.cta ? ['', `${block.cta.label}: ${block.cta.url}`] : []),
    ...(block.footer ? ['', block.footer] : []),
  ].join('\n');

  return { html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function formatDate(date: Date, locale: Locale, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function invitationEmail(options: {
  locale: Locale;
  inviter: string;
  workspace: string;
  role: string;
  token: string;
  expiresAt: Date;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(options.locale, key, params);
  const roleLabel = t(`team.roles.${options.role}`);

  const block = layout({
    heading: t('email.invitation.heading'),
    body: t('email.invitation.body', {
      inviter: options.inviter,
      workspace: options.workspace,
      role: roleLabel,
    }),
    details: [t('email.invitation.expiry', { date: formatDate(options.expiresAt, options.locale) })],
    cta: { label: t('email.invitation.cta'), url: `${env.appUrl}/invite/${options.token}` },
  });

  return {
    subject: t('email.invitation.subject', { inviter: options.inviter, workspace: options.workspace }),
    ...block,
  };
}

export function publishFailureEmail(options: {
  locale: Locale;
  workspace: string;
  target: string;
  scheduledAt: Date | null;
  timezone: string;
  reason: string;
  postId: string;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(options.locale, key, params);

  const when = options.scheduledAt
    ? formatDate(options.scheduledAt, options.locale, options.timezone)
    : '—';

  const block = layout({
    heading: t('email.publishFailure.heading'),
    body: t('email.publishFailure.body', { when, target: options.target }),
    details: [t('email.publishFailure.reason', { reason: options.reason })],
    cta: { label: t('email.publishFailure.cta'), url: `${env.appUrl}/posts?status=failed` },
    footer: t('email.footer', { workspace: options.workspace }),
  });

  return { subject: t('email.publishFailure.subject', { target: options.target }), ...block };
}

export function connectionExpiredEmail(options: {
  locale: Locale;
  workspace: string;
  account: string;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(options.locale, key, params);

  const block = layout({
    heading: t('email.connectionExpired.heading'),
    body: t('email.connectionExpired.body', { account: options.account }),
    cta: { label: t('email.connectionExpired.cta'), url: `${env.appUrl}/connections` },
    footer: t('email.footer', { workspace: options.workspace }),
  });

  return { subject: t('email.connectionExpired.subject', { account: options.account }), ...block };
}

export function tokenExpiringEmail(options: {
  locale: Locale;
  workspace: string;
  account: string;
  expiresAt: Date;
  days: number;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(options.locale, key, params);

  const block = layout({
    heading: t('email.tokenExpiring.heading'),
    body: t('email.tokenExpiring.body', {
      account: options.account,
      date: formatDate(options.expiresAt, options.locale),
    }),
    cta: { label: t('email.tokenExpiring.cta'), url: `${env.appUrl}/connections` },
    footer: t('email.footer', { workspace: options.workspace }),
  });

  return {
    subject: t('email.tokenExpiring.subject', { account: options.account, days: options.days }),
    ...block,
  };
}

export function approvalRequestEmail(options: {
  locale: Locale;
  workspace: string;
  author: string;
  scheduledAt: Date | null;
  timezone: string;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(options.locale, key, params);

  const when = options.scheduledAt
    ? formatDate(options.scheduledAt, options.locale, options.timezone)
    : '—';

  const block = layout({
    heading: t('email.approvalRequest.heading'),
    body: t('email.approvalRequest.body', {
      author: options.author,
      workspace: options.workspace,
      when,
    }),
    cta: { label: t('email.approvalRequest.cta'), url: `${env.appUrl}/approvals` },
    footer: t('email.footer', { workspace: options.workspace }),
  });

  return { subject: t('email.approvalRequest.subject', { author: options.author }), ...block };
}

export function approvalDecisionEmail(options: {
  locale: Locale;
  workspace: string;
  reviewer: string;
  approved: boolean;
  note?: string | null;
  scheduledAt: Date | null;
  timezone: string;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(options.locale, key, params);

  const when = options.scheduledAt
    ? formatDate(options.scheduledAt, options.locale, options.timezone)
    : '—';

  const block = layout({
    heading: options.approved
      ? t('email.approvalDecision.headingApproved')
      : t('email.approvalDecision.headingRejected'),
    body: options.approved
      ? t('email.approvalDecision.bodyApproved', {
          reviewer: options.reviewer,
          workspace: options.workspace,
          when,
        })
      : t('email.approvalDecision.bodyRejected', { reviewer: options.reviewer }),
    details: !options.approved && options.note ? [`“${options.note}”`] : [],
    cta: { label: t('email.approvalDecision.cta'), url: `${env.appUrl}/posts` },
    footer: t('email.footer', { workspace: options.workspace }),
  });

  return {
    subject: options.approved
      ? t('email.approvalDecision.subjectApproved')
      : t('email.approvalDecision.subjectRejected'),
    ...block,
  };
}
