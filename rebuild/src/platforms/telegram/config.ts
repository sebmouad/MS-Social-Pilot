import { z } from 'zod';
import { entry } from '@/lib/config/entry';

const bilingual = z.object({ en: z.string().min(1), fr: z.string().min(1) });
const copyDefaults = {
  formTitle: { en: 'Connect a Telegram channel', fr: 'Connecter un canal Telegram' },
  formIntro: { en: 'Create a bot with @BotFather, add it as an administrator of your channel with permission to post, then enter the bot token and the channel here. The token is stored encrypted and never shown again.', fr: 'Créez un bot avec @BotFather, ajoutez-le comme administrateur de votre canal avec le droit de publier, puis saisissez ici le jeton du bot et le canal. Le jeton est stocké chiffré et n’est plus jamais affiché.' },
  formSubmit: { en: 'Verify and connect', fr: 'Vérifier et connecter' },
  tokenLabel: { en: 'Bot token', fr: 'Jeton du bot' },
  tokenHelp: { en: 'Looks like 123456789:ABC… and comes from @BotFather.', fr: 'Ressemble à 123456789:ABC… et provient de @BotFather.' },
  channelLabel: { en: 'Channel', fr: 'Canal' },
  channelHelp: { en: 'The public @username of the channel, or its numeric ID starting with -100.', fr: 'Le @nom public du canal, ou son identifiant numérique commençant par -100.' },
  post: { en: 'Message', fr: 'Message' },
  account: { en: 'Telegram channel', fr: 'Canal Telegram' },
  invalid: { en: 'Telegram posts are text only and must fit the length limit.', fr: 'Les publications Telegram sont en texte seul et doivent respecter la limite de longueur.' },
  uncertain: { en: 'The message could not be confirmed. Check the channel before sending it again.', fr: 'Le message n’a pas pu être confirmé. Vérifiez le canal avant de le renvoyer.' },
  reconnect: { en: 'Reconnect this channel with a valid bot token.', fr: 'Reconnectez ce canal avec un jeton de bot valide.' },
};
export const telegramCopy = z.object(Object.fromEntries(Object.keys(copyDefaults).map(key => [key, bilingual.default(copyDefaults[key as keyof typeof copyDefaults])])) as { [K in keyof typeof copyDefaults]: z.ZodDefault<typeof bilingual> });

export const policySchema = z.object({
  baseUrl: z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash && u.pathname === '/'; }),
  requestTimeoutMs: z.number().int().min(1).max(120000),
  maxTextCharacters: z.number().int().min(1).max(4096),
  unavailable: z.object({ en: z.string().min(1), fr: z.string().min(1) }),
  copy: telegramCopy.default(() => telegramCopy.parse({})),
});
export type Policy = z.infer<typeof policySchema>;
export const POLICY_DEFAULTS: Policy = { baseUrl: 'https://api.telegram.org', requestTimeoutMs: 15000, maxTextCharacters: 4096, unavailable: { en: 'Telegram could not complete this request. Check your connection before trying again.', fr: 'Telegram n’a pas pu terminer cette demande. Vérifiez votre connexion avant de réessayer.' }, copy: telegramCopy.parse({}) };
export const TELEGRAM_CONFIG = [
  entry({ key: 'platforms.telegram.enabled', group: 'Telegram · Engine', label: 'Telegram enabled', kind: 'boolean', description: 'Make Telegram channels available to workspaces. When off, customers cannot see or connect Telegram; connected data remains stored. Live provider verification is still required before enabling in production.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.telegram.includedByDefault', group: 'Telegram · Access', label: 'Included by default', kind: 'boolean', description: 'Give every workspace Telegram without a plan feature.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.telegram.planFeatures', group: 'Telegram · Access', label: 'Plan access keys', kind: 'json', description: 'Plan feature keys that grant Telegram access.', defaultValue: ['platform_telegram'], schema: z.array(z.string().min(1)), consumption: 'active' }),
  entry({ key: 'telegram.policy', group: 'Telegram · API', label: 'Telegram policy', kind: 'json', description: 'HTTPS Bot API endpoint, request timeout, text bound and English/French connection-form, publishing and failure copy. Connection uses a bot token entered by the customer; only text messages to a channel are supported.', defaultValue: POLICY_DEFAULTS, schema: policySchema, consumption: 'active' }),
].map(setting => ({ ...setting, owner: { kind: 'platform' as const, id: 'telegram' } }));
