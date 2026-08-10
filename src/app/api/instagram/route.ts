import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fail, ok, readJson, route } from '@/lib/api';
import {
  discoverInstagramAccounts,
  listInstagramAccounts,
  readInstagramInsights,
  readInstagramMedia,
  syncInstagramAccount,
} from '@/lib/instagram';

/** Accounts, and optionally one account's stored insights and media. */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId');

  const accounts = await listInstagramAccounts(auth.workspace.id);
  if (!accountId) return ok({ accounts });

  // Confirm the account belongs to the caller before reading anything under it.
  const owned = await prisma.instagramAccount.findFirst({
    where: { id: accountId, workspaceId: auth.workspace.id },
    select: { id: true },
  });
  if (!owned) return fail('Instagram account not found.', 404);

  const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : new Date();
  const from = url.searchParams.get('from')
    ? new Date(url.searchParams.get('from')!)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return fail('Enter a valid date range.', 400);
  }

  const [series, media] = await Promise.all([
    readInstagramInsights({ accountId, from, to }),
    readInstagramMedia({ accountId }),
  ]);

  return ok({ accounts, series, media });
});

const schema = z.object({
  action: z.enum(['discover', 'sync']).default('sync'),
  accountId: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/** Discover linked accounts, or pull fresh data for one or all of them. */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = schema.parse((await readJson(request).catch(() => ({}))) ?? {});

  if (input.action === 'discover') {
    return ok(await discoverInstagramAccounts(auth.workspace.id));
  }

  const accounts = await prisma.instagramAccount.findMany({
    where: {
      workspaceId: auth.workspace.id,
      enabled: true,
      ...(input.accountId ? { id: input.accountId } : {}),
    },
    select: { id: true },
  });

  if (accounts.length === 0) return fail('No Instagram account connected.', 404);

  const results = [];
  for (const account of accounts) {
    results.push(
      await syncInstagramAccount({
        accountId: account.id,
        since: input.from ? new Date(input.from) : undefined,
        until: input.to ? new Date(input.to) : undefined,
      }),
    );
  }

  return ok({ results });
});
