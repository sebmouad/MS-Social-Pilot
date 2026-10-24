import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import { copySchema } from '@/lib/config/copy-schema';

export const apiUsagePolicySchema = z.object({ scopeLimit: z.number().int().min(1).max(500) }).strict();
export const ROOT_API_USAGE_COPY = {
  en: { title: 'Platform API usage', intro: 'The latest request-limit readings each platform reported. Values are the platform’s own estimates and may lag; they are not a quota guarantee.', empty: 'No readings recorded yet. They appear after the platform answers a request that reports usage.', unavailable: 'This platform does not report API usage, or the readings could not be loaded.', updated: 'Last reading', stale: 'Stale', warning: 'Near limit', metric: 'Measure', value: 'Value', percent: '%', seconds: 's', minutes: 'min', utc: 'UTC' },
  fr: { title: 'Utilisation des API des plateformes', intro: 'Les dernières mesures de limites de requêtes communiquées par chaque plateforme. Ce sont des estimations de la plateforme, éventuellement en retard, et non une garantie de quota.', empty: 'Aucune mesure enregistrée pour le moment. Elles apparaissent quand la plateforme répond à une requête qui indique son utilisation.', unavailable: 'Cette plateforme n’indique pas son utilisation des API, ou les mesures n’ont pas pu être chargées.', updated: 'Dernière mesure', stale: 'Ancienne', warning: 'Proche de la limite', metric: 'Mesure', value: 'Valeur', percent: '%', seconds: 's', minutes: 'min', utc: 'UTC' },
};
export const rootApiUsageCopySchema = z.object({ en: copySchema(ROOT_API_USAGE_COPY.en), fr: copySchema(ROOT_API_USAGE_COPY.fr) }).strict();
export type RootApiUsageCopy = { [K in keyof typeof ROOT_API_USAGE_COPY.en]: string };

export const rootApiUsageConfig = [
  entry({ key: 'root.apiUsagePolicy', group: 'Operations', label: 'Platform API usage view limits', kind: 'json', description: 'Maximum usage scopes returned per platform by the private Root API usage view, REST read and MCP tool.', defaultValue: { scopeLimit: 50 }, schema: apiUsagePolicySchema, consumption: 'active' }),
  entry({ key: 'root.apiUsageCopy', group: 'Operations', label: 'Platform API usage copy', kind: 'json', description: 'English and French labels for the private platform API usage view.', defaultValue: ROOT_API_USAGE_COPY, schema: rootApiUsageCopySchema, consumption: 'active' }),
] as const;
