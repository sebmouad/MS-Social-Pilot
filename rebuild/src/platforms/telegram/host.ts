import type { PlatformHost } from '@/server/platforms/host';
import { requestLocale } from '@/server/platforms/request-locale';
import { configuredTelegramAdapter } from './runtime';
import { telegramConnection } from './connection';

/** Telegram-owned assembly. Shared services select this host through neutral dispatch. */
export const telegramHost = {
  adapter: async () => configuredTelegramAdapter(await requestLocale()),
  connection: telegramConnection,
} satisfies PlatformHost;
