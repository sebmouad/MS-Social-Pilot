import { z } from 'zod';
/** Copy belongs to Agency; JSON field names remain stable in both locales. */
export const agencyExportCopy = {
  en: {
    title: 'Export workspace overview', help: 'Exports the applied search, sort and attention filter. The workspace cap still applies. Totals ignore the attention filter; coverage and unavailable values are included. This is an internal agency overview, not a public client report.',
    csv: 'Export CSV', json: 'Export JSON', pending: 'Preparing…', prepared: 'Export prepared. Check your downloads.',
    failed: 'The export could not be prepared. Check your access and filters, then try again.', unavailable: 'Not available',
    notes: 'Scope notes', workspaceId: 'Workspace ID', record: 'Record', workspace: 'Workspace', measure: 'Measure', value: 'Value', of: 'Of',
    metadata: 'Export context', total: 'Matching workspace totals', coverage: 'Coverage', row: 'Workspace',
    generatedAt: 'Generated at (UTC)', windowDays: 'Failed-post window (days)', limit: 'Workspace limit', truncated: 'Workspace scan truncated',
    q: 'Workspace name search', sort: 'Sort', order: 'Order', attentionOnly: 'Attention filter', exported: 'Exported workspaces',
    workspaces: 'Matching workspaces', needingAttention: 'Workspaces needing attention',
    channels: 'Channels', disconnected: 'Channels that cannot publish', scheduled: 'Scheduled posts', failedPosts: 'Failed posts',
    waitingConversations: 'Waiting conversations', openTasks: 'Open tasks', overdueTasks: 'Overdue tasks', members: 'Team members', clients: 'Clients',
    publishing: 'Publishing', inbox: 'Inbox', tasks: 'Tasks', team: 'Team', role: 'Role', state: 'Status', needsAttention: 'Needs attention',
    available: 'Available', suspended: 'Suspended', deleting: 'Data deletion in progress', owner: 'Owner', admin: 'Admin', yes: 'Yes', no: 'No',
  },
  fr: {
    title: 'Exporter la vue des espaces', help: 'Exporte la recherche, le tri et le filtre d’attention appliqués. La limite d’espaces reste applicable. Les totaux ignorent le filtre d’attention ; la couverture et les valeurs indisponibles sont incluses. Cette vue interne d’agence n’est pas un rapport client public.',
    csv: 'Exporter en CSV', json: 'Exporter en JSON', pending: 'Préparation…', prepared: 'Export préparé. Consultez vos téléchargements.',
    failed: 'Impossible de préparer l’export. Vérifiez vos accès et vos filtres, puis réessayez.', unavailable: 'Non disponible',
    notes: 'Périmètre', workspaceId: 'Identifiant de l’espace', record: 'Enregistrement', workspace: 'Espace', measure: 'Mesure', value: 'Valeur', of: 'Sur',
    metadata: 'Contexte de l’export', total: 'Totaux des espaces correspondants', coverage: 'Couverture', row: 'Espace',
    generatedAt: 'Généré le (UTC)', windowDays: 'Période des échecs (jours)', limit: 'Limite d’espaces', truncated: 'Liste des espaces tronquée',
    q: 'Recherche par nom d’espace', sort: 'Tri', order: 'Ordre', attentionOnly: 'Filtre d’attention', exported: 'Espaces exportés',
    workspaces: 'Espaces correspondants', needingAttention: 'Espaces nécessitant une attention',
    channels: 'Canaux', disconnected: 'Canaux ne pouvant pas publier', scheduled: 'Publications planifiées', failedPosts: 'Publications en échec',
    waitingConversations: 'Conversations en attente', openTasks: 'Tâches ouvertes', overdueTasks: 'Tâches en retard', members: 'Membres de l’équipe', clients: 'Clients',
    publishing: 'Publication', inbox: 'Boîte de réception', tasks: 'Tâches', team: 'Équipe', role: 'Rôle', state: 'État', needsAttention: 'Attention requise',
    available: 'Disponible', suspended: 'Suspendu', deleting: 'Suppression des données en cours', owner: 'Propriétaire', admin: 'Admin', yes: 'Oui', no: 'Non',
  },
} as const;
export type AgencyExportLocale = keyof typeof agencyExportCopy;
export const agencyExportLocale = (language: string | null): AgencyExportLocale => language?.trim().toLowerCase().startsWith('fr') ? 'fr' : 'en';

export type AgencyExportCatalog = { [L in keyof typeof agencyExportCopy]: { [K in keyof typeof agencyExportCopy[L]]: string } };
/** Root uses the same per-key English/French shape as the screen catalogs. */
export const agencyExportCatalog = Object.fromEntries(Object.keys(agencyExportCopy.en).map(key => [key, { en: agencyExportCopy.en[key as keyof typeof agencyExportCopy.en], fr: agencyExportCopy.fr[key as keyof typeof agencyExportCopy.fr] }])) as { [K in keyof typeof agencyExportCopy.en]: { en: string; fr: string } };
export const agencyExportCopySchema = z.object(Object.fromEntries(Object.keys(agencyExportCatalog).map(key => [key, z.object({ en: z.string().min(1).max(4000), fr: z.string().min(1).max(4000) }).strict()])) as { [K in keyof typeof agencyExportCatalog]: z.ZodObject<{ en: z.ZodString; fr: z.ZodString }> }).strict();
export function exportCopyByLocale(catalog: typeof agencyExportCatalog): AgencyExportCatalog {
  const locale = (language: 'en' | 'fr') => Object.fromEntries(Object.entries(catalog).map(([key, value]) => [key, value[language]]));
  return { en: locale('en'), fr: locale('fr') } as AgencyExportCatalog;
}
