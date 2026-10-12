import { z } from 'zod';

import { requireCapability } from '@/lib/auth';
import { canManageAccounts } from '@/lib/constants';
import { AppError, errors } from '@/lib/errors';
import { networkAvailable } from '@/lib/networks';
import { ok, readJson, route } from '@/lib/api';
import { logActivity } from '@/lib/scheduler/runner';
import { connectTelegram, saveNetworkAccount } from '@/lib/networks/connect';
import { GraphError } from '@/lib/facebook/graph';

const schema = z.object({
  /** BotFather tokens look like 123456789:AA... */
  botToken: z.string().trim().regex(/^\d{5,12}:[A-Za-z0-9_-]{30,50}$/, 'Paste the token @BotFather gave you, like 123456789:AA…'),
  /** @channelname, or the numeric id of a private channel. */
  channel: z.string().trim().regex(/^(@[A-Za-z0-9_]{5,32}|-?\d{5,20})$/, 'Use the channel’s @name, or its numeric id for a private channel.'),
});

/** Connect a Telegram channel through a bot that is one of its administrators. */
export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageAccounts);
  if (!networkAvailable('telegram')) throw errors.notFound();
  const input = schema.parse(await readJson(request));
  try {
    const connected = await connectTelegram(input.botToken, input.channel);
    const saved = await saveNetworkAccount({ workspaceId: auth.workspace.id, key: 'telegram', connected });
    await logActivity(auth.workspace.id, 'account.connected', { provider: 'telegram' }, auth.user.id);
    return ok({ connected: saved.targets }, 201);
  } catch (error) {
    if (error instanceof GraphError && (error.kind === 'auth' || error.kind === 'permission' || error.kind === 'rejected')) {
      throw new AppError({ key: 'errors.telegramConnect', fallback: 'Telegram refused: check the bot token, the channel, and that the bot is an administrator allowed to post.', status: 422 });
    }
    throw error;
  }
});
