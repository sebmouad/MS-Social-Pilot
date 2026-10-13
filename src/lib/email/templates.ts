import { Locale } from '@prisma/client';

import { env } from '../env';
import { brand } from '../operator';
import { settingString } from '../settings';
import type { Report } from '../reports';
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
export function translate(locale: Locale, key: string, params: Record<string, string | number> = {}): string {
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
  /** Figures drawn as a row of tiles under the body. */
  stats?: Array<{ label: string; value: string }>;
  /** A titled list after the figures: the posts that did best, say. */
  list?: { title: string; items: string[] };
}

/** Who sends these emails, as root entered it; empty until root does. */
function senderLine(): string {
  return [brand().name, settingString('operator.name').trim(), settingString('operator.email').trim()].filter(Boolean).join(' · ');
}

function layout(block: Block): { html: string; text: string } {
  const sender = senderLine();
  const paragraphs = [block.body, ...(block.details ?? [])].filter(Boolean);

  const html = `
<div style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;">
    <div style="font-size:13px;font-weight:600;color:#3563e9;margin-bottom:18px;">${escapeHtml(brand().name)}</div>
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
      block.stats?.length
        ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 6px;border-collapse:separate;border-spacing:6px;"><tr>${block.stats
            .map(
              (stat) =>
                `<td style="background:#f1f5f9;border-radius:10px;padding:12px;vertical-align:top;"><div style="font-size:12px;color:#64748b;">${escapeHtml(
                  stat.label,
                )}</div><div style="font-size:20px;font-weight:700;color:#0f172a;margin-top:2px;">${escapeHtml(stat.value)}</div></td>`,
            )
            .join('')}</tr></table>`
        : ''
    }
    ${
      block.list?.items.length
        ? `<h2 style="margin:18px 0 8px;font-size:15px;color:#0f172a;">${escapeHtml(block.list.title)}</h2><ol style="margin:0;padding-left:20px;">${block.list.items
            .map((item) => `<li style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#334155;">${escapeHtml(item)}</li>`)
            .join('')}</ol>`
        : ''
    }
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
    <p style="margin:16px 0 0;font-size:11px;line-height:1.5;color:#94a3b8;">${escapeHtml(sender)}</p>
  </div>
</div>`.trim();

  const text = [
    block.heading,
    '',
    ...paragraphs,
    ...(block.stats?.length ? ['', ...block.stats.map((stat) => `${stat.label}: ${stat.value}`)] : []),
    ...(block.list?.items.length ? ['', block.list.title, ...block.list.items.map((item, index) => `${index + 1}. ${item}`)] : []),
    ...(block.cta ? ['', `${block.cta.label}: ${block.cta.url}`] : []),
    ...(block.footer ? ['', block.footer] : []),
    '',
    sender,
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

/**
 * A moment as the reader's workspace sees it.
 *
 * `timeStyle: 'short'` means these carry an hour, so formatting in UTC gets
 * both the time and, near midnight, the day wrong — in the messages whose
 * whole job is to say when something runs out. UTC remains the fallback for a
 * caller with no zone to offer, which is defensible rather than correct.
 */
function formatDate(date: Date, locale: Locale, timeZone: string | undefined = 'UTC'): string {
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
  /** The workspace's zone. A deadline printed in UTC is the wrong deadline. */
  timezone?: string;
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
    details: [
      t('email.invitation.expiry', {
        date: formatDate(options.expiresAt, options.locale, options.timezone),
      }),
    ],
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

export function draftUpdatedEmail(options: {
  locale: Locale;
  workspace: string;
  editor: string;
  excerpt: string;
  postId: string;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) => translate(options.locale, key, params);

  const block = layout({
    heading: t('email.draftUpdated.heading'),
    body: options.excerpt
      ? t('email.draftUpdated.body', { editor: options.editor, excerpt: options.excerpt })
      : t('email.draftUpdated.bodyNoText', { editor: options.editor }),
    cta: { label: t('email.draftUpdated.cta'), url: `${env.appUrl}/compose?post=${options.postId}` },
    footer: t('email.footer', { workspace: options.workspace }),
  });

  return { subject: t('email.draftUpdated.subject', { editor: options.editor }), ...block };
}

export function queueEmptyEmail(options: {
  locale: Locale;
  workspace: string;
  page: string;
  targetId: string;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) => translate(options.locale, key, params);

  const block = layout({
    heading: t('email.queueEmpty.heading'),
    body: t('email.queueEmpty.body', { page: options.page }),
    cta: { label: t('email.queueEmpty.cta'), url: `${env.appUrl}/compose?to=${options.targetId}` },
    footer: t('email.footer', { workspace: options.workspace }),
  });

  return { subject: t('email.queueEmpty.subject', { page: options.page }), ...block };
}

/** Content mix (H1): a Page's weekly mix needs a label that has no drafts left. */
export function mixDryEmail(options: {
  locale: Locale;
  workspace: string;
  page: string;
  label: string;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) => translate(options.locale, key, params);

  const block = layout({
    heading: t('email.mixDry.heading'),
    body: t('email.mixDry.body', { page: options.page, label: options.label }),
    cta: { label: t('email.mixDry.cta'), url: `${env.appUrl}/queue/mix` },
    footer: t('email.footer', { workspace: options.workspace }),
  });

  return { subject: t('email.mixDry.subject', { page: options.page, label: options.label }), ...block };
}

/** A new comment matched a moderation rule set to alert. */
export function moderationAlertEmail(options: {
  locale: Locale;
  workspace: string;
  page: string;
  rule: string;
  author: string | null;
  message: string;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) => translate(options.locale, key, params);

  const block = layout({
    heading: t('email.moderationAlert.heading', { rule: options.rule }),
    body: t('email.moderationAlert.body', {
      page: options.page,
      author: options.author ?? t('email.moderationAlert.someone'),
      message: options.message.slice(0, 500),
    }),
    cta: { label: t('email.moderationAlert.cta'), url: `${env.appUrl}/inbox` },
    footer: t('email.footer', { workspace: options.workspace }),
  });

  return { subject: t('email.moderationAlert.subject', { page: options.page, rule: options.rule }), ...block };
}

export function tokenExpiringEmail(options: {
  locale: Locale;
  workspace: string;
  account: string;
  expiresAt: Date;
  days: number;
  /** The workspace's zone. A deadline printed in UTC is the wrong deadline. */
  timezone?: string;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(options.locale, key, params);

  const block = layout({
    heading: t('email.tokenExpiring.heading'),
    body: t('email.tokenExpiring.body', {
      account: options.account,
      date: formatDate(options.expiresAt, options.locale, options.timezone),
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

  /**
   * The reviewer is the one who can still say no, so this has to describe the
   * post they are actually being asked about. A post whose moment has passed
   * publishes as soon as it is approved — naming the time gives no hint of
   * that — and a post with no time at all read as "scheduled for —".
   */
  const body = () => {
    if (!options.scheduledAt) {
      return t('email.approvalRequest.bodyNoTime', {
        author: options.author,
        workspace: options.workspace,
      });
    }

    if (options.scheduledAt.getTime() <= Date.now()) {
      return t('email.approvalRequest.bodyOverdue', {
        author: options.author,
        workspace: options.workspace,
      });
    }

    return t('email.approvalRequest.body', {
      author: options.author,
      workspace: options.workspace,
      when: formatDate(options.scheduledAt, options.locale, options.timezone),
    });
  };

  const block = layout({
    heading: t('email.approvalRequest.heading'),
    body: body(),
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

  /**
   * A post held for review keeps the time its author chose, so approving one
   * late leaves a moment that has already gone. The scheduler publishes it on
   * the next tick, which makes "it is scheduled for Tuesday 9am" a sentence
   * about a time that has passed, for a post going out in the next thirty
   * seconds. Say what is actually about to happen instead.
   *
   * A post with no time is returned to draft rather than to a schedule that
   * cannot be honoured, and the email used to render that as an em dash.
   */
  const approvedBody = () => {
    if (!options.scheduledAt) {
      return t('email.approvalDecision.bodyApprovedDraft', {
        reviewer: options.reviewer,
        workspace: options.workspace,
      });
    }

    if (options.scheduledAt.getTime() <= Date.now()) {
      return t('email.approvalDecision.bodyApprovedNow', {
        reviewer: options.reviewer,
        workspace: options.workspace,
      });
    }

    return t('email.approvalDecision.bodyApproved', {
      reviewer: options.reviewer,
      workspace: options.workspace,
      when: formatDate(options.scheduledAt, options.locale, options.timezone),
    });
  };

  const block = layout({
    heading: options.approved
      ? t('email.approvalDecision.headingApproved')
      : t('email.approvalDecision.headingRejected'),
    body: options.approved
      ? approvedBody()
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

/** The weekly or monthly report, for people who may never open the app. */
export function scheduledReportEmail(options: {
  locale: Locale;
  workspace: string;
  page: string;
  frequency: 'weekly' | 'monthly';
  period: string;
  followers: number | null;
  report: Report;
  /** The AI summary, when the schedule asks for one and it could be written. */
  recap?: string | null;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(options.locale, key, params);
  const number = (value: number) => new Intl.NumberFormat(options.locale).format(value);
  const { report } = options;

  const block = layout({
    heading: t(`email.scheduledReport.heading_${options.frequency}`, { page: options.page }),
    body: t('email.scheduledReport.body', { page: options.page, period: options.period }),
    stats: [
      ...(options.followers !== null ? [{ label: t('email.scheduledReport.followers'), value: number(options.followers) }] : []),
      { label: t('email.scheduledReport.posts'), value: number(report.postsPublished) },
      { label: t('email.scheduledReport.reach'), value: number(report.totals.reach) },
      { label: t('email.scheduledReport.engagement'), value: number(report.totals.engagement) },
    ],
    details: [
      ...(options.recap ? [t('email.scheduledReport.recap', { recap: options.recap })] : []),
      ...(report.postsPublished === 0 ? [t('email.scheduledReport.nothing')] : []),
    ],
    list: {
      title: t('email.scheduledReport.topPosts'),
      items: report.topPosts.slice(0, 3).map((post) => {
        const text = post.message.replace(/\s+/g, ' ').trim();
        const short = text.length > 110 ? `${text.slice(0, 107)}…` : text || '—';
        return `${short} — ${t('email.scheduledReport.interactions', { total: number(post.engagement) })}`;
      }),
    },
    footer: t('email.scheduledReport.footer', { workspace: options.workspace }),
  });

  return {
    subject: t(`email.scheduledReport.subject_${options.frequency}`, { page: options.page, period: options.period }),
    ...block,
  };
}

/** Root moved to another account: sent to both people. */
export function rootTransferEmail(options: {
  locale: Locale;
  from: string;
  to: string;
  /** True for the person who is root now. */
  forNewRoot: boolean;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(options.locale, key, params);
  const block = layout({
    heading: t('email.rootTransfer.heading'),
    body: t(options.forNewRoot ? 'email.rootTransfer.bodyNew' : 'email.rootTransfer.bodyOld', {
      from: options.from,
      to: options.to,
    }),
    cta: options.forNewRoot ? { label: t('email.rootTransfer.cta'), url: `${env.appUrl}/root` } : undefined,
  });
  return { subject: t('email.rootTransfer.subject'), ...block };
}

/** Root inviting a client to create an account with their own workspace. */
export function clientInvitationEmail(options: {
  locale: Locale;
  inviter: string;
  token: string;
  expiresAt: Date;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(options.locale, key, params);
  const block = layout({
    heading: t('email.clientInvitation.heading'),
    body: t('email.clientInvitation.body', { inviter: options.inviter }),
    details: [t('email.clientInvitation.expiry', { date: formatDate(options.expiresAt, options.locale) })],
    cta: { label: t('email.clientInvitation.cta'), url: `${env.appUrl}/register?client=${options.token}` },
  });
  return { subject: t('email.clientInvitation.subject', { inviter: options.inviter }), ...block };
}

/** `{key}.one` or `{key}.other` for `count`, since this lookup has no ICU plurals. */
function plural(locale: Locale, key: string, count: number): string {
  const form = new Intl.PluralRules(locale).select(count) === 'one' ? 'one' : 'other';
  return translate(locale, `${key}.${form}`, { n: count });
}

/** The hourly email of what people wrote to the member's Pages since the last one. */
export function inboxDigestEmail(options: {
  locale: Locale;
  workspace: string;
  pages: Array<{ name: string; comments: number; messages: number }>;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) => translate(options.locale, key, params);
  const comments = options.pages.reduce((sum, page) => sum + page.comments, 0);
  const messages = options.pages.reduce((sum, page) => sum + page.messages, 0);
  const counts = (page: { comments: number; messages: number }) =>
    [
      page.comments > 0 ? plural(options.locale, 'email.inboxDigest.comments', page.comments) : null,
      page.messages > 0 ? plural(options.locale, 'email.inboxDigest.messages', page.messages) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const block = layout({
    heading: t('email.inboxDigest.heading'),
    body: t('email.inboxDigest.body', { counts: counts({ comments, messages }) }),
    list: { title: t('email.inboxDigest.listTitle'), items: options.pages.map((page) => `${page.name}: ${counts(page)}`) },
    cta: { label: t('email.inboxDigest.cta'), url: `${env.appUrl}/inbox` },
    footer: t('email.footer', { workspace: options.workspace }),
  });

  return { subject: t('email.inboxDigest.subject', { counts: counts({ comments, messages }) }), ...block };
}

/** Someone signed in to the account from a browser it has not used before. */
export function newSignInEmail(options: {
  locale: Locale;
  device: string;
  place: string | null;
  when: string;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(options.locale, key, params);
  const block = layout({
    heading: t('email.newSignIn.heading'),
    body: options.place
      ? t('email.newSignIn.body', { device: options.device, place: options.place, when: options.when })
      : t('email.newSignIn.bodyNoPlace', { device: options.device, when: options.when }),
    cta: { label: t('email.newSignIn.cta'), url: `${env.appUrl}/settings/account` },
  });
  return { subject: t('email.newSignIn.subject'), ...block };
}

/** A teammate @mentioned the reader in a post's internal notes. */
export function noteMentionEmail(options: {
  locale: Locale;
  workspace: string;
  author: string;
  note: string;
  url: string;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) => translate(options.locale, key, params);

  const block = layout({
    heading: t('email.noteMention.heading'),
    body: t('email.noteMention.body', { author: options.author, note: options.note }),
    cta: { label: t('email.noteMention.cta'), url: options.url },
    footer: t('email.footer', { workspace: options.workspace }),
  });

  return { subject: t('email.noteMention.subject', { author: options.author }), ...block };
}

/** A Page got clearly more negative comments than usual. */
export function negativeSpikeEmail(options: {
  locale: Locale;
  workspace: string;
  page: string;
  targetId: string;
  count: number;
}): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) => translate(options.locale, key, params);

  const block = layout({
    heading: t('email.negativeSpike.heading', { page: options.page }),
    body: t('email.negativeSpike.body', { page: options.page, comments: plural(options.locale, 'email.negativeSpike.comments', options.count) }),
    cta: { label: t('email.negativeSpike.cta'), url: `${env.appUrl}/inbox?pages=${options.targetId}` },
    footer: t('email.footer', { workspace: options.workspace }),
  });

  return { subject: t('email.negativeSpike.subject', { page: options.page }), ...block };
}

/** Prove the address after a self-service sign-up (S3). */
export function verifyEmailEmail(options: { locale: Locale; name: string; token: string }): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) => translate(options.locale, key, params);
  const block = layout({
    heading: t('email.verifyEmail.heading', { name: options.name }),
    body: t('email.verifyEmail.body'),
    cta: { label: t('email.verifyEmail.cta'), url: `${env.appUrl}/api/auth/verify-email?token=${encodeURIComponent(options.token)}` },
    footer: t('email.verifyEmail.footer'),
  });
  return { subject: t('email.verifyEmail.subject'), ...block };
}

/** A link to choose a new password (S3). */
export function passwordResetEmail(options: { locale: Locale; token: string }): RenderedEmail {
  const t = (key: string, params?: Record<string, string | number>) => translate(options.locale, key, params);
  const block = layout({
    heading: t('email.passwordReset.heading'),
    body: t('email.passwordReset.body'),
    cta: { label: t('email.passwordReset.cta'), url: `${env.appUrl}/reset-password?token=${encodeURIComponent(options.token)}` },
    footer: t('email.passwordReset.footer'),
  });
  return { subject: t('email.passwordReset.subject'), ...block };
}
