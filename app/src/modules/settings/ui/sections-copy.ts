import { z } from 'zod';

/** Design v2 B6 (S13): section tabs, Workspace cards and Channels cards. Root edits it under `settings.sectionsCopy`. */
const en = {
  listLabel: 'Settings sections',
  tabsLabel: '{section} tabs',
  tabs: {
    channelsAccounts: 'Connected accounts', channelsGroups: 'Groups and labels',
    sharingLinks: 'Client links', sharingBio: 'Link in bio',
    integrationsAssistants: 'AI assistants', integrationsKeys: 'API keys', integrationsWebhooks: 'Webhooks',
    accountProfile: 'Profile', accountSecurity: 'Security', accountAppearance: 'Appearance', accountNotifications: 'Notifications',
  },
  save: 'Save', saving: 'Saving…', saved: 'Saved', unchanged: 'No changes to save.', readOnly: 'Only workspace owners and admins can change this.', unavailable: 'These settings could not be loaded. Reload the page to try again.',
  name: { title: 'Name and time zone', detail: 'Used for schedules, calendars and reports across this workspace.', nameLabel: 'Workspace name', nameHint: 'Ask a workspace owner to rename the workspace.', zoneLabel: 'Time zone', zoneSearch: 'Search time zones', zoneNone: 'No time zone matches.' },
  approvals: { title: 'Approvals', detail: 'When on, contributors send posts for review before they can be scheduled.', switchLabel: 'Contributors need approval before posts are scheduled' },
  hours: { title: 'Posting hours', detail: 'Your team’s working days and hours. Calendars, reports and response times use them.', days: 'Working days', from: 'From (hour)', to: 'To (hour)', invalid: 'The end hour must be after the start hour.' },
  queue: { title: 'Queue and spacing', detail: 'How far apart posts go out and how long you can take one back.', gap: 'Minimum gap between posts (minutes)', undo: 'Undo window after publishing (seconds)' },
  links: { title: 'Links', detail: 'Tag and shorten the links in your posts.', more: 'Link tagging (UTM)', shortenLabel: 'Shorten links in posts' },
  voice: { title: 'AI voice', detail: 'How the writing assistant should sound for this workspace.', enabledLabel: 'Allow the AI writing assistant' },
  moderation: { title: 'Moderation alerts', detail: 'Get alerted when new comments look negative.', switchLabel: 'Alert me about negative comments' },
  areas: { title: 'Tasks area', detail: 'Show Tasks in the sidebar for everyone in this workspace, even before the first task exists.', switchLabel: 'Show the Tasks area' },
  channels: {
    inUse: 'Channels in use: {enabled} of {total}', noneInUse: 'No channels in use', manage: 'Manage channels', reconnect: 'Reconnect', more: 'More actions', disconnect: 'Disconnect…',
    permissions: 'Permissions', permissionsOk: 'All permissions are granted.', permissionsMissing: 'Missing: {labels}', permissionsAll: 'Show all permissions', permissionsNone: 'This account does not report its permissions.',
    adTitle: 'Ad accounts', adDetail: 'Choose which ad accounts appear in reports and Ads.', adLinked: 'Linked account', inUseOn: 'In use', inUseOff: 'Not in use', adManage: 'Choose ad accounts',
    groupsTitle: 'Channel groups and labels', groupsDetail: 'Organise channels into groups for filters and reports.', groupsOpen: 'Open groups',
  },
};
const fr: typeof en = {
  listLabel: 'Sections des réglages',
  tabsLabel: 'Onglets : {section}',
  tabs: {
    channelsAccounts: 'Comptes connectés', channelsGroups: 'Groupes et étiquettes',
    sharingLinks: 'Liens clients', sharingBio: 'Lien en bio',
    integrationsAssistants: 'Assistants IA', integrationsKeys: 'Clés API', integrationsWebhooks: 'Webhooks',
    accountProfile: 'Profil', accountSecurity: 'Sécurité', accountAppearance: 'Apparence', accountNotifications: 'Notifications',
  },
  save: 'Enregistrer', saving: 'Enregistrement…', saved: 'Enregistré', unchanged: 'Aucune modification à enregistrer.', readOnly: 'Seuls les propriétaires et administrateurs de l’espace peuvent modifier ceci.', unavailable: 'Ces réglages n’ont pas pu être chargés. Rechargez la page pour réessayer.',
  name: { title: 'Nom et fuseau horaire', detail: 'Utilisés pour les planifications, calendriers et rapports de cet espace.', nameLabel: 'Nom de l’espace', nameHint: 'Demandez à un propriétaire de renommer l’espace.', zoneLabel: 'Fuseau horaire', zoneSearch: 'Rechercher un fuseau horaire', zoneNone: 'Aucun fuseau horaire ne correspond.' },
  approvals: { title: 'Approbations', detail: 'Quand l’option est active, les contributeurs envoient leurs publications en relecture avant de pouvoir les planifier.', switchLabel: 'Les contributeurs doivent obtenir une approbation avant la planification' },
  hours: { title: 'Heures de publication', detail: 'Les jours et heures de travail de votre équipe. Calendriers, rapports et délais de réponse s’en servent.', days: 'Jours travaillés', from: 'De (heure)', to: 'À (heure)', invalid: 'L’heure de fin doit être après l’heure de début.' },
  queue: { title: 'File d’attente et espacement', detail: 'L’écart entre les publications et le temps dont vous disposez pour en annuler une.', gap: 'Écart minimal entre publications (minutes)', undo: 'Délai d’annulation après publication (secondes)' },
  links: { title: 'Liens', detail: 'Étiquetez et raccourcissez les liens de vos publications.', more: 'Étiquetage des liens (UTM)', shortenLabel: 'Raccourcir les liens des publications' },
  voice: { title: 'Voix de l’IA', detail: 'Le ton de l’assistant de rédaction pour cet espace.', enabledLabel: 'Autoriser l’assistant de rédaction IA' },
  moderation: { title: 'Alertes de modération', detail: 'Soyez alerté quand de nouveaux commentaires semblent négatifs.', switchLabel: 'M’alerter pour les commentaires négatifs' },
  areas: { title: 'Espace Tâches', detail: 'Afficher Tâches dans la barre latérale pour tout l’espace, même avant la première tâche.', switchLabel: 'Afficher l’espace Tâches' },
  channels: {
    inUse: 'Canaux utilisés : {enabled} sur {total}', noneInUse: 'Aucun canal utilisé', manage: 'Gérer les canaux', reconnect: 'Reconnecter', more: 'Autres actions', disconnect: 'Déconnecter…',
    permissions: 'Autorisations', permissionsOk: 'Toutes les autorisations sont accordées.', permissionsMissing: 'Manquantes : {labels}', permissionsAll: 'Afficher toutes les autorisations', permissionsNone: 'Ce compte ne communique pas ses autorisations.',
    adTitle: 'Comptes publicitaires', adDetail: 'Choisissez les comptes publicitaires affichés dans les rapports et la publicité.', adLinked: 'Compte lié', inUseOn: 'Utilisé', inUseOff: 'Non utilisé', adManage: 'Choisir les comptes publicitaires',
    groupsTitle: 'Groupes de canaux et étiquettes', groupsDetail: 'Organisez vos canaux en groupes pour les filtres et les rapports.', groupsOpen: 'Ouvrir les groupes',
  },
};

export type SectionsCopy = typeof en;
export const sectionsCopy = { en, fr };
const text = z.string().trim().min(1);
const block = (shape: Record<string, unknown>): z.ZodTypeAny => z.object(Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, typeof value === 'string' ? text : block(value as Record<string, unknown>)]))).strict();
export const sectionsCopySchema = z.object({ en: block(en), fr: block(fr) }).strict() as unknown as z.ZodType<typeof sectionsCopy>;
