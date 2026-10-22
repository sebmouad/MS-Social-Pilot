import { z } from 'zod';
import { entry, cron } from '@/lib/config/entry';

const ratio = z.string().regex(/^\d{1,2}:\d{1,2}$/);
export const aiVideoPolicySchema = z.object({
  /** HTTPS base of the provider's long-running video API. */
  baseUrl: z.string().url().max(500).refine(v => v.startsWith('https://'), 'Use an HTTPS URL.'),
  /** Model names are never typed: the newest listed model matching this pattern that can generate videos is used. */
  modelPattern: z.string().min(1).max(100), excludeModelPattern: z.string().max(100),
  aspectRatios: z.array(ratio).min(1).max(6),
  promptMinCharacters: z.number().int().min(1).max(1000), promptMaxCharacters: z.number().int().min(10).max(10000),
  maxWorkingPerWorkspace: z.number().int().min(1).max(50), listLimit: z.number().int().min(1).max(100),
  pollBatch: z.number().int().min(1).max(200), giveUpMs: z.number().int().min(60000).max(86400000),
  requestTimeoutMs: z.number().int().min(1000).max(120000), downloadTimeoutMs: z.number().int().min(5000).max(600000),
  downloadMaxBytes: z.number().int().min(1048576).max(2147483647),
  /** The finished-file address must be on one of these hosts (suffix match) and HTTPS. */
  downloadHostSuffixes: z.array(z.string().min(3).max(100)).min(1).max(20),
}).strict();
export type AiVideoPolicy = z.infer<typeof aiVideoPolicySchema>;

const copy = z.record(z.string(), z.string().min(1));
export const aiVideoCopySchema = z.object({ en: copy, fr: copy });
export const AI_VIDEO_COPY = {
  en: { title: 'AI videos', intro: 'Describe a short clip. It is made in the background and saved to your media library when ready.', prompt: 'Describe the video', promptHint: 'A slow pan over a sunlit bakery counter with fresh bread', aspect: 'Shape', landscape: 'Landscape (16:9)', portrait: 'Portrait (9:16)', confirm: 'I understand this uses my AI allowance', start: 'Make video', starting: 'Starting…', recent: 'Recent videos', empty: 'No videos yet. Describe one above.', working: 'Being made', ready: 'In your media library', failed: 'Not made', refresh: 'Check progress', unavailable: 'AI videos are not available for this workspace.', started: 'Your video is on its way. It usually takes a few minutes.', failedSave: 'We could not start this video. Your description is still here. Try again.', timeout: 'The provider took too long. Try again.', refused: 'The provider could not make this video. Its safety rules may have refused the description.', provider: 'The provider could not make this video. Try again later.', access_changed: 'Your access changed before the video finished, so it was not saved.', storage: 'The finished video could not be saved to your media library.', too_large: 'The finished video is larger than your library accepts.', unknown: 'This video could not be made.', busy: 'Wait for your current videos to finish before starting another.', confirmation: 'Confirm the video request.' },
  fr: { title: 'Vidéos IA', intro: 'Décrivez un court clip. Il est créé en arrière-plan puis enregistré dans votre bibliothèque de médias.', prompt: 'Décrivez la vidéo', promptHint: 'Un lent travelling sur le comptoir ensoleillé d’une boulangerie', aspect: 'Format', landscape: 'Paysage (16:9)', portrait: 'Portrait (9:16)', confirm: 'Je comprends que cela utilise mon quota IA', start: 'Créer la vidéo', starting: 'Démarrage…', recent: 'Vidéos récentes', empty: 'Aucune vidéo pour le moment. Décrivez-en une ci-dessus.', working: 'En cours de création', ready: 'Dans votre bibliothèque', failed: 'Non créée', refresh: 'Vérifier la progression', unavailable: 'Les vidéos IA ne sont pas disponibles pour cet espace de travail.', started: 'Votre vidéo est en route. Cela prend généralement quelques minutes.', failedSave: 'Impossible de lancer cette vidéo. Votre description est conservée. Réessayez.', timeout: 'Le fournisseur a mis trop de temps. Réessayez.', refused: 'Le fournisseur n’a pas pu créer cette vidéo. Ses règles de sécurité ont peut-être refusé la description.', provider: 'Le fournisseur n’a pas pu créer cette vidéo. Réessayez plus tard.', access_changed: 'Votre accès a changé avant la fin de la vidéo ; elle n’a pas été enregistrée.', storage: 'La vidéo terminée n’a pas pu être enregistrée dans votre bibliothèque.', too_large: 'La vidéo terminée dépasse la taille acceptée par votre bibliothèque.', unknown: 'Cette vidéo n’a pas pu être créée.', busy: 'Attendez la fin de vos vidéos en cours avant d’en lancer une autre.', confirmation: 'Confirmez la demande de vidéo.' },
} as const;
export const AI_VIDEO_JOBS = [{ name: 'aiVideos', label: 'AI video progress', configKey: 'ai.video.schedule' }] as const;

export const AI_VIDEO_CONFIG = [
  entry({ key: 'ai.video.schedule', group: 'AI · Videos', label: 'AI video polling schedule', description: 'Five-field cron schedule in the server timezone. The worker checks videos still being made and saves finished ones to the media library.', kind: 'text', defaultValue: '* * * * *', schema: cron, consumption: 'active' }),
  entry({ key: 'ai.video.policy', group: 'AI · Videos', label: 'AI video policy', description: 'Provider address, model selection, shapes, prompt and concurrency limits, give-up time, polling batch, timeouts, download size and allowed download hosts. Videos use the Gemini key and the workspace AI allowance.', kind: 'json', defaultValue: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', modelPattern: 'veo', excludeModelPattern: 'fast|lite', aspectRatios: ['16:9', '9:16'], promptMinCharacters: 3, promptMaxCharacters: 1000, maxWorkingPerWorkspace: 3, listLimit: 10, pollBatch: 20, giveUpMs: 1800000, requestTimeoutMs: 30000, downloadTimeoutMs: 120000, downloadMaxBytes: 268435456, downloadHostSuffixes: ['googleapis.com'] }, schema: aiVideoPolicySchema, consumption: 'active' }),
  entry({ key: 'ai.video.copy', group: 'AI · Videos', label: 'AI video English / French copy', description: 'Customer labels, progress states and failure explanations for AI videos.', kind: 'json', defaultValue: AI_VIDEO_COPY, schema: aiVideoCopySchema, consumption: 'active' }),
] as const;
