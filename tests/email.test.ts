import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Locale } from '@prisma/client';

beforeAll(() => {
  process.env.APP_URL = 'https://social.example.com';
});

const {
  invitationEmail,
  publishFailureEmail,
  connectionExpiredEmail,
  tokenExpiringEmail,
  approvalRequestEmail,
  approvalDecisionEmail,
} = await import('../src/lib/email/templates');

describe('invitationEmail', () => {
  const base = {
    inviter: 'Sam',
    workspace: 'Acme',
    role: 'editor',
    token: 'abc123',
    expiresAt: new Date('2026-09-01T10:00:00Z'),
  };

  it('renders in English', () => {
    const email = invitationEmail({ locale: Locale.en, ...base });
    expect(email.subject).toBe('Sam invited you to Acme');
    expect(email.html).toContain('Sam has invited you to join Acme');
    expect(email.html).toContain('Editor');
  });

  it('renders in French', () => {
    const email = invitationEmail({ locale: Locale.fr, ...base });
    expect(email.subject).toBe('Sam vous invite à rejoindre Acme');
    expect(email.html).toContain('Éditeur');
    // Nothing should have leaked through untranslated.
    expect(email.html).not.toContain('has invited you');
  });

  it('links to the acceptance page with the token', () => {
    const email = invitationEmail({ locale: Locale.en, ...base });
    expect(email.html).toContain('https://social.example.com/invite/abc123');
    expect(email.text).toContain('https://social.example.com/invite/abc123');
  });

  it('always provides a plain-text alternative', () => {
    const email = invitationEmail({ locale: Locale.en, ...base });
    expect(email.text.length).toBeGreaterThan(20);
    expect(email.text).not.toContain('<div');
  });
});

describe('publishFailureEmail', () => {
  const base = {
    workspace: 'Acme',
    target: 'Acme Page',
    scheduledAt: new Date('2026-09-01T08:00:00Z'),
    timezone: 'Europe/Paris',
    reason: 'Error validating access token',
    postId: 'post_1',
  };

  it('names the destination in the subject, so an inbox is scannable', () => {
    const email = publishFailureEmail({ locale: Locale.en, ...base });
    expect(email.subject).toContain('Acme Page');
  });

  it("reports Facebook's reason verbatim", () => {
    const email = publishFailureEmail({ locale: Locale.en, ...base });
    expect(email.html).toContain('Error validating access token');
  });

  it('shows the scheduled time in the workspace timezone', () => {
    // 08:00 UTC is 10:00 in Paris in September.
    const email = publishFailureEmail({ locale: Locale.en, ...base });
    expect(email.html).toMatch(/10:00/);
  });

  it('handles a post with no scheduled time', () => {
    const email = publishFailureEmail({ locale: Locale.en, ...base, scheduledAt: null });
    expect(email.html).toContain('—');
  });
});

describe('other templates', () => {
  it('warns about an expiring token with a day count', () => {
    const email = tokenExpiringEmail({
      locale: Locale.en,
      workspace: 'Acme',
      account: 'Sam Jones',
      expiresAt: new Date('2026-10-01T00:00:00Z'),
      days: 7,
    });
    expect(email.subject).toContain('7 days');
    expect(email.subject).toContain('Sam Jones');
  });

  it('tells admins a connection stopped working', () => {
    const email = connectionExpiredEmail({
      locale: Locale.fr,
      workspace: 'Acme',
      account: 'Sam Jones',
    });
    expect(email.subject).toContain('Reconnectez');
    expect(email.html).toContain('/connections');
  });

  it('points an approver at the approvals queue', () => {
    const email = approvalRequestEmail({
      locale: Locale.en,
      workspace: 'Acme',
      author: 'Robin',
      scheduledAt: new Date('2026-09-01T08:00:00Z'),
      timezone: 'UTC',
    });
    expect(email.subject).toContain('Robin');
    expect(email.html).toContain('/approvals');
  });

  it('includes the reviewer note when a post is rejected', () => {
    const email = approvalDecisionEmail({
      locale: Locale.en,
      workspace: 'Acme',
      reviewer: 'Alex',
      approved: false,
      note: 'Please shorten the opening line.',
      scheduledAt: null,
      timezone: 'UTC',
    });
    expect(email.subject).toContain('needs changes');
    expect(email.html).toContain('Please shorten the opening line.');
  });

  it('omits the note when a post is approved', () => {
    const email = approvalDecisionEmail({
      locale: Locale.en,
      workspace: 'Acme',
      reviewer: 'Alex',
      approved: true,
      note: null,
      scheduledAt: new Date('2026-09-01T08:00:00Z'),
      timezone: 'UTC',
    });
    expect(email.subject).toContain('approved');
  });
});

describe('escaping', () => {
  it('escapes HTML in interpolated values', () => {
    // A workspace named after a script tag must not become one.
    const email = invitationEmail({
      locale: Locale.en,
      inviter: '<script>alert(1)</script>',
      workspace: 'Acme & Co',
      role: 'admin',
      token: 'tok',
      expiresAt: new Date('2026-09-01T10:00:00Z'),
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('Acme &amp; Co');
  });
});

/**
 * Deadlines in the reader's own clock.
 *
 * These two emails print a date *and a time*, and both were formatted in UTC.
 * A Sydney workspace was told its connection expired at 14:00 on the third
 * when locally it expires at midnight on the fourth — the wrong hour and the
 * wrong day, in the one message whose whole job is to say when something runs
 * out.
 */
describe('the deadlines in emails', () => {
  const expiresAt = new Date('2026-09-03T14:00:00Z');

  it('states an invitation expiry in the workspace timezone', () => {
    const email = invitationEmail({
      locale: Locale.en,
      inviter: 'Sam',
      workspace: 'Acme',
      role: 'editor',
      token: 'abc123',
      expiresAt,
      timezone: 'Australia/Sydney',
    });

    // Midnight on the fourth in Sydney, not 2pm on the third.
    expect(email.html).toContain('Sep 4, 2026');
    expect(email.html).not.toContain('Sep 3, 2026');
  });

  it('states a token expiry in the workspace timezone', () => {
    const email = tokenExpiringEmail({
      locale: Locale.en,
      workspace: 'Acme',
      account: 'Acme FB',
      expiresAt,
      days: 5,
      timezone: 'Australia/Sydney',
    });

    expect(email.html).toContain('Sep 4, 2026');
    expect(email.html).not.toContain('Sep 3, 2026');
  });

  it('is given a zone by every sender', () => {
    // The template accepting a zone is worth nothing if the caller omits it,
    // and the fallback means that mistake renders perfectly well in UTC.
    const notify = readFileSync('src/lib/email/notify.ts', 'utf8');
    const tokenCall = notify.slice(
      notify.indexOf('tokenExpiringEmail({'),
      notify.indexOf('});', notify.indexOf('tokenExpiringEmail({')),
    );
    expect(tokenCall).toContain('timezone: workspace.timezone');

    const team = readFileSync('src/lib/team.ts', 'utf8');
    const inviteCall = team.slice(
      team.indexOf('invitationEmail({'),
      team.indexOf('});', team.indexOf('invitationEmail({')),
    );
    expect(inviteCall).toContain('timezone: workspace.timezone');
  });

  it('falls back to UTC when no zone is given', () => {
    // Every workspace has a timezone, but a caller that forgets one should get
    // a defensible answer rather than a crash.
    const email = tokenExpiringEmail({
      locale: Locale.en,
      workspace: 'Acme',
      account: 'Acme FB',
      expiresAt,
      days: 5,
    });

    expect(email.html).toContain('Sep 3, 2026');
  });
});

/**
 * What an author is told when their post was approved late.
 *
 * A post held for review keeps the time its author chose. Approve it after
 * that moment has passed and the scheduler publishes it on the next tick — so
 * the email saying "it is scheduled for Tuesday 9am" is describing a time that
 * has gone, about a post going out in the next thirty seconds. The author
 * plans around the sentence they were sent.
 */
describe('an approval that arrives after the scheduled time', () => {
  const base = {
    locale: Locale.en,
    workspace: 'Acme',
    reviewer: 'Sam',
    approved: true,
    timezone: 'Europe/Paris',
  };

  it('says it is going out now, not that it is scheduled for a past time', () => {
    const email = approvalDecisionEmail({
      ...base,
      scheduledAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    expect(email.html).not.toMatch(/scheduled for/i);
    expect(email.html).toMatch(/shortly|now/i);
  });

  it('still names the time when it is genuinely ahead', () => {
    const scheduledAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const email = approvalDecisionEmail({ ...base, scheduledAt });

    expect(email.html).toMatch(/scheduled for/i);
    expect(email.html).toContain(
      new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Paris',
      }).format(scheduledAt),
    );
  });

  it('says it is waiting as a draft when there is no time at all', () => {
    // Approving a post with no time returns it to draft rather than to a
    // schedule it cannot honour, so the email must not imply either.
    const email = approvalDecisionEmail({ ...base, scheduledAt: null });

    expect(email.html).not.toMatch(/scheduled for/i);
    expect(email.html).not.toContain('—');
  });
});

/**
 * What a reviewer is told before they decide.
 *
 * The reviewer is the one who can still say no, so the email has to describe
 * the post they are actually being asked about. A post whose scheduled time
 * has already passed publishes the moment it is approved — the sentence
 * "scheduled for Tuesday 9am" gives no hint of that, and a post with no time
 * at all rendered as "scheduled for —".
 */
describe('the email asking for a review', () => {
  const base = {
    locale: Locale.en,
    workspace: 'Acme',
    author: 'Wren',
    timezone: 'Europe/Paris',
  };

  it('warns that approving will publish it straight away', () => {
    const email = approvalRequestEmail({
      ...base,
      scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    expect(email.html).toMatch(/passed|straight away|immediately/i);
  });

  it('names the time while it is still ahead', () => {
    const scheduledAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const email = approvalRequestEmail({ ...base, scheduledAt });

    expect(email.html).toContain(
      new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Paris',
      }).format(scheduledAt),
    );
    expect(email.html).not.toMatch(/passed/i);
  });

  it('says there is no time set rather than printing a dash', () => {
    const email = approvalRequestEmail({ ...base, scheduledAt: null });

    expect(email.html).not.toContain('—');
    expect(email.html).toMatch(/no time/i);
  });
});
