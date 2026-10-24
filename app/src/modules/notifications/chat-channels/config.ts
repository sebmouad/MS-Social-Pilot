import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const chatPolicySchema = z.object({
  deliveryBatchSize: z.number().int().min(1).max(500).default(25),
  deliveryLeaseSeconds: z.number().int().min(60).max(3600).default(300),
  ownerLimit: z.number().int().min(1).max(500).default(50),
  maxChannels: z.number().int().min(1).max(500),
  maxNameCharacters: z.number().int().min(1).max(200),
  maxIdentifierCharacters: z.number().int().min(20).max(500),
  timeoutMs: z.number().int().min(100).max(30000),
  transactionTimeoutMs: z.number().int().min(1000).max(120000),
  transactionMaxWaitMs: z.number().int().min(100).max(10000),
  slackOrigin: z.literal('https://hooks.slack.com'),
  telegramOrigin: z.literal('https://api.telegram.org'),
}).strict().refine(value => value.transactionTimeoutMs > value.timeoutMs, 'The transaction must outlast the delivery timeout.').refine(value => value.deliveryLeaseSeconds * 1000 > value.transactionTimeoutMs, 'The delivery lease must outlast a delivery transaction.');

export const CHAT_POLICY = { deliveryBatchSize: 25, deliveryLeaseSeconds: 300, ownerLimit: 50, maxChannels: 25, maxNameCharacters: 60, maxIdentifierCharacters: 200, timeoutMs: 8000, transactionTimeoutMs: 20000, transactionMaxWaitMs: 1500, slackOrigin: 'https://hooks.slack.com', telegramOrigin: 'https://api.telegram.org' } as const;

export const CHAT_COPY = {
  en: {
    title: 'Team chat alerts', description: 'Send important workspace updates to Slack or Telegram.',
    add: 'Add a destination', name: 'Name', kind: 'Service', url: 'Slack incoming webhook URL', botToken: 'Telegram bot token', chatId: 'Telegram chat ID',
    events: 'Updates to send', updateEvents: 'Save updates', inboxAlert: 'Inbox needs attention', operatorIncident: 'Installation alert', publishFailure: 'Publication failed', connectionExpired: 'Connection expired', approvalRequest: 'Approval requested', approvalDecision: 'Approval decision', reviewDecision: 'Client review decision',
    save: 'Add destination', test: 'Send test', remove: 'Delete', enable: 'Enable', disable: 'Pause', active: 'Active', paused: 'Paused',
    lastSent: 'Last accepted message', never: 'No message sent', failed: 'Delivery needs attention', empty: 'No chat destinations yet. Add Slack or Telegram to keep your team informed.',
    confirmTitle: 'Confirm chat change', confirm: 'Confirm', cancel: 'Cancel', confirmation: 'Type this confirmation', pending: 'Working…',
    consequence: 'This changes the selected chat destination. A test sends one message immediately without automatic retries.',
    error: 'The change could not be confirmed. Refresh and review destinations before trying again.', unavailable: 'Chat alerts are temporarily unavailable. Try again later.', invalid: 'Check the destination details, selected updates and exact confirmation.', forbidden: 'Only workspace owners and admins with notification access can manage team chats.', conflict: 'The destination cannot be changed right now. Check workspace access and destination limits.', notFound: 'This destination is unavailable in this workspace.', rejected: 'The chat service rejected the test. Review the destination before trying again.',
    saved: 'Destination saved.', deleted: 'Destination deleted.', sent: 'The chat service accepted the test message.', uncertain: 'Delivery was not confirmed. Check the chat before sending another test.',
    testMessage: 'MS Social Pilot: your team chat test message.',
    inboxAlertMessage: 'Your inbox needs attention in MS Social Pilot.', operatorIncidentMessage: 'An installation monitoring update is available in MS Social Pilot.', publishFailureMessage: 'A publication needs attention in MS Social Pilot.', connectionExpiredMessage: 'A workspace connection needs to be renewed in MS Social Pilot.', approvalRequestMessage: 'A post is awaiting approval in MS Social Pilot.', approvalDecisionMessage: 'An approval decision is available in MS Social Pilot.', reviewDecisionMessage: 'A client review decision is available in MS Social Pilot.',
  },
  fr: {
    title: 'Alertes de discussion', description: 'Envoyez les mises à jour importantes de votre espace vers Slack ou Telegram.',
    add: 'Ajouter une destination', name: 'Nom', kind: 'Service', url: 'URL du webhook entrant Slack', botToken: 'Jeton du bot Telegram', chatId: 'Identifiant de discussion Telegram',
    events: 'Mises à jour à envoyer', updateEvents: 'Enregistrer les mises à jour', inboxAlert: 'Boîte de réception à vérifier', operatorIncident: 'Alerte de l’installation', publishFailure: 'Échec de publication', connectionExpired: 'Connexion expirée', approvalRequest: 'Validation demandée', approvalDecision: 'Décision de validation', reviewDecision: 'Décision du client',
    save: 'Ajouter la destination', test: 'Envoyer un test', remove: 'Supprimer', enable: 'Activer', disable: 'Mettre en pause', active: 'Active', paused: 'En pause',
    lastSent: 'Dernier message accepté', never: 'Aucun message envoyé', failed: 'Envoi à vérifier', empty: 'Aucune destination pour le moment. Ajoutez Slack ou Telegram pour informer votre équipe.',
    confirmTitle: 'Confirmer la modification', confirm: 'Confirmer', cancel: 'Annuler', confirmation: 'Saisissez cette confirmation', pending: 'En cours…',
    consequence: 'Cette action modifie la destination sélectionnée. Un test envoie un message immédiatement, sans nouvelle tentative automatique.',
    error: 'La modification n’a pas pu être confirmée. Actualisez et vérifiez les destinations avant de réessayer.', unavailable: 'Les alertes de discussion sont temporairement indisponibles. Réessayez plus tard.', invalid: 'Vérifiez la destination, les mises à jour sélectionnées et la confirmation exacte.', forbidden: 'Seuls les propriétaires et administrateurs autorisés de cet espace peuvent gérer les discussions.', conflict: 'Cette destination ne peut pas être modifiée maintenant. Vérifiez l’accès à l’espace et les limites des destinations.', notFound: 'Cette destination est indisponible dans cet espace.', rejected: 'Le service de discussion a refusé le test. Vérifiez la destination avant de réessayer.',
    saved: 'Destination enregistrée.', deleted: 'Destination supprimée.', sent: 'Le service de discussion a accepté le message de test.', uncertain: 'L’envoi n’a pas été confirmé. Vérifiez la discussion avant un autre test.',
    testMessage: 'MS Social Pilot : message de test pour votre équipe.',
    inboxAlertMessage: 'Votre boîte de réception nécessite votre attention dans MS Social Pilot.', operatorIncidentMessage: 'Une mise à jour de la surveillance de l’installation est disponible dans MS Social Pilot.', publishFailureMessage: 'Une publication nécessite votre attention dans MS Social Pilot.', connectionExpiredMessage: 'Une connexion de votre espace doit être renouvelée dans MS Social Pilot.', approvalRequestMessage: 'Une publication attend une validation dans MS Social Pilot.', approvalDecisionMessage: 'Une décision de validation est disponible dans MS Social Pilot.', reviewDecisionMessage: 'Une décision du client est disponible dans MS Social Pilot.',
  },
};
export type ChatCopy = { [K in keyof typeof CHAT_COPY.en]: string };
const newCopyKeys = new Set(['inboxAlert', 'inboxAlertMessage', 'operatorIncident', 'operatorIncidentMessage']);
const localeSchema = (locale: 'en' | 'fr') => z.object(Object.fromEntries(Object.keys(CHAT_COPY.en).map(key => {
  const text = z.string().trim().min(1);
  return [key, newCopyKeys.has(key) ? text.default(CHAT_COPY[locale][key as keyof ChatCopy]) : text];
})) as unknown as Record<keyof ChatCopy, z.ZodType<string, z.ZodTypeDef, unknown>>).strict();
export const chatCopySchema = z.object({ en: localeSchema('en'), fr: localeSchema('fr') }).strict();
export const CHAT_CHANNELS_CONFIG = [
  entry({ key: 'notifications.chatPolicy', group: 'Settings · Notifications', label: 'Team chat delivery policy', kind: 'json', description: 'Workspace destination limits, delivery timeout and approved service origins. Origins are pinned to prevent internal-network requests.', defaultValue: CHAT_POLICY, schema: chatPolicySchema, consumption: 'active' }),
  entry({ key: 'notifications.chatCopy', group: 'Settings · Notifications', label: 'Team chat English and French copy', kind: 'json', description: 'Screen feedback and content-free messages sent to team chats.', defaultValue: CHAT_COPY, schema: chatCopySchema, consumption: 'active' }),
] as const;
