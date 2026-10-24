import { z } from 'zod';

const moveSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  unit: z.enum(['hour', 'day']),
  amount: z.number().int().min(-366).max(366).refine(value => value !== 0),
  label: z.object({ en: z.string().trim().min(1).max(200), fr: z.string().trim().min(1).max(200) }).strict(),
}).strict();
export const reschedulePolicySchema = z.object({
  locale: z.enum(['en-US', 'fr-FR']),
  hour12: z.boolean(),
  moves: z.array(moveSchema).max(30).refine(moves => new Set(moves.map(move => move.id)).size === moves.length, 'Move identifiers must be unique.'),
  failure: z.object({ en: z.string().trim().min(1).max(2000), fr: z.string().trim().min(1).max(2000) }).strict(),
}).strict();
export type ReschedulePolicy = z.infer<typeof reschedulePolicySchema>;
/** One shared catalog for synchronous bootstrap and the typed Root declaration. */
export const RESCHEDULE_POLICY: ReschedulePolicy = {
  locale: 'en-US', hour12: true,
  moves: [
    { id: 'hour-earlier', unit: 'hour', amount: -1, label: { en: '1 hour earlier', fr: '1 heure plus tôt' } },
    { id: 'hour-later', unit: 'hour', amount: 1, label: { en: '1 hour later', fr: '1 heure plus tard' } },
    { id: 'day-earlier', unit: 'day', amount: -1, label: { en: '1 day earlier', fr: '1 jour plus tôt' } },
    { id: 'day-later', unit: 'day', amount: 1, label: { en: '1 day later', fr: '1 jour plus tard' } },
    { id: 'week-earlier', unit: 'day', amount: -7, label: { en: '1 week earlier', fr: '1 semaine plus tôt' } },
    { id: 'week-later', unit: 'day', amount: 7, label: { en: '1 week later', fr: '1 semaine plus tard' } },
  ],
  failure: { en: 'The post could not be moved. Reload the calendar and try again.', fr: 'La publication n’a pas pu être déplacée. Actualisez le calendrier et réessayez.' },
};
