import { z } from 'zod';
import { entry } from '@/lib/config/entry';

const bilingual = z.object({ en: z.string().min(1), fr: z.string().min(1) });
const copyDefaults = {
  formTitle: { en: 'Connect Bluesky', fr: 'Connecter Bluesky' },
  formIntro: { en: 'Create an app password in Bluesky (Settings → Privacy and security → App passwords) and enter it here. Never use your main password. It is stored encrypted and never shown again.', fr: 'Créez un mot de passe d’application dans Bluesky (Paramètres → Confidentialité et sécurité → Mots de passe d’application) et saisissez-le ici. N’utilisez jamais votre mot de passe principal. Il est stocké chiffré et n’est plus jamais affiché.' },
  formSubmit: { en: 'Verify and connect', fr: 'Vérifier et connecter' },
  identifierLabel: { en: 'Handle or email', fr: 'Identifiant ou e-mail' },
  identifierHelp: { en: 'For example name.bsky.social.', fr: 'Par exemple nom.bsky.social.' },
  passwordLabel: { en: 'App password', fr: 'Mot de passe d’application' },
  passwordHelp: { en: 'Four groups of four letters or digits, separated by dashes.', fr: 'Quatre groupes de quatre lettres ou chiffres, séparés par des tirets.' },
  post: { en: 'Post', fr: 'Publication' },
  account: { en: 'Bluesky account', fr: 'Compte Bluesky' },
  invalid: { en: 'Bluesky posts are text only and must fit the length limit.', fr: 'Les publications Bluesky sont en texte seul et doivent respecter la limite de longueur.' },
  uncertain: { en: 'The post could not be confirmed. Check Bluesky before sending it again.', fr: 'La publication n’a pas pu être confirmée. Vérifiez Bluesky avant de la renvoyer.' },
  reconnect: { en: 'Reconnect this account with a new app password.', fr: 'Reconnectez ce compte avec un nouveau mot de passe d’application.' },
};
export const blueskyCopy = z.object(Object.fromEntries(Object.keys(copyDefaults).map(key => [key, bilingual.default(copyDefaults[key as keyof typeof copyDefaults])])) as { [K in keyof typeof copyDefaults]: z.ZodDefault<typeof bilingual> });

export const policySchema = z.object({
  baseUrl: z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash && u.pathname === '/'; }),
  requestTimeoutMs: z.number().int().min(1).max(120000),
  maxTextCharacters: z.number().int().min(1).max(300),
  unavailable: z.object({ en: z.string().min(1), fr: z.string().min(1) }),
  copy: blueskyCopy.default(() => blueskyCopy.parse({})),
});
export type Policy = z.infer<typeof policySchema>;
export const POLICY_DEFAULTS: Policy = { baseUrl: 'https://bsky.social', requestTimeoutMs: 15000, maxTextCharacters: 300, unavailable: { en: 'Bluesky could not complete this request. Check your connection before trying again.', fr: 'Bluesky n’a pas pu terminer cette demande. Vérifiez votre connexion avant de réessayer.' }, copy: blueskyCopy.parse({}) };
export const BLUESKY_CONFIG = [
  entry({ key: 'platforms.bluesky.enabled', group: 'Bluesky · Engine', label: 'Bluesky enabled', kind: 'boolean', description: 'Make Bluesky available to workspaces. When off, customers cannot see or connect Bluesky; connected data remains stored. Live provider verification is still required before enabling in production.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.bluesky.includedByDefault', group: 'Bluesky · Access', label: 'Included by default', kind: 'boolean', description: 'Give every workspace Bluesky without a plan feature.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.bluesky.planFeatures', group: 'Bluesky · Access', label: 'Plan access keys', kind: 'json', description: 'Plan feature keys that grant Bluesky access.', defaultValue: ['platform_bluesky'], schema: z.array(z.string().min(1)), consumption: 'active' }),
  entry({ key: 'bluesky.policy', group: 'Bluesky · API', label: 'Bluesky policy', kind: 'json', description: 'HTTPS endpoint of the Personal Data Server, request timeout, text bound and English/French connection-form, publishing and failure copy. Connection uses an app password entered by the customer; only text posts are supported.', defaultValue: POLICY_DEFAULTS, schema: policySchema, consumption: 'active' }),
].map(setting => ({ ...setting, owner: { kind: 'platform' as const, id: 'bluesky' } }));
