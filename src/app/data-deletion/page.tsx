/**
 * Status page for Facebook data deletion requests.
 *
 * The data-deletion callback returns this URL plus a confirmation code, and
 * Meta requires that a user can visit it to check on their request. Deletion is
 * performed synchronously by the callback, so by the time anyone lands here the
 * work is already done.
 */
export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code = Array.isArray(params.code) ? params.code[0] : params.code;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
      <div className="card p-8">
        <h1 className="text-xl font-semibold text-slate-900">Data deletion request</h1>

        {code ? (
          <>
            <p className="mt-3 text-sm text-slate-600">
              Your request has been completed. The Facebook connection and its stored access tokens
              have been deleted, and any posts still queued for its pages and groups were cancelled.
            </p>
            <p className="mt-4 text-sm text-slate-600">
              Confirmation code:{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{code}</code>
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            No confirmation code was supplied. Open this page using the link Facebook gave you when
            you requested deletion.
          </p>
        )}

        <p className="mt-6 text-xs text-slate-500">
          Records of posts already published to your pages are kept as the workspace owner&apos;s
          business records. Contact the workspace owner if you need those removed as well.
        </p>
      </div>
    </main>
  );
}
