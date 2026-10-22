import { z } from 'zod';

/** English and French chrome copy of the single sidebar, header, popovers and phone bar. Root edits it under `home.shellCopy`. */
const en = {
  skipLink: 'Skip to content',
  mainNavigation: 'Main sections',
  areaTabsLabel: '{area} sections',
  moreTabs: 'More',
  areas: { home: 'Home', content: 'Content', inbox: 'Inbox', insights: 'Insights', ads: 'Ads', tasks: 'Tasks', agency: 'Agency', settings: 'Settings' },
  pageTitles: {
    'home/overview': 'Overview', 'publishing/posts': 'Posts', 'publishing/calendar': 'Calendar', 'publishing/queue': 'Queue', 'publishing/approvals': 'Approvals',
    'publishing/media': 'Library', 'publishing/feeds': 'Content feeds', 'studio/ai-studio': 'AI studio', 'publishing/collaboration': 'Organize', 'publishing/labels': 'Labels', 'publishing/templates': 'Templates',
    'studio/agents': 'Writing agents', 'inbox/conversations': 'Messages', 'analytics/overview': 'Overview', 'analytics/explorer': 'Explore', 'analytics/demographics': 'Audience',
    'analytics/compare': 'Compare', 'analytics/ads': 'Ads analysis', 'analytics/posts': 'Posts', 'studio/tests': 'Caption tests', 'analytics/goals': 'Goals', 'analytics/pins': 'Pinned metrics', 'analytics/reports': 'Reports', 'analytics/notes': 'Chart notes',
    'ads/overview': 'Accounts', 'ads/compare': 'Compare', 'ads/objects': 'Manage', 'ads/campaigns': 'Campaigns', 'tasks/board': 'Tasks',
    'agency/overview': 'Workspaces', 'agency/clients': 'Clients', 'settings/connections': 'Channels', 'settings/team': 'Team', 'settings/workspace': 'Workspace',
    'settings/sharing': 'Sharing', 'settings/bio': 'Link in bio', 'settings/mcp': 'Integrations', 'settings/webhooks': 'Webhooks', 'settings/history': 'History',
    'settings/account': 'Account', 'settings/notifications': 'Notifications', 'settings/data': 'Data and privacy', 'settings/appearance': 'Appearance',
  },
  createPost: 'Create post',
  workspace: 'Workspace',
  privateInstallation: 'Private installation',
  switchingWorkspace: 'Switching workspace…',
  workspaceSwitchFailed: 'The workspace could not be switched. Try again.',
  channels: 'Channels',
  allChannels: 'All channels',
  manageChannels: 'Manage channels',
  showAll: 'Show all ({count})',
  showFewer: 'Show fewer',
  searchChannels: 'Search channels',
  noChannelMatch: 'No channel matches.',
  noChannels: 'No channels yet.',
  channelStatus: { connected: 'Connected', expired: 'Reconnect needed', revoked: 'Access removed' },
  channelCount: '{count} channels',
  scopeHint: 'Click a channel to show only it. Hold Ctrl or ⌘ to add more.',
  scopeToggle: 'Show {name} in the view',
  scopeDroppedOne: '1 channel is no longer available and was removed from the view.',
  scopeDroppedMany: '{count} channels are no longer available and were removed from the view.',
  scopeSheetTitle: 'Channels',
  collapseSidebar: 'Collapse sidebar',
  expandSidebar: 'Expand sidebar',
  openMenu: 'Open menu',
  closeMenu: 'Close menu',
  userMenu: 'Account menu',
  account: 'Account',
  help: 'Help',
  theme: 'Theme',
  language: 'Language',
  languageEnglish: 'English',
  languageFrench: 'Français',
  signOut: 'Sign out',
  signingOut: 'Signing out…',
  signOutFailed: 'Could not sign out. Try again.',
  root: 'Root',
  rootBadge: 'Root · private installation',
  backToApp: 'Back to the app',
  installation: 'Installation',
  filter: 'Filter',
  filterActive: 'Filter, {count} active',
  filterTitle: 'Filter',
  clearAll: 'Clear all',
  done: 'Done',
  removeFilter: 'Remove filter',
  activeFilters: 'Active filters',
  infoAbout: 'About {name}',
  close: 'Close',
  dateRange: 'Date range',
  dateFrom: 'From',
  dateTo: 'To',
  dateApply: 'Apply',
  dateCustom: 'Custom range',
  moreActions: 'More actions',
  bottomBar: 'Main sections',
} as const;

const fr = {
  skipLink: 'Aller au contenu',
  mainNavigation: 'Sections principales',
  areaTabsLabel: 'Sections : {area}',
  moreTabs: 'Plus',
  areas: { home: 'Accueil', content: 'Contenu', inbox: 'Messages', insights: 'Statistiques', ads: 'Publicités', tasks: 'Tâches', agency: 'Agence', settings: 'Réglages' },
  pageTitles: {
    'home/overview': 'Aperçu', 'publishing/posts': 'Publications', 'publishing/calendar': 'Calendrier', 'publishing/queue': 'File d’attente', 'publishing/approvals': 'Approbations',
    'publishing/media': 'Bibliothèque', 'publishing/feeds': 'Flux de contenu', 'studio/ai-studio': 'Studio IA', 'publishing/collaboration': 'Organisation', 'publishing/labels': 'Étiquettes', 'publishing/templates': 'Modèles',
    'studio/agents': 'Agents de rédaction', 'inbox/conversations': 'Messages', 'analytics/overview': 'Vue d’ensemble', 'analytics/explorer': 'Explorateur', 'analytics/demographics': 'Audience',
    'analytics/compare': 'Comparer', 'analytics/ads': 'Analyse publicitaire', 'analytics/posts': 'Publications', 'studio/tests': 'Tests de légendes', 'analytics/goals': 'Objectifs', 'analytics/pins': 'Indicateurs épinglés', 'analytics/reports': 'Rapports', 'analytics/notes': 'Notes des graphiques',
    'ads/overview': 'Comptes', 'ads/compare': 'Comparer', 'ads/objects': 'Gérer', 'ads/campaigns': 'Campagnes', 'tasks/board': 'Tâches',
    'agency/overview': 'Espaces de travail', 'agency/clients': 'Clients', 'settings/connections': 'Canaux', 'settings/team': 'Équipe', 'settings/workspace': 'Espace de travail',
    'settings/sharing': 'Partage', 'settings/bio': 'Lien en bio', 'settings/mcp': 'Intégrations', 'settings/webhooks': 'Webhooks', 'settings/history': 'Historique',
    'settings/account': 'Compte', 'settings/notifications': 'Notifications', 'settings/data': 'Données et confidentialité', 'settings/appearance': 'Apparence',
  },
  createPost: 'Créer une publication',
  workspace: 'Espace de travail',
  privateInstallation: 'Installation privée',
  switchingWorkspace: 'Changement d’espace de travail…',
  workspaceSwitchFailed: 'Impossible de changer d’espace de travail. Réessayez.',
  channels: 'Canaux',
  allChannels: 'Tous les canaux',
  manageChannels: 'Gérer les canaux',
  showAll: 'Tout afficher ({count})',
  showFewer: 'Afficher moins',
  searchChannels: 'Rechercher un canal',
  noChannelMatch: 'Aucun canal ne correspond.',
  noChannels: 'Aucun canal pour le moment.',
  channelStatus: { connected: 'Connecté', expired: 'Reconnexion nécessaire', revoked: 'Accès retiré' },
  channelCount: '{count} canaux',
  scopeHint: 'Cliquez sur un canal pour n’afficher que lui. Maintenez Ctrl ou ⌘ pour en ajouter.',
  scopeToggle: 'Afficher {name} dans la vue',
  scopeDroppedOne: '1 canal n’est plus disponible et a été retiré de la vue.',
  scopeDroppedMany: '{count} canaux ne sont plus disponibles et ont été retirés de la vue.',
  scopeSheetTitle: 'Canaux',
  collapseSidebar: 'Réduire la barre latérale',
  expandSidebar: 'Développer la barre latérale',
  openMenu: 'Ouvrir le menu',
  closeMenu: 'Fermer le menu',
  userMenu: 'Menu du compte',
  account: 'Compte',
  help: 'Aide',
  theme: 'Thème',
  language: 'Langue',
  languageEnglish: 'English',
  languageFrench: 'Français',
  signOut: 'Se déconnecter',
  signingOut: 'Déconnexion…',
  signOutFailed: 'Déconnexion impossible. Réessayez.',
  root: 'Root',
  rootBadge: 'Root · installation privée',
  backToApp: 'Retour à l’application',
  installation: 'Installation',
  filter: 'Filtrer',
  filterActive: 'Filtrer, {count} actif(s)',
  filterTitle: 'Filtrer',
  clearAll: 'Tout effacer',
  done: 'Terminé',
  removeFilter: 'Retirer le filtre',
  activeFilters: 'Filtres actifs',
  infoAbout: 'À propos de {name}',
  close: 'Fermer',
  dateRange: 'Période',
  dateFrom: 'Du',
  dateTo: 'Au',
  dateApply: 'Appliquer',
  dateCustom: 'Période personnalisée',
  moreActions: 'Autres actions',
  bottomBar: 'Sections principales',
} as const;

export const SHELL_COPY = { en, fr } as const;
export type ShellCopy = { -readonly [K in keyof typeof en]: (typeof en)[K] extends string ? string : { [P in keyof (typeof en)[K]]: string } };

const text = z.string().min(1).max(300);
const textMap = (keys: readonly string[]) => z.object(Object.fromEntries(keys.map(key => [key, text]))).strict();
const locale = z.object(Object.fromEntries(Object.entries(en).map(([key, value]) => [key, typeof value === 'string' ? text : textMap(Object.keys(value))]))).strict();
export const shellCopySchema = z.object({ en: locale, fr: locale }).strict();

const savedText = (value: unknown): string | undefined => typeof value === 'string' && value.length >= 1 && value.length <= 300 ? value : undefined;

/**
 * Stored `home.shellCopy` catalogs outlive schema changes: B9 removed the three `pageTools*`
 * entries, so a catalog saved before then carries obsolete keys. Merge the saved entries over
 * the shipped locale text instead of rejecting the whole catalog: unknown keys and invalid
 * values are dropped, saved customizations are kept, and shipped text fills every gap
 * (including keys added after the catalog was saved). Root saves stay strict; this is the
 * read path only.
 */
export function resolveShellCopy(saved: unknown): { en: ShellCopy; fr: ShellCopy } {
  const locales = saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  const resolve = (locale: 'en' | 'fr'): ShellCopy => {
    const shipped = SHELL_COPY[locale] as unknown as Record<string, unknown>;
    const group = locales[locale];
    const stored = group && typeof group === 'object' && !Array.isArray(group) ? (group as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const [key, fallback] of Object.entries(shipped)) {
      if (typeof fallback === 'string') {
        out[key] = savedText(stored[key]) ?? fallback;
      } else {
        const sub = stored[key];
        const savedGroup = sub && typeof sub === 'object' && !Array.isArray(sub) ? (sub as Record<string, unknown>) : {};
        const merged: Record<string, string> = {};
        for (const [subKey, subFallback] of Object.entries(fallback as Record<string, string>)) merged[subKey] = savedText(savedGroup[subKey]) ?? subFallback;
        out[key] = merged;
      }
    }
    return out as unknown as ShellCopy;
  };
  return { en: resolve('en'), fr: resolve('fr') };
}

/** Replaces `{name}` placeholders; unknown placeholders are kept visible rather than silently dropped. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/** Shell behaviour that Root can tune: list lengths, tab overflow and cookie lifetimes. Root edits it under `home.shellPolicy`. */
export const SHELL_POLICY = {
  channelsCollapsedCount: 8,
  channelSearchThreshold: 15,
  channelListMax: 200,
  maxVisibleTabs: 7,
  scopeCookieDays: 180,
  sidebarCookieDays: 365,
  infoHoverDelayMs: 300,
  scopeCookiePrefix: 'sp_scope_',
  sidebarCookie: 'sp_sidebar',
} as const;
export type ShellPolicy = { -readonly [K in keyof typeof SHELL_POLICY]: (typeof SHELL_POLICY)[K] extends number ? number : string };
export const shellPolicySchema = z.object({
  channelsCollapsedCount: z.number().int().min(3).max(50),
  channelSearchThreshold: z.number().int().min(5).max(200),
  channelListMax: z.number().int().min(10).max(1000),
  maxVisibleTabs: z.number().int().min(2).max(20),
  scopeCookieDays: z.number().int().min(1).max(730),
  sidebarCookieDays: z.number().int().min(1).max(730),
  infoHoverDelayMs: z.number().int().min(0).max(2000),
  scopeCookiePrefix: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
  sidebarCookie: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
}).strict();
