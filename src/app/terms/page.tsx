/**
 * Terms of service.
 *
 * Meta shows this link in the Facebook Login dialog and the app's details, so
 * it has to be reachable without an account — like the data deletion page, it
 * sits outside the signed-in layout and is in English only.
 */

const PRIVACY_POLICY_URL = 'https://newsgeet.com/privacy-policy/';
const CONTACT_EMAIL = 'sebmouad@gmail.com';

export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-12">
      <div className="card p-8">
        <h1 className="text-xl font-semibold text-slate-900">Terms of service</h1>
        <p className="mt-1 text-xs text-slate-500">Last updated 9 October 2026</p>

        <p className="mt-4 text-sm text-slate-600">
          MS Social Pilot is a private tool for scheduling and publishing posts to the Facebook
          Pages its users manage. By using it you agree to these terms.
        </p>

        <h2 className="mt-6 text-sm font-semibold text-slate-900">Who may use it</h2>
        <p className="mt-2 text-sm text-slate-600">
          Accounts are created by invitation from a workspace owner. You may connect only Pages and
          accounts you are authorised to manage.
        </p>

        <h2 className="mt-6 text-sm font-semibold text-slate-900">Your content</h2>
        <p className="mt-2 text-sm text-slate-600">
          You are responsible for what you publish through MS Social Pilot, which must follow
          Meta&apos;s Terms of Service and Community Standards.
        </p>

        <h2 className="mt-6 text-sm font-semibold text-slate-900">Facebook access</h2>
        <p className="mt-2 text-sm text-slate-600">
          You connect Facebook through Facebook Login. The access tokens it grants are stored
          encrypted and used only to carry out what you ask for: publishing posts, and reading the
          comments, messages and statistics of your Pages. You can withdraw access at any time from
          your Facebook settings, and request deletion of your data from the{' '}
          <a className="underline" href="/data-deletion">
            data deletion page
          </a>
          .
        </p>

        <h2 className="mt-6 text-sm font-semibold text-slate-900">Availability</h2>
        <p className="mt-2 text-sm text-slate-600">
          The service is provided as it is, without a guarantee that it will always be available or
          free of errors. Scheduled posts depend on Facebook accepting them at the time they are due.
        </p>

        <h2 className="mt-6 text-sm font-semibold text-slate-900">Privacy</h2>
        <p className="mt-2 text-sm text-slate-600">
          How personal data is handled is described in the{' '}
          <a className="underline" href={PRIVACY_POLICY_URL}>
            privacy policy
          </a>
          .
        </p>

        <h2 className="mt-6 text-sm font-semibold text-slate-900">Contact</h2>
        <p className="mt-2 text-sm text-slate-600">
          Questions about these terms:{' '}
          <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </div>
    </main>
  );
}
