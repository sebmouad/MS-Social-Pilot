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
