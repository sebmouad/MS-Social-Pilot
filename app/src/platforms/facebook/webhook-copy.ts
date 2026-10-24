import { z } from 'zod';

/**
 * English and French labels for the private Root webhook-deliveries panel.
 * Leaf module on purpose: the platform registration imports the defaults and
 * schema, while the runtime loader lives in webhooks.ts.
 */
const webhookDeliveriesCopyLanguageSchema = z.object({
  title: z.string().min(1), intro: z.string().min(1), empty: z.string().min(1), unavailable: z.string().min(1),
  received: z.string().min(1), page: z.string().min(1), kind: z.string().min(1), status: z.string().min(1),
  targets: z.string().min(1), detail: z.string().min(1),
  kinds: z.object({ feed_post: z.string().min(1), feed_comment: z.string().min(1), message: z.string().min(1), unknown: z.string().min(1) }),
  statuses: z.object({ accepted: z.string().min(1), duplicate: z.string().min(1), unmatched: z.string().min(1), ignored: z.string().min(1) }),
  written: z.string().min(1), verb: z.string().min(1), disabled: z.string().min(1), unknownEvent: z.string().min(1),
});
export const metaWebhookDeliveriesCopySchema = z.object({ en: webhookDeliveriesCopyLanguageSchema, fr: webhookDeliveriesCopyLanguageSchema });
export type MetaWebhookDeliveriesCopy = z.infer<typeof webhookDeliveriesCopyLanguageSchema>;

export const META_WEBHOOK_DELIVERIES_COPY_DEFAULTS: Record<'en' | 'fr', MetaWebhookDeliveriesCopy> = {
  en: {
    title: 'Meta webhook deliveries', intro: 'Recent Page feed, comment and message deliveries received from Meta. Receipts are content-free: kinds, verbs and counts only, never message text.',
    empty: 'No webhook deliveries have been received yet.', unavailable: 'Webhook diagnostics are unavailable right now.',
    received: 'Received', page: 'Page', kind: 'Event', status: 'Outcome', targets: 'Channels', detail: 'Detail',
    kinds: { feed_post: 'Page post', feed_comment: 'Comment', message: 'Message', unknown: 'Other' },
    statuses: { accepted: 'Stored', duplicate: 'Duplicate', unmatched: 'Unmatched', ignored: 'Ignored' },
    written: 'stored', verb: 'change', disabled: 'Reception is switched off', unknownEvent: 'Not a stored event',
  },
  fr: {
    title: 'Réceptions des webhooks Meta', intro: 'Dernières réceptions des publications, commentaires et messages de Page envoyées par Meta. Les reçus sont sans contenu : natures, verbes et compteurs uniquement, jamais le texte des messages.',
    empty: 'Aucune réception de webhook pour le moment.', unavailable: 'Le diagnostic des webhooks est indisponible pour le moment.',
    received: 'Reçue', page: 'Page', kind: 'Événement', status: 'Résultat', targets: 'Canaux', detail: 'Détail',
    kinds: { feed_post: 'Publication de Page', feed_comment: 'Commentaire', message: 'Message', unknown: 'Autre' },
    statuses: { accepted: 'Enregistrée', duplicate: 'Doublon', unmatched: 'Sans correspondance', ignored: 'Ignorée' },
    written: 'enregistré(s)', verb: 'modification', disabled: 'La réception est désactivée', unknownEvent: 'Pas un événement enregistré',
  },
};
