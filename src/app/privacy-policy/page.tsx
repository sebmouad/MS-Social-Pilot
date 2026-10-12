/**
 * Privacy policy.
 *
 * Meta links here from the Facebook Login dialog and the app's details, so,
 * like the terms and the data deletion page, it sits outside the signed-in
 * layout.
 */

import { LegalPage, type LegalSection } from '@/components/LegalPage';
import { operatorDetails, type OperatorDetails } from '@/lib/operator';

export const dynamic = 'force-dynamic';

const deletion = (label: string) => (
  <a className="underline" href="/data-deletion">
    {label}
  </a>
);

/** The page's sections, in the words root's operator details give it (S2). */
function sections(op: OperatorDetails): LegalSection[] {
  const controller = op.name || 'the operator of this installation';
  const mail = op.email ? (
    <a className="underline" href={`mailto:${op.email}`}>
      {op.email}
    </a>
  ) : (
    <>the operator of this installation</>
  );
  return [
  {
    title: 'Who we are',
    body: (
      <>
        {op.productName}
        {op.appUrl ? ` (${op.appUrl})` : ''} is a publishing and analytics tool for people who manage Facebook
        Pages. The data controller is {controller}
        {[op.address, op.country].filter(Boolean).length > 0 ? `, ${[op.address, op.country].filter(Boolean).join(', ')}` : ''}.
        Contact: {mail}.
      </>
    ),
  },
  {
    title: 'The data we process',
    body: (
      <ul className="list-disc space-y-1 ps-5">
        <li>Your account: name, email address and password (stored only as a one-way hash).</li>
        <li>
          What Facebook gives us when you connect your profile with Facebook Login: your Facebook name and ID,
          the Pages and ad accounts you manage, and the matching access tokens.
        </li>
        <li>
          Data of the Pages you choose to connect: posts, comments, messages, insights (reach, views,
          engagement, followers) and ad results.
        </li>
        <li>What you create in the app: post text, images and videos, schedules.</li>
        <li>Technical logs (time, IP address, errors) for security and reliability.</li>
      </ul>
    ),
  },
  {
    title: 'Why',
    body: (
      <>
        Only to provide the service you ask for: publishing and scheduling your posts, showing your Pages&apos;
        results, answering comments and messages, and building your reports. The app acts only when you (or a
        teammate you invited) ask it to. We do not sell your data, use it for advertising, or share it with
        third parties for their own purposes.
      </>
    ),
  },
  {
    title: 'Who can see it',
    body: (
      <>
        Only the members of your workspace.{' '}
        {op.hosting ? `Our technical providers host it on our behalf: ${op.hosting}.` : 'Our hosting providers store it on our behalf.'}{' '}
        Data is sent to Meta only to carry out your actions (publish, reply, hide).
      </>
    ),
  },
  {
    title: 'Security',
    body: (
      <>
        Facebook tokens are encrypted (AES-256) before they are stored, every connection uses HTTPS, and
        server access is restricted.
      </>
    ),
  },
  {
    title: 'Retention',
    body: (
      <>
        Data is kept while your account or Facebook connection exists. When you disconnect a profile or
        remove the app from Facebook, the profile and all its access tokens are deleted and its Pages are no
        longer read or published to. Posts and statistics already stored are erased on request, within 30
        days. Daily backups are erased automatically after 14 days.
      </>
    ),
  },
  {
    title: 'Your rights',
    body: (
      <>
        You can access, correct or delete your data, or object to its processing (
        {op.dataProtection || 'under the data-protection law that applies to you'}), by writing to {mail}. You can also remove the app from your Facebook settings
        (Apps and websites): Facebook tells us and your profile and its tokens are deleted — see the{' '}
        {deletion('data deletion page')}.
      </>
    ),
  },
  {
    title: 'Cookies',
    body: <>A single cookie that keeps you signed in. No advertising or analytics cookies.</>,
  },
  {
    title: 'Changes',
    body: <>Any change will be published on this page with its update date.</>,
  },
  ];
}

export default async function PrivacyPolicyPage() {
  const op = await operatorDetails();
  return <LegalPage title="Privacy policy" updated={op.legalUpdated ? `Last updated ${op.legalUpdated}` : ''} sections={sections(op)} />;
}
