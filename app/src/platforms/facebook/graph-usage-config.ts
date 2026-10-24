import { z } from 'zod';
import { copySchema } from '@/lib/config/copy-schema';

/** Graph reports its own throttling in response headers; the module records the latest value per scope. */
export const facebookGraphUsagePolicySchema = z.object({
  enabled: z.boolean(),
  minWriteIntervalSeconds: z.number().int().min(1).max(3600),
  staleAfterSeconds: z.number().int().min(60).max(604800),
  warnPercent: z.number().min(1).max(100),
  maxScopes: z.number().int().min(1).max(500),
}).strict();
export const FACEBOOK_GRAPH_USAGE_POLICY = { enabled: true, minWriteIntervalSeconds: 30, staleAfterSeconds: 3600, warnPercent: 80, maxScopes: 50 };

export const FACEBOOK_GRAPH_USAGE_COPY = {
  en: { app: 'App-wide calls', adAccount: 'Ad account', businessUseCase: 'Business use case', callCount: 'Calls used (% of limit)', totalTime: 'Processing time (% of limit)', totalCpuTime: 'CPU time (% of limit)', accountUtilization: 'Account utilization (%)', regainMinutes: 'Minutes until access returns', accountResetSeconds: 'Seconds until the window resets' },
  fr: { app: 'Appels de l’application', adAccount: 'Compte publicitaire', businessUseCase: 'Cas d’usage professionnel', callCount: 'Appels utilisés (% de la limite)', totalTime: 'Temps de traitement (% de la limite)', totalCpuTime: 'Temps processeur (% de la limite)', accountUtilization: 'Utilisation du compte (%)', regainMinutes: 'Minutes avant le retour de l’accès', accountResetSeconds: 'Secondes avant la réinitialisation' },
};
export const facebookGraphUsageCopySchema = z.object({ en: copySchema(FACEBOOK_GRAPH_USAGE_COPY.en), fr: copySchema(FACEBOOK_GRAPH_USAGE_COPY.fr) }).strict();
