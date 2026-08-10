import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fail, ok, readJson, route } from '@/lib/api';
import {
  discoverAdAccounts,
  listAdAccounts,
  readAdSummary,
  readCampaigns,
  syncAdAccount,
} from '@/lib/ads';

/** Ad accounts, plus spend totals and campaign rows for the window. */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const url = new URL(request.url);

  const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : new Date();
  const from = url.searchParams.get('from')
    ? new Date(url.searchParams.get('from')!)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return fail('Enter a valid date range.', 400);
  }

  const adAccountId = url.searchParams.get('adAccountId') ?? undefined;

  const [accounts, summary, campaigns] = await Promise.all([
    listAdAccounts(auth.workspace.id),
    readAdSummary({ workspaceId: auth.workspace.id, adAccountId, from, to }),
    readCampaigns({ workspaceId: auth.workspace.id, adAccountId, from, to }),
  ]);

  return ok({ accounts, summary, campaigns });
});

const schema = z.object({
  action: z.enum(['discover', 'sync']).default('sync'),
  adAccountId: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = schema.parse((await readJson(request).catch(() => ({}))) ?? {});

  if (input.action === 'discover') {
    return ok(await discoverAdAccounts(auth.workspace.id));
  }

  const accounts = await prisma.adAccount.findMany({
    where: {
      workspaceId: auth.workspace.id,
      enabled: true,
      ...(input.adAccountId ? { id: input.adAccountId } : {}),
    },
    select: { id: true },
  });

  if (accounts.length === 0) return fail('No ad account connected.', 404);

  const results = [];
  for (const account of accounts) {
    results.push(
      await syncAdAccount({
        adAccountId: account.id,
        since: input.from ? new Date(input.from) : undefined,
        until: input.to ? new Date(input.to) : undefined,
      }),
    );
  }

  return ok({ results });
});
