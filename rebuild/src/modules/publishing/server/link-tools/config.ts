import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const linkToolsPolicySchema = z.object({
  /** Longest wait for one page, in milliseconds. */
  timeoutMs: z.number().int().min(1000).max(60000),
  /** Bytes read for a link card (the head of a page) and for structured data (often at the end of a page). */
  previewMaxBytes: z.number().int().min(10000).max(5000000), structuredMaxBytes: z.number().int().min(10000).max(10000000),
  maxRedirects: z.number().int().min(0).max(10), allowHttp: z.boolean(),
  /** When not empty, only these hosts may be fetched. */
  hostAllowlist: z.array(z.string().trim().min(1).max(253)).max(200),
  /** Sent as the crawler name; some sites serve cards only to recognised crawlers. */
  previewUserAgent: z.string().min(3).max(200), structuredUserAgent: z.string().min(3).max(200),
  /** Requests per workspace per rolling hour, counted from the audit trail. */
  hourlyRequests: z.number().int().min(1).max(100000),
  /** Time zone used to write event and deadline dates into captions (IANA name, for example UTC). */
  captionTimeZone: z.string().min(1).max(60),
  maxImportImages: z.number().int().min(1).max(50), maxUrlCharacters: z.number().int().min(100).max(8000),
  titleCharacters: z.number().int().min(20).max(1000), descriptionCharacters: z.number().int().min(20).max(5000),
  limits: z.object({ images: z.number().int().min(1).max(50), steps: z.number().int().min(1).max(100), items: z.number().int().min(1).max(50), descriptionCharacters: z.number().int().min(20).max(5000) }).strict(),
}).strict();
export type LinkToolsPolicy = z.infer<typeof linkToolsPolicySchema>;

const copy = z.record(z.string(), z.string().min(1));
export const linkToolsCopySchema = z.object({ en: copy, fr: copy });
const FACT_KEYS = ['price', 'availability', 'brand', 'rating', 'starts', 'ends', 'place', 'organizer', 'totalTime', 'servings', 'employer', 'location', 'salary', 'employmentType', 'deadline', 'provider', 'address', 'phone', 'author', 'published'] as const;
export const LINK_TOOLS_COPY = {
  en: {
    previewTitle: 'Link preview', url: 'Web address', fetchPreview: 'Show preview', fetching: 'Fetching…', refresh: 'Refresh the channel’s cached card', refreshNote: 'Asks the channel’s platform to read the page again. Use it after changing the page’s title or image.', refreshConfirm: 'I want the platform to re-read this page', noPreview: 'No preview was found for this address.', source_html: 'Read from the page', source_platform: 'Read by the platform',
    structuredTitle: 'Posts from a page’s details', structuredIntro: 'Reads the details a page describes for search engines (articles, products, events, recipes, jobs, courses, places) and turns them into a caption you can edit.', findDetails: 'Find details', noDetails: 'No usable details were found on this page.', useCaption: 'Use this caption', template_facts: 'Key facts', template_offer: 'Offer', template_countdown: 'Countdown', template_steps: 'Steps', importImages: 'Copy pictures to my library', importConfirm: 'I may use these pictures', imported: 'Pictures copied.', importPartial: 'Some pictures could not be copied.', ingredients: 'Ingredients', steps: 'Steps',
    countdownToday: 'Today', countdownTomorrow: 'Tomorrow', countdownDays: 'In {days} days', minutesOnly: '{minutes} min', hoursOnly: '{hours} h', hoursMinutes: '{hours} h {minutes} min', rating: '{rating}/5 ({count} reviews)', ratingNoCount: '{rating}/5',
    unit_HOUR: 'per hour', unit_DAY: 'per day', unit_WEEK: 'per week', unit_MONTH: 'per month', unit_YEAR: 'per year',
    availability_InStock: 'In stock', availability_OutOfStock: 'Out of stock', availability_PreOrder: 'Pre-order', availability_SoldOut: 'Sold out', availability_LimitedAvailability: 'Limited availability', availability_OnlineOnly: 'Online only', availability_InStoreOnly: 'In store only', availability_Discontinued: 'Discontinued', availability_BackOrder: 'Back-order',
    ...Object.fromEntries(FACT_KEYS.map(key => [`fact_${key}`, { price: 'Price', availability: 'Availability', brand: 'Brand', rating: 'Rating', starts: 'Starts', ends: 'Ends', place: 'Where', organizer: 'Organizer', totalTime: 'Total time', servings: 'Servings', employer: 'Employer', location: 'Location', salary: 'Salary', employmentType: 'Type', deadline: 'Apply by', provider: 'Provider', address: 'Address', phone: 'Phone', author: 'Author', published: 'Published' }[key]])),
    invalidUrl: 'Enter a full web address starting with http:// or https://.', confirmation: 'Confirm this action.', rateLimited: 'Too many link requests this hour. Try again later.', failed: 'We could not read that address. Your text is unchanged.',
  },
  fr: {
    previewTitle: 'Aperçu du lien', url: 'Adresse web', fetchPreview: 'Afficher l’aperçu', fetching: 'Chargement…', refresh: 'Actualiser la carte en cache du canal', refreshNote: 'Demande à la plateforme de relire la page. À utiliser après avoir changé le titre ou l’image de la page.', refreshConfirm: 'Je veux que la plateforme relise cette page', noPreview: 'Aucun aperçu trouvé pour cette adresse.', source_html: 'Lu depuis la page', source_platform: 'Lu par la plateforme',
    structuredTitle: 'Publications depuis les détails d’une page', structuredIntro: 'Lit les détails qu’une page décrit pour les moteurs de recherche (articles, produits, événements, recettes, offres d’emploi, formations, lieux) et en fait une légende modifiable.', findDetails: 'Trouver les détails', noDetails: 'Aucun détail exploitable sur cette page.', useCaption: 'Utiliser cette légende', template_facts: 'Points clés', template_offer: 'Offre', template_countdown: 'Compte à rebours', template_steps: 'Étapes', importImages: 'Copier les images dans ma bibliothèque', importConfirm: 'J’ai le droit d’utiliser ces images', imported: 'Images copiées.', importPartial: 'Certaines images n’ont pas pu être copiées.', ingredients: 'Ingrédients', steps: 'Étapes',
    countdownToday: 'Aujourd’hui', countdownTomorrow: 'Demain', countdownDays: 'Dans {days} jours', minutesOnly: '{minutes} min', hoursOnly: '{hours} h', hoursMinutes: '{hours} h {minutes} min', rating: '{rating}/5 ({count} avis)', ratingNoCount: '{rating}/5',
    unit_HOUR: 'par heure', unit_DAY: 'par jour', unit_WEEK: 'par semaine', unit_MONTH: 'par mois', unit_YEAR: 'par an',
    availability_InStock: 'En stock', availability_OutOfStock: 'Rupture de stock', availability_PreOrder: 'Précommande', availability_SoldOut: 'Épuisé', availability_LimitedAvailability: 'Disponibilité limitée', availability_OnlineOnly: 'En ligne uniquement', availability_InStoreOnly: 'En magasin uniquement', availability_Discontinued: 'Arrêté', availability_BackOrder: 'Sur commande',
    ...Object.fromEntries(FACT_KEYS.map(key => [`fact_${key}`, { price: 'Prix', availability: 'Disponibilité', brand: 'Marque', rating: 'Note', starts: 'Début', ends: 'Fin', place: 'Lieu', organizer: 'Organisateur', totalTime: 'Durée totale', servings: 'Portions', employer: 'Employeur', location: 'Localisation', salary: 'Salaire', employmentType: 'Type', deadline: 'Candidater avant', provider: 'Fournisseur', address: 'Adresse', phone: 'Téléphone', author: 'Auteur', published: 'Publié' }[key]])),
    invalidUrl: 'Saisissez une adresse web complète commençant par http:// ou https://.', confirmation: 'Confirmez cette action.', rateLimited: 'Trop de demandes de liens cette heure. Réessayez plus tard.', failed: 'Impossible de lire cette adresse. Votre texte est inchangé.',
  },
} as const;

export const LINK_TOOLS_CONFIG = [
  entry({ key: 'publishing.linkTools.policy', group: 'Publishing · Link tools', label: 'Link preview and page details policy', description: 'Timeouts, byte limits, redirects, HTTP allowance, host allowlist, crawler names, hourly request limit per workspace, import size and the structured-data extraction limits. Fetches use the shared address-pinned guard that refuses private networks.', kind: 'json', defaultValue: { timeoutMs: 10000, previewMaxBytes: 524288, structuredMaxBytes: 2097152, maxRedirects: 3, allowHttp: true, hostAllowlist: [], previewUserAgent: 'facebookexternalhit/1.1 (+MS-Social-Pilot link preview)', structuredUserAgent: 'MS-Social-Pilot (+structured data)', hourlyRequests: 120, captionTimeZone: 'UTC', maxImportImages: 10, maxUrlCharacters: 2000, titleCharacters: 200, descriptionCharacters: 500, limits: { images: 10, steps: 15, items: 10, descriptionCharacters: 300 } }, schema: linkToolsPolicySchema, consumption: 'active' }),
  entry({ key: 'publishing.linkTools.copy', group: 'Publishing · Link tools', label: 'Link tools English / French copy', description: 'Customer labels, caption words (fact names, availability, durations, countdowns, salary units) and failures for link previews and page-detail captions. {placeholders} are replaced at run time.', kind: 'json', defaultValue: LINK_TOOLS_COPY, schema: linkToolsCopySchema, consumption: 'active' }),
] as const;
