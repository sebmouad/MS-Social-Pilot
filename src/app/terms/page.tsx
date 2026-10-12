/**
 * Terms of service.
 *
 * Meta shows this link in the Facebook Login dialog and the app's details, so
 * it has to be reachable without an account — like the privacy policy and the
 * data deletion page, it sits outside the signed-in layout.
 */

import { LegalPage, type LegalSection } from '@/components/LegalPage';
import { operatorDetails, type OperatorDetails } from '@/lib/operator';

export const dynamic = 'force-dynamic';

const link = (href: string, label: string) => (
  <a className="underline" href={href}>
    {label}
  </a>
);

/** The page's sections, in the words root's operator details give it (S2). */
function sections(op: OperatorDetails): LegalSection[] {
  const operator = op.name || 'the operator of this installation';
  const product = op.productName;
  const mail = op.email ? (
    <a className="underline" href={`mailto:${op.email}`}>
      {op.email}
    </a>
  ) : (
    <>the operator of this installation</>
  );
  return [
  {
    title: 'The service',
    body: (
      <>
        {product}
        {op.appUrl ? ` (${op.appUrl})` : ''}, operated by {operator}
        {op.country ? ` (${op.country})` : ''}, lets its users publish,
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
        You are responsible for what you publish through {product}, which must follow Meta&apos;s Terms
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
        To the extent the law allows, {operator} is not liable for indirect losses, or for Meta&apos;s decisions
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
    body: (
      <>
        Any change will be published on this page with its date. These terms are governed by{' '}
        {op.governingLaw || "the law of the operator's country"}.
      </>
    ),
  },
  { title: 'Contact', body: <>Questions about these terms: {mail}.</> },
  ];
}

export default async function TermsPage() {
  const op = await operatorDetails();
  return <LegalPage title="Terms of service" updated={op.legalUpdated ? `Last updated ${op.legalUpdated}` : ''} sections={sections(op)} />;
}
