import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const alertPolicySchema = z.object({
  historyLimit: z.number().int().min(1).max(500),
  publishFailureWindowMinutes: z.number().int().min(1).max(1440),
  publishFailureThreshold: z.number().int().min(1).max(10000),
  backupStaleHours: z.number().int().min(1).max(720),
  diskPath: z.string().trim().min(1), diskPercent: z.number().int().min(1).max(100),
  testEmail: z.string().trim().email().or(z.literal('')),
  telegramChatId: z.string().trim(),
}).strict();
export const ALERT_POLICY = { historyLimit: 50, publishFailureWindowMinutes: 60, publishFailureThreshold: 3, backupStaleHours: 48, diskPath: '/', diskPercent: 90, testEmail: '', telegramChatId: '' };
export const ALERT_COPY = {
  en: { title: 'Installation alerts', intro: 'Recorded incidents and delivery checks for this installation.', key: 'Check', opened: 'Opened', resolved: 'Resolved', active: 'Open', empty: 'No incidents recorded.', test: 'Send test alert', run: 'Check incidents', confirm: 'Confirm', cancel: 'Cancel', confirmTitle: 'Confirm installation alert action', confirmation: 'Type this confirmation', pending: 'Checking…', consequence: 'Incident checks update the recorded state. A test sends one email and, when configured, one Telegram message. No automatic retries.', failure: 'The outcome could not be confirmed. Review alerts and message delivery before repeating.', unavailable: 'Installation alerts are unavailable.', testTitle: 'MS Social Pilot: installation alert test', testBody: 'This is a test of installation alert delivery.', finished: 'Check completed. Review the recorded outcomes.', unknown: 'Not available', email: 'Email', telegram: 'Telegram', sent: 'Accepted', failed: 'Failed', uncertain: 'Unconfirmed', disabled: 'Not configured', worker: 'Worker heartbeat', publish: 'Publication failures', backup: 'Backup health', disk: 'Disk space' },
  fr: { title: 'Alertes de l’installation', intro: 'Incidents enregistrés et contrôles d’envoi pour cette installation.', key: 'Contrôle', opened: 'Ouverture', resolved: 'Résolution', active: 'En cours', empty: 'Aucun incident enregistré.', test: 'Envoyer une alerte de test', run: 'Vérifier les incidents', confirm: 'Confirmer', cancel: 'Annuler', confirmTitle: 'Confirmer le contrôle des alertes', confirmation: 'Saisissez cette confirmation', pending: 'Vérification…', consequence: 'Les contrôles actualisent les incidents enregistrés. Un test envoie un e-mail et, si configuré, un message Telegram. Aucune nouvelle tentative automatique.', failure: 'Le résultat n’a pas pu être confirmé. Vérifiez les alertes et les messages avant de recommencer.', unavailable: 'Les alertes de l’installation sont indisponibles.', testTitle: 'MS Social Pilot : test des alertes de l’installation', testBody: 'Ceci est un test d’envoi des alertes de l’installation.', finished: 'Contrôle terminé. Consultez les résultats enregistrés.', unknown: 'Non disponible', email: 'E-mail', telegram: 'Telegram', sent: 'Accepté', failed: 'Échec', uncertain: 'Non confirmé', disabled: 'Non configuré', worker: 'Activité du traitement', publish: 'Échecs de publication', backup: 'État des sauvegardes', disk: 'Espace disque' },
};
export type AlertCopy = { [K in keyof typeof ALERT_COPY.en]: string };
const copy = z.object(Object.fromEntries(Object.keys(ALERT_COPY.en).map(key => [key, z.string().trim().min(1)])) as Record<keyof AlertCopy, z.ZodString>).strict();
export const alertCopySchema = z.object({ en: copy, fr: copy }).strict();
export const SYSTEM_ALERTS_CONFIG = [
  entry({ key: 'notifications.systemAlertPolicy', group: 'Settings · Notifications', label: 'Installation alert checks', kind: 'json', description: 'Incident thresholds, history bound, disk path and optional test recipients. Empty email uses the active installation owner’s address.', defaultValue: ALERT_POLICY, schema: alertPolicySchema, consumption: 'active' }),
  entry({ key: 'notifications.systemAlertCopy', group: 'Settings · Notifications', label: 'Installation alert English and French copy', kind: 'json', description: 'Installation alert screen and content-free test message copy.', defaultValue: ALERT_COPY, schema: alertCopySchema, consumption: 'active' }),
  entry({ key: 'notifications.systemAlertTelegramToken', group: 'Settings · Notifications', label: 'Installation alert Telegram bot token', kind: 'secret', description: 'Encrypted bot credential used only by installation alert delivery tests.', defaultValue: '', schema: z.string(), consumption: 'active' }),
] as const;
