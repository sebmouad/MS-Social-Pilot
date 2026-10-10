/**
 * Terms of service.
 *
 * Meta shows this link in the Facebook Login dialog and the app's details, so
 * it has to be reachable without an account — like the privacy policy and the
 * data deletion page, it sits outside the signed-in layout.
 */

import { LegalPage, type LegalSection } from '@/components/LegalPage';

const OPERATOR = 'ANASSO TRAVAUX';
const CONTACT_EMAIL = 'sebmouad@gmail.com';
const UPDATED = '10 October 2026';

const mail = (
  <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
    {CONTACT_EMAIL}
  </a>
);
const link = (href: string, label: string) => (
  <a className="underline" href={href}>
    {label}
  </a>
);

const SECTIONS: LegalSection[] = [
  {
    title: 'The service',
    body: (
      <>
        MS Social Pilot (https://social.newsgeet.com), operated by {OPERATOR} (Morocco), lets its users publish,
        schedule and track posts on the Facebook Pages they manage, and answer their comments and messages. By
        using it you agree to these terms.
      </>
    ),
  },
  {
    title: 'Who may use it',
    body: (
      <>
        Accounts are created by invitation from a workspace owner. You may connect only the profiles, Pages and
        ad accounts you are authorised to manage, and you are responsible for the people you invite.
      </>
    ),
  },
  {
    title: 'Your content',
    body: (
      <>
        You are responsible for what you publish through MS Social Pilot, which must follow Meta&apos;s Terms
        of Service and Community Standards. Your content stays yours; we use it only to publish and show it
        when you ask.
      </>
    ),
  },
  {
    title: 'Facebook access',
    body: (
      <>
        You connect Facebook through Facebook Login. The access tokens it grants are stored encrypted and used
        only for what you ask: publishing, replying, hiding, and reading your Pages&apos; comments, messages and
        statistics. You can withdraw access at any time from your Facebook settings, or request deletion of
        your data on the {link('/data-deletion', 'data deletion page')}.
      </>
    ),
  },
  {
    title: 'Prohibited use',
    body: (
      <>
        You may not use the service for spam, illegal or misleading content, to get around Facebook&apos;s
        limits, or to reach other people&apos;s Pages or accounts without permission. We may suspend an account
        that breaks these rules.
      </>
    ),
  },
  {
    title: 'Availability',
    body: (
      <>
        The service is provided as it is, without a guarantee that it will always be available or free of
        errors. Scheduled posts depend on Facebook accepting them when they are due; if one fails, the app
        tells you.
      </>
    ),
  },
  {
    title: 'Liability',
    body: (
      <>
        To the extent the law allows, {OPERATOR} is not liable for indirect losses, or for Meta&apos;s decisions
        about your Pages, posts or accounts.
      </>
    ),
  },
  {
    title: 'Personal data',
    body: <>How personal data is handled is described in the {link('/privacy-policy', 'privacy policy')}.</>,
  },
  {
    title: 'Changes and governing law',
    body: <>Any change will be published on this page with its date. These terms are governed by Moroccan law.</>,
  },
  { title: 'Contact', body: <>Questions about these terms: {mail}.</> },
];

export default function TermsPage() {
  return <LegalPage title="Terms of service" updated={`Last updated ${UPDATED}`} sections={SECTIONS} />;
}
