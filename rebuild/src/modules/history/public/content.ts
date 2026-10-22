import { z } from 'zod';

/**
 * Root-editable content of the public site. Paragraphs are separated by a blank line, a line starting with "- " is a
 * list item, and `[label](/path)` or `[label](mailto:address)` makes a link. Nothing else is interpreted, so edited
 * text can never inject markup. `{placeholders}` are filled from the operator details (see resolveLegalValues).
 */
export type SiteLocale = 'en' | 'fr';
export const siteLocale = (language: string | null | undefined): SiteLocale => (language ?? '').trim().toLowerCase().startsWith('fr') ? 'fr' : 'en';

const short = z.string().trim().min(1).max(200);
const long = z.string().trim().min(1).max(8000);
const section = z.object({ title: short, body: long }).strict();
/** Outcome sentence of a finished deletion lookup: Root may reword it but {count} and {when} must stay. */
const resultTemplate = z.string().trim().min(1).max(2000).refine(
  value => value.includes('{count}') && value.includes('{when}'),
  'Keep the {count} and {when} placeholders.',
);

const pageContent = z.object({
  nav: z.object({ label: short, help: short, pricing: short, status: short, changelog: short, privacy: short, terms: short, dataDeletion: short, signIn: short, signUp: short, home: short }).strict(),
  help: z.object({ title: short, lead: long, items: z.array(z.object({ question: short, answer: long }).strict()).max(60) }).strict(),
  pricing: z.object({
    title: short, lead: long, none: long, free: short, perMonth: short, perYear: short,
    channels: short, channelsUnlimited: short, members: short, membersUnlimited: short, posts: short, postsUnlimited: short, extraChannel: short, choose: short,
    featureLabels: z.record(z.string().min(1).max(80), short),
  }).strict(),
  status: z.object({ title: short, lead: long, allUp: short, degraded: short, app: short, scheduler: short, up: short, down: short, checked: short }).strict(),
  changelog: z.object({ title: short, lead: long, empty: long }).strict(),
  privacy: z.object({ title: short, updated: short, notUpdated: long, sections: z.array(section).min(1).max(40) }).strict(),
  terms: z.object({ title: short, updated: short, notUpdated: long, sections: z.array(section).min(1).max(40) }).strict(),
  dataDeletion: z.object({
    title: short, lead: long, sections: z.array(section).min(1).max(20), lookupLabel: short, lookupButton: short,
    // Outcome sentences added after catalogs were first saved in Root: optional so a saved catalog without them stays
    // valid, with the shipped text filling in (see resolveDataDeletionResults).
    resultCompletedOne: resultTemplate.optional(), resultCompletedMany: resultTemplate.optional(),
    resultUnknown: long.optional(), resultInvalid: long.optional(),
  }).strict(),
  fallbacks: z.object({ operatorName: short, operatorEmail: short, governingLaw: short, dataProtection: short, hosting: short }).strict(),
}).strict();

export const siteContentSchema = z.object({ en: pageContent, fr: pageContent }).strict();
export type SiteContent = z.infer<typeof siteContentSchema>;
export type SitePageContent = z.infer<typeof pageContent>;

/** Outcome sentences of the deletion lookup: the facts ({count}, {when}) come from the platform's own record. */
export type DataDeletionResults = { resultCompletedOne: string; resultCompletedMany: string; resultUnknown: string; resultInvalid: string };
const enResults: DataDeletionResults = {
  resultCompletedOne: 'Done on {when}. We removed the stored access for {count} connection and stopped its scheduled work.',
  resultCompletedMany: 'Done on {when}. We removed the stored access for {count} connections and stopped its scheduled work.',
  resultUnknown: 'We found no record for this code. If you used Facebook’s removal option, no access linked to your account was held here.',
  resultInvalid: 'This code is not valid. Open the link shown in your Facebook settings again.',
};
const frResults: DataDeletionResults = {
  resultCompletedOne: 'Terminé le {when}. Nous avons supprimé l’accès enregistré pour {count} connexion et arrêté ses tâches planifiées.',
  resultCompletedMany: 'Terminé le {when}. Nous avons supprimé l’accès enregistré pour {count} connexions et arrêté ses tâches planifiées.',
  resultUnknown: 'Aucun enregistrement n’existe pour ce code. Si vous avez utilisé l’option de suppression de Facebook, aucun accès lié à votre compte n’était conservé ici.',
  resultInvalid: 'Ce code n’est pas valide. Ouvrez à nouveau le lien affiché dans vos paramètres Facebook.',
};
/** Stored catalogs saved before the outcome sentences existed omit them; the shipped locale text fills each gap. */
export function resolveDataDeletionResults(saved: Pick<SitePageContent['dataDeletion'], keyof DataDeletionResults>, locale: SiteLocale): DataDeletionResults {
  const shipped = locale === 'fr' ? frenchTypography(frResults) : enResults;
  return {
    resultCompletedOne: saved.resultCompletedOne ?? shipped.resultCompletedOne,
    resultCompletedMany: saved.resultCompletedMany ?? shipped.resultCompletedMany,
    resultUnknown: saved.resultUnknown ?? shipped.resultUnknown,
    resultInvalid: saved.resultInvalid ?? shipped.resultInvalid,
  };
}

const en: SitePageContent = {
  nav: { label: 'Site', help: 'Help', pricing: 'Pricing', status: 'Status', changelog: 'What’s new', privacy: 'Privacy', terms: 'Terms', dataDeletion: 'Data deletion', signIn: 'Sign in', signUp: 'Create an account', home: 'Home' },
  help: {
    title: 'Help',
    lead: 'Short answers to what people ask before and after signing up.',
    items: [
      { question: 'How do I connect my pages and profiles?', answer: 'After signing up, open Settings › Connections and choose a network. Facebook and Instagram connect with your Facebook login, then you pick which channels to use.' },
      { question: 'How does scheduling work?', answer: 'Write a post once, pick the channels and a time, or add it to a channel’s queue. The app publishes it at that time, even when nobody is signed in.' },
      { question: 'Which networks are supported?', answer: 'The networks the operator of this installation has switched on. Your Connections screen lists exactly what you can connect.' },
      { question: 'Can my team work together?', answer: 'Yes. Invite teammates with a role (admin, editor, contributor, viewer) and choose which channels each one can use.' },
      { question: 'Can clients approve posts?', answer: 'Send an approval link: the client sees the post and approves or asks for changes without creating an account.' },
      { question: 'Where do the numbers come from?', answer: 'Straight from each network’s API, read regularly in the background and kept so history stays available.' },
      { question: 'How do I export or delete my data?', answer: 'Open Settings › Data and privacy. Owners and admins can download a workspace archive or delete workspace data. To remove access given to Facebook, see [data deletion](/data-deletion).' },
    ],
  },
  pricing: {
    title: 'Pricing',
    lead: 'Pick the plan that fits your team. Prices are shown per month unless noted.',
    none: 'Plans have not been published yet. Please check back soon.',
    free: 'Free', perMonth: '{price} per month', perYear: '{price} billed yearly',
    channels: 'Up to {count} channels', channelsUnlimited: 'Unlimited channels',
    members: 'Up to {count} team members', membersUnlimited: 'Unlimited team members',
    posts: 'Up to {count} posts a month', postsUnlimited: 'Unlimited posts',
    extraChannel: '{price} per extra channel', choose: 'Get started',
    featureLabels: { clients: 'Client approval links', whiteLabel: 'White label', api: 'API and MCP access' },
  },
  status: {
    title: 'Status', lead: 'Is the app up, and is the scheduler running? Nothing more is shown publicly.',
    allUp: 'All systems are working', degraded: 'Something is not working as it should',
    app: 'Application', scheduler: 'Scheduler', up: 'Working', down: 'Not responding', checked: 'Checked {time}',
  },
  changelog: { title: 'What’s new', lead: 'The latest improvements, newest first.', empty: 'Nothing has been published yet.' },
  privacy: {
    title: 'Privacy policy', updated: 'Last updated {date}', notUpdated: 'The operator has not set an update date yet.',
    sections: [
      { title: 'Who we are', body: '{productName}{appUrlSuffix} is a publishing and analytics tool for people who manage Facebook Pages. The data controller is {operatorName}{controllerPlace}.\n\nContact: {operatorEmail}.' },
      { title: 'The data we process', body: '- Your account: name, email address and password (stored only as a one-way hash).\n- What Facebook gives us when you connect your profile with Facebook Login: your Facebook name and ID, the Pages and ad accounts you manage, and the matching access tokens.\n- Data of the Pages you choose to connect: posts, comments, messages, insights (reach, views, engagement, followers) and ad results.\n- What you create in the app: post text, images and videos, schedules.\n- Technical logs (time, IP address, errors) for security and reliability.' },
      { title: 'Why', body: 'Only to provide the service you ask for: publishing and scheduling your posts, showing your Pages’ results, answering comments and messages, and building your reports. The app acts only when you (or a teammate you invited) ask it to. We do not sell your data, use it for advertising, or share it with third parties for their own purposes.' },
      { title: 'Who can see it', body: 'Only the members of your workspace. Hosting: {hosting}. Data is sent to Meta only to carry out your actions (publish, reply, hide).' },
      { title: 'Security', body: 'Facebook tokens are encrypted before they are stored, every connection uses HTTPS, and server access is restricted.' },
      { title: 'Retention', body: 'Data is kept while your account or Facebook connection exists. When you disconnect a profile or remove the app from Facebook, the profile and all its access tokens are deleted and its Pages are no longer read or published to. Posts and statistics already stored are erased on request. Backups are erased automatically after the retention period the operator has set.' },
      { title: 'Your rights', body: 'You can access, correct or delete your data, or object to its processing ({dataProtection}), by writing to {operatorEmail}. You can also remove the app from your Facebook settings (Apps and websites): Facebook tells us and your profile and its tokens are deleted — see the [data deletion page](/data-deletion).' },
      { title: 'Cookies', body: 'A single cookie that keeps you signed in, and one that remembers your workspace and appearance. No advertising or analytics cookies.' },
      { title: 'Changes', body: 'Any change will be published on this page with its update date.' },
    ],
  },
  terms: {
    title: 'Terms of service', updated: 'Last updated {date}', notUpdated: 'The operator has not set an update date yet.',
    sections: [
      { title: 'The service', body: '{productName}{appUrlSuffix}, operated by {operatorName}{operatorCountrySuffix}, lets its users publish, schedule and track posts on the Facebook Pages they manage, and answer their comments and messages. By using it you agree to these terms.' },
      { title: 'Who may use it', body: 'Accounts are created by invitation from a workspace owner. You may connect only the profiles, Pages and ad accounts you are authorised to manage, and you are responsible for the people you invite.' },
      { title: 'Your content', body: 'You are responsible for what you publish through {productName}, which must follow Meta’s Terms of Service and Community Standards. Your content stays yours; we use it only to publish and show it when you ask.' },
      { title: 'Facebook access', body: 'You connect Facebook through Facebook Login. The access tokens it grants are stored encrypted and used only for what you ask: publishing, replying, hiding, and reading your Pages’ comments, messages and statistics. You can withdraw access at any time from your Facebook settings, or request deletion of your data on the [data deletion page](/data-deletion).' },
      { title: 'Prohibited use', body: 'You may not use the service for spam, illegal or misleading content, to get around Facebook’s limits, or to reach other people’s Pages or accounts without permission. We may suspend an account that breaks these rules.' },
      { title: 'Availability', body: 'The service is provided as it is, without a guarantee that it will always be available or free of errors. Scheduled posts depend on Facebook accepting them when they are due; if one fails, the app tells you.' },
      { title: 'Liability', body: 'To the extent the law allows, {operatorName} is not liable for indirect losses, or for Meta’s decisions about your Pages, posts or accounts.' },
      { title: 'Personal data', body: 'How personal data is handled is described in the [privacy policy](/privacy-policy).' },
      { title: 'Changes and governing law', body: 'Any change will be published on this page with its date. These terms are governed by {governingLaw}.' },
      { title: 'Contact', body: 'Questions about these terms: {operatorEmail}.' },
    ],
  },
  dataDeletion: {
    title: 'Data deletion',
    lead: 'How to remove the data this app holds about you.',
    sections: [
      { title: 'Remove the app from Facebook', body: 'Open your Facebook settings, go to Apps and websites, find {productName} and choose Remove. Facebook tells us, and we delete the stored access for your profile and stop its scheduled work.' },
      { title: 'Check the outcome', body: 'After removing the app you receive a confirmation code. Enter it below or open the link Facebook shows you to see the result.' },
      { title: 'Delete the rest', body: 'Posts already published belong to the workspace that managed the Page. Its owner can delete workspace data from Settings › Data and privacy. You can also write to {operatorEmail} and we will erase your account data on request.' },
    ],
    lookupLabel: 'Confirmation code', lookupButton: 'Check status', ...enResults,
  },
  fallbacks: { operatorName: 'the operator of this installation', operatorEmail: 'the operator of this installation', governingLaw: 'the law of the operator’s country', dataProtection: 'under the data-protection law that applies to you', hosting: 'our hosting providers store it on our behalf' },
};

const fr: SitePageContent = {
  nav: { label: 'Site', help: 'Aide', pricing: 'Tarifs', status: 'État', changelog: 'Nouveautés', privacy: 'Confidentialité', terms: 'Conditions', dataDeletion: 'Suppression des données', signIn: 'Se connecter', signUp: 'Créer un compte', home: 'Accueil' },
  help: {
    title: 'Aide',
    lead: 'Des réponses courtes aux questions posées avant et après l’inscription.',
    items: [
      { question: 'Comment connecter mes pages et profils ?', answer: 'Après l’inscription, ouvrez Paramètres › Connexions et choisissez un réseau. Facebook et Instagram se connectent avec votre compte Facebook, puis vous choisissez les canaux à utiliser.' },
      { question: 'Comment fonctionne la programmation ?', answer: 'Rédigez la publication une fois, choisissez les canaux et l’heure, ou ajoutez-la à la file d’un canal. L’application la publie à l’heure prévue, même si personne n’est connecté.' },
      { question: 'Quels réseaux sont pris en charge ?', answer: 'Les réseaux que l’opérateur de cette installation a activés. L’écran Connexions liste exactement ce que vous pouvez connecter.' },
      { question: 'Mon équipe peut-elle travailler ensemble ?', answer: 'Oui. Invitez vos collègues avec un rôle (admin, éditeur, contributeur, lecteur) et choisissez les canaux de chacun.' },
      { question: 'Mes clients peuvent-ils valider les publications ?', answer: 'Envoyez un lien de validation : le client voit la publication et l’approuve ou demande des changements, sans créer de compte.' },
      { question: 'D’où viennent les chiffres ?', answer: 'Directement de l’API de chaque réseau, lus régulièrement en arrière-plan et conservés pour garder l’historique.' },
      { question: 'Comment exporter ou supprimer mes données ?', answer: 'Ouvrez Paramètres › Données et confidentialité. Les propriétaires et administrateurs peuvent télécharger une archive ou supprimer les données de l’espace. Pour retirer l’accès donné à Facebook, voir [suppression des données](/data-deletion).' },
    ],
  },
  pricing: {
    title: 'Tarifs',
    lead: 'Choisissez l’offre qui convient à votre équipe. Les prix sont indiqués par mois sauf mention contraire.',
    none: 'Les offres ne sont pas encore publiées. Revenez bientôt.',
    free: 'Gratuit', perMonth: '{price} par mois', perYear: '{price} facturés à l’année',
    channels: 'Jusqu’à {count} canaux', channelsUnlimited: 'Canaux illimités',
    members: 'Jusqu’à {count} membres', membersUnlimited: 'Membres illimités',
    posts: 'Jusqu’à {count} publications par mois', postsUnlimited: 'Publications illimitées',
    extraChannel: '{price} par canal supplémentaire', choose: 'Commencer',
    featureLabels: { clients: 'Liens de validation client', whiteLabel: 'Marque blanche', api: 'Accès API et MCP' },
  },
  status: {
    title: 'État du service', lead: 'L’application fonctionne-t-elle, et le planificateur tourne-t-il ? Rien d’autre n’est public.',
    allUp: 'Tous les systèmes fonctionnent', degraded: 'Un élément ne fonctionne pas comme prévu',
    app: 'Application', scheduler: 'Planificateur', up: 'En service', down: 'Ne répond pas', checked: 'Vérifié {time}',
  },
  changelog: { title: 'Nouveautés', lead: 'Les dernières améliorations, les plus récentes d’abord.', empty: 'Rien n’a encore été publié.' },
  privacy: {
    title: 'Politique de confidentialité', updated: 'Dernière mise à jour : {date}', notUpdated: 'L’opérateur n’a pas encore indiqué de date de mise à jour.',
    sections: [
      { title: 'Qui nous sommes', body: '{productName}{appUrlSuffix} est un outil de publication et d’analyse pour les personnes qui gèrent des Pages Facebook. Le responsable du traitement est {operatorName}{controllerPlace}.\n\nContact : {operatorEmail}.' },
      { title: 'Les données traitées', body: '- Votre compte : nom, adresse e-mail et mot de passe (conservé uniquement sous forme de hachage irréversible).\n- Ce que Facebook nous transmet lorsque vous connectez votre profil avec Facebook Login : votre nom et identifiant Facebook, les Pages et comptes publicitaires que vous gérez, et les jetons d’accès correspondants.\n- Les données des Pages que vous choisissez de connecter : publications, commentaires, messages, statistiques (portée, vues, interactions, abonnés) et résultats publicitaires.\n- Ce que vous créez dans l’application : textes, images et vidéos, planifications.\n- Des journaux techniques (heure, adresse IP, erreurs) pour la sécurité et la fiabilité.' },
      { title: 'Pourquoi', body: 'Uniquement pour fournir le service demandé : publier et planifier vos publications, afficher les résultats de vos Pages, répondre aux commentaires et messages, et produire vos rapports. L’application n’agit que lorsque vous (ou un collègue invité) le demandez. Nous ne vendons pas vos données, ne les utilisons pas pour de la publicité et ne les partageons pas avec des tiers pour leurs propres besoins.' },
      { title: 'Qui peut les voir', body: 'Uniquement les membres de votre espace de travail. Hébergement : {hosting}. Les données ne sont envoyées à Meta que pour exécuter vos actions (publier, répondre, masquer).' },
      { title: 'Sécurité', body: 'Les jetons Facebook sont chiffrés avant d’être enregistrés, toutes les connexions utilisent HTTPS et l’accès au serveur est restreint.' },
      { title: 'Conservation', body: 'Les données sont conservées tant que votre compte ou votre connexion Facebook existe. Lorsque vous déconnectez un profil ou retirez l’application de Facebook, le profil et tous ses jetons sont supprimés et ses Pages ne sont plus lues ni publiées. Les publications et statistiques déjà enregistrées sont effacées sur demande. Les sauvegardes sont effacées automatiquement après la durée fixée par l’opérateur.' },
      { title: 'Vos droits', body: 'Vous pouvez accéder à vos données, les corriger, les supprimer ou vous opposer à leur traitement ({dataProtection}) en écrivant à {operatorEmail}. Vous pouvez aussi retirer l’application dans vos paramètres Facebook (Applications et sites web) : Facebook nous prévient et votre profil et ses jetons sont supprimés — voir la [page de suppression des données](/data-deletion).' },
      { title: 'Cookies', body: 'Un seul cookie qui vous garde connecté, et un autre qui retient votre espace de travail et votre apparence. Aucun cookie publicitaire ou d’analyse.' },
      { title: 'Modifications', body: 'Toute modification sera publiée sur cette page avec sa date de mise à jour.' },
    ],
  },
  terms: {
    title: 'Conditions d’utilisation', updated: 'Dernière mise à jour : {date}', notUpdated: 'L’opérateur n’a pas encore indiqué de date de mise à jour.',
    sections: [
      { title: 'Le service', body: '{productName}{appUrlSuffix}, exploité par {operatorName}{operatorCountrySuffix}, permet à ses utilisateurs de publier, planifier et suivre des publications sur les Pages Facebook qu’ils gèrent, et de répondre à leurs commentaires et messages. En l’utilisant, vous acceptez ces conditions.' },
      { title: 'Qui peut l’utiliser', body: 'Les comptes sont créés sur invitation d’un propriétaire d’espace de travail. Vous ne pouvez connecter que les profils, Pages et comptes publicitaires que vous êtes autorisé à gérer, et vous êtes responsable des personnes que vous invitez.' },
      { title: 'Votre contenu', body: 'Vous êtes responsable de ce que vous publiez via {productName}, qui doit respecter les Conditions d’utilisation et les Standards de la communauté de Meta. Votre contenu reste le vôtre ; nous ne l’utilisons que pour le publier et l’afficher à votre demande.' },
      { title: 'Accès à Facebook', body: 'Vous connectez Facebook via Facebook Login. Les jetons d’accès obtenus sont chiffrés et utilisés uniquement pour ce que vous demandez : publier, répondre, masquer, et lire les commentaires, messages et statistiques de vos Pages. Vous pouvez retirer l’accès à tout moment depuis vos paramètres Facebook, ou demander la suppression de vos données sur la [page de suppression des données](/data-deletion).' },
      { title: 'Usages interdits', body: 'Vous ne pouvez pas utiliser le service pour du spam, des contenus illégaux ou trompeurs, pour contourner les limites de Facebook, ou pour accéder sans autorisation aux Pages ou comptes d’autrui. Nous pouvons suspendre un compte qui enfreint ces règles.' },
      { title: 'Disponibilité', body: 'Le service est fourni en l’état, sans garantie de disponibilité permanente ni d’absence d’erreurs. Les publications planifiées dépendent de l’acceptation de Facebook à l’échéance ; si l’une échoue, l’application vous le signale.' },
      { title: 'Responsabilité', body: 'Dans la mesure permise par la loi, {operatorName} n’est pas responsable des pertes indirectes, ni des décisions de Meta concernant vos Pages, publications ou comptes.' },
      { title: 'Données personnelles', body: 'Le traitement des données personnelles est décrit dans la [politique de confidentialité](/privacy-policy).' },
      { title: 'Modifications et droit applicable', body: 'Toute modification sera publiée sur cette page avec sa date. Ces conditions sont régies par {governingLaw}.' },
      { title: 'Contact', body: 'Questions sur ces conditions : {operatorEmail}.' },
    ],
  },
  dataDeletion: {
    title: 'Suppression des données',
    lead: 'Comment supprimer les données que cette application détient sur vous.',
    sections: [
      { title: 'Retirer l’application de Facebook', body: 'Ouvrez vos paramètres Facebook, allez dans Applications et sites web, trouvez {productName} et choisissez Supprimer. Facebook nous prévient, et nous supprimons l’accès enregistré pour votre profil et arrêtons ses tâches planifiées.' },
      { title: 'Vérifier le résultat', body: 'Après avoir retiré l’application, vous recevez un code de confirmation. Saisissez-le ci-dessous ou ouvrez le lien affiché par Facebook pour voir le résultat.' },
      { title: 'Supprimer le reste', body: 'Les publications déjà parues appartiennent à l’espace de travail qui gérait la Page. Son propriétaire peut supprimer les données de l’espace depuis Paramètres › Données et confidentialité. Vous pouvez aussi écrire à {operatorEmail} pour demander l’effacement des données de votre compte.' },
    ],
    lookupLabel: 'Code de confirmation', lookupButton: 'Vérifier le statut', ...frResults,
  },
  fallbacks: { operatorName: 'l’opérateur de cette installation', operatorEmail: 'l’opérateur de cette installation', governingLaw: 'le droit du pays de l’opérateur', dataProtection: 'selon la loi de protection des données qui vous est applicable', hosting: 'nos hébergeurs les stockent pour notre compte' },
};

export const SITE_CONTENT_DEFAULTS: SiteContent = { en, fr };

/** Operator details Root enters once; the legal pages read them and nothing about the operator is written in code. */
export const operatorSchema = z.object({
  productName: z.string().trim().max(100),
  name: z.string().trim().max(200),
  country: z.string().trim().max(100),
  address: z.string().trim().max(400),
  email: z.string().trim().max(200).refine(value => value === '' || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value), 'Use an email address or leave blank.'),
  governingLaw: z.string().trim().max(300),
  dataProtection: z.string().trim().max(300),
  hosting: z.string().trim().max(300),
  legalUpdated: z.string().trim().max(60),
}).strict();
export type OperatorDetails = z.infer<typeof operatorSchema>;
export const OPERATOR_DEFAULTS: OperatorDetails = { productName: 'MS Social Pilot', name: '', country: '', address: '', email: '', governingLaw: '', dataProtection: '', hosting: '', legalUpdated: '' };

/** Placeholder values for legal text: a blank detail falls back to the Root-editable neutral phrase, never to an empty gap. */
export function resolveLegalValues(op: OperatorDetails, appUrl: string, fallbacks: SitePageContent['fallbacks']): Record<string, string> {
  const place = [op.address, op.country].filter(Boolean).join(', ');
  return {
    productName: op.productName || OPERATOR_DEFAULTS.productName,
    appUrlSuffix: appUrl ? ` (${appUrl})` : '',
    operatorName: op.name || fallbacks.operatorName,
    operatorEmail: op.email ? `[${op.email}](mailto:${op.email})` : fallbacks.operatorEmail,
    operatorCountrySuffix: op.country ? ` (${op.country})` : '',
    controllerPlace: place ? `, ${place}` : '',
    governingLaw: op.governingLaw || fallbacks.governingLaw,
    dataProtection: op.dataProtection || fallbacks.dataProtection,
    hosting: op.hosting || fallbacks.hosting,
    legalUpdated: op.legalUpdated,
  };
}

/**
 * French sets a narrow no-break space before ; : ! ? and inside « ». Applied when French content is loaded, so text
 * that Root edits needs no special characters and a line never breaks before its punctuation.
 */
export function frenchTypography<T>(value: T): T {
  if (typeof value === 'string') return value.replace(/ ([;:!?»])/g, ' $1').replace(/(«) /g, '$1 ') as T;
  if (Array.isArray(value)) return value.map(frenchTypography) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, frenchTypography(inner)])) as T;
  return value;
}

export type RichBlock = { kind: 'p'; text: string } | { kind: 'ul'; items: string[] };
/** Split Root-written text into paragraphs and lists. */
export function parseBlocks(body: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  for (const chunk of body.split(/\n{2,}/)) {
    const lines = chunk.split('\n').map(line => line.trimEnd()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every(line => line.startsWith('- '))) blocks.push({ kind: 'ul', items: lines.map(line => line.slice(2).trim()) });
    else blocks.push({ kind: 'p', text: lines.join(' ') });
  }
  return blocks;
}

export type RichPart = { kind: 'text'; text: string } | { kind: 'link'; label: string; href: string };
/** Only site-relative paths and mailto links become links; any other target stays plain text. */
export function parseInline(text: string): RichPart[] {
  const parts: RichPart[] = [];
  const pattern = /\[([^\]]{1,200})\]\(([^)\s]{1,300})\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const [whole, label = '', href = ''] = match;
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: 'text', text: text.slice(last, index) });
    if (/^\/(?!\/)/.test(href) || /^mailto:[^\s@<>]+@[^\s@<>]+$/.test(href)) parts.push({ kind: 'link', label, href });
    else parts.push({ kind: 'text', text: whole });
    last = index + whole.length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

/** Fill `{name}` placeholders; an unknown placeholder is left visible so a typo in Root is noticed. */
export const fillText = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
