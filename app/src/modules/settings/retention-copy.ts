import { z } from 'zod';

export const RETENTION_COPY = {
  en: {
    title: 'Old records',
    intro: 'A nightly job removes records nobody reads after a while: the activity trail, the email log, click details, AI history, old errors and worker history. Totals on links, saved posts, feeds and analytics snapshots are never removed.',
    activity: 'Activity trail',
    emails: 'Email log',
    clicks: 'Click details',
    ai: 'AI history',
    errors: 'Old errors',
    syncRuns: 'Worker history',
    reports: 'Report history',
    olderThan: 'Older than {days} days',
    pendingNow: '{count} ready to remove now',
    noneNow: 'Nothing to remove right now.',
    lastRun: 'Last nightly cleanup: {summary}',
    neverRun: 'The nightly cleanup has not run yet.',
    runNow: 'Clean up now',
    cancel: 'Keep everything',
    working: 'Removing old records…',
    runReview: 'Remove this workspace’s old records now? This cannot be undone.',
    ran: 'Old records were removed.',
    failed: 'The cleanup could not finish. Try again.',
    forbidden: 'Only workspace owners and admins can clean up old records.',
    invalid: 'Check the cleanup request and confirm the exact phrase.',
    unavailable: 'The cleanup is temporarily unavailable. Try again later.',
  },
  fr: {
    title: 'Anciens enregistrements',
    intro: 'Chaque nuit, une tâche supprime les enregistrements que personne ne relit après un moment : journal d’activité, journal des e-mails, détail des clics, historique IA, anciennes erreurs et historique des tâches. Les totaux des liens, les publications, les flux et les mesures restent intacts.',
    activity: 'Journal d’activité',
    emails: 'Journal des e-mails',
    clicks: 'Détail des clics',
    ai: 'Historique IA',
    errors: 'Anciennes erreurs',
    syncRuns: 'Historique des tâches',
    reports: 'Historique des rapports',
    olderThan: 'Antérieur à {days} jours',
    pendingNow: '{count} à supprimer maintenant',
    noneNow: 'Rien à supprimer pour le moment.',
    lastRun: 'Dernier nettoyage : {summary}',
    neverRun: 'Le nettoyage de nuit n’a pas encore eu lieu.',
    runNow: 'Nettoyer maintenant',
    cancel: 'Tout garder',
    working: 'Suppression des anciens enregistrements…',
    runReview: 'Supprimer maintenant les anciens enregistrements de cet espace ? Cette action est définitive.',
    ran: 'Les anciens enregistrements ont été supprimés.',
    failed: 'Le nettoyage n’a pas pu se terminer. Réessayez.',
    forbidden: 'Seuls les propriétaires et administrateurs peuvent nettoyer les anciens enregistrements.',
    invalid: 'Vérifiez la demande et confirmez la phrase exacte.',
    unavailable: 'Le nettoyage est momentanément indisponible. Réessayez plus tard.',
  },
} as const;

const shape = z.object(Object.fromEntries(Object.keys(RETENTION_COPY.en).map(key => [key, z.string().min(1).max(2000)])) as { [K in keyof (typeof RETENTION_COPY)['en']]: z.ZodString });
export type RetentionCopy = z.infer<typeof shape>;
export const retentionCopySchema = z.object({ en: shape, fr: shape }).strict();
export type RetentionCopyCatalog = z.infer<typeof retentionCopySchema>;
