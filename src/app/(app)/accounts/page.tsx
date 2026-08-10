import { AccountsClient } from '@/components/AccountsClient';
import { requireAuth } from '@/lib/auth';
import { canManageAccounts } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const params = await searchParams;

  const accounts = await prisma.socialAccount.findMany({
    where: { workspaceId: auth.workspace.id },
    include: { targets: { orderBy: [{ type: 'asc' }, { name: 'asc' }] } },
    orderBy: { createdAt: 'asc' },
  });

  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Connected accounts</h1>
          <p className="mt-1 text-sm text-slate-600">
            Facebook pages and groups this workspace can publish to.
          </p>
        </div>
        {canManageAccounts(auth.role) && (
          // A full navigation, not fetch: the route redirects to Facebook.
          <a href="/api/facebook/connect" className="btn-primary">
            Connect Facebook
          </a>
        )}
      </header>

      {first(params.connected) && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {first(params.connected)}
        </div>
      )}
      {first(params.warning) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {first(params.warning)}
        </div>
      )}
      {first(params.error) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {first(params.error)}
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="card p-8 text-center">
          <h2 className="text-sm font-semibold text-slate-900">No accounts connected yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-slate-600">
            Connect the Facebook account that manages your pages. We ask for permission to list your
            pages and publish posts on their behalf, and store the resulting tokens encrypted.
          </p>
          <a href="/api/facebook/connect" className="btn-primary mt-4">
            Connect Facebook
          </a>
        </div>
      ) : (
        <AccountsClient
          accounts={accounts.map((account) => ({
            id: account.id,
            name: account.name,
            pictureUrl: account.pictureUrl,
            tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
            invalidReason: account.invalidatedAt ? account.invalidReason ?? 'Reconnect required.' : null,
            lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
            targets: account.targets.map((target) => ({
              id: target.id,
              name: target.name,
              type: target.type,
              pictureUrl: target.pictureUrl,
              enabled: target.enabled,
              canPublish: target.canPublish,
              publishBlocker: target.publishBlocker,
            })),
          }))}
        />
      )}

      {!env.groupsEnabled && (
        <p className="text-xs text-slate-500">
          Group publishing is turned off. Meta restricted the Groups API in April 2024, so it needs a
          separately approved permission and the app must be installed in each group. Set
          <code className="mx-1 rounded bg-slate-100 px-1 py-0.5">FACEBOOK_ENABLE_GROUPS=true</code>
          once you have that approval — see docs/META_APP_SETUP.md.
        </p>
      )}
    </div>
  );
}
