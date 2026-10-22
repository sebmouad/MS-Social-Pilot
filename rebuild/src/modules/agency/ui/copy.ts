import { z } from 'zod';

/** Root-editable customer text. Source phrases are stable catalog identities. */
export const customerCopy = {
  "Not shown for workspaces where you lack access to this data": {
    "en": "Not shown for workspaces where you lack access to this data",
    "fr": "Non affiché pour les espaces où vous n’avez pas accès à ces données"
  },
  "Suspended": {
    "en": "Suspended",
    "fr": "Suspendu"
  },
  "Data deletion in progress": {
    "en": "Data deletion in progress",
    "fr": "Suppression des données en cours"
  },
  "Needs attention": {
    "en": "Needs attention",
    "fr": "Attention requise"
  },
  "Healthy": {
    "en": "Healthy",
    "fr": "Aucun problème signalé"
  },
  "of": {
    "en": "of",
    "fr": "sur"
  },
  "channels cannot publish": {
    "en": "channels cannot publish",
    "fr": "canaux ne peuvent pas publier"
  },
  "failed posts": {
    "en": "failed posts",
    "fr": "publications en échec"
  },
  "overdue tasks": {
    "en": "overdue tasks",
    "fr": "tâches en retard"
  },
  "Unavailable until the workspace is active": {
    "en": "Unavailable until the workspace is active",
    "fr": "Indisponible tant que l’espace n’est pas actif"
  },
  "Open": {
    "en": "Open",
    "fr": "Ouvrir"
  },
  "Fix connections": {
    "en": "Fix connections",
    "fr": "Vérifier les connexions"
  },
  "Review posts": {
    "en": "Review posts",
    "fr": "Vérifier les publications"
  },
  "Overdue tasks": {
    "en": "Overdue tasks",
    "fr": "Tâches en retard"
  },
  "Waiting conversations": {
    "en": "Waiting conversations",
    "fr": "Conversations en attente"
  },
  "Open inbox": {
    "en": "Open inbox",
    "fr": "Ouvrir la boîte de réception"
  },
  "Unresolved messages, comments and reviews.": {
    "en": "Unresolved messages, comments and reviews.",
    "fr": "Messages, commentaires et avis non résolus."
  },
  "Agency compares every workspace you manage; the channel scope does not filter it.": {
    "en": "Agency compares every workspace you manage; the channel scope does not filter it.",
    "fr": "L’agence compare tous les espaces que vous gérez ; la sélection des canaux ne la filtre pas."
  },
  "Counted in": {
    "en": "Counted in",
    "fr": "Comptabilisé dans"
  },
  "workspaces": {
    "en": "workspaces",
    "fr": "espaces"
  },
  "Review your filters.": {
    "en": "Review your filters.",
    "fr": "Vérifiez vos filtres."
  },
  "Choose valid filters and try again.": {
    "en": "Choose valid filters and try again.",
    "fr": "Choisissez des filtres valides, puis réessayez."
  },
  "Reset filters": {
    "en": "Reset filters",
    "fr": "Réinitialiser les filtres"
  },
  "your workspaces": {
    "en": "your workspaces",
    "fr": "vos espaces"
  },
  "Matching workspaces": {
    "en": "Matching workspaces",
    "fr": "Espaces correspondants"
  },
  "Workspaces": {
    "en": "Workspaces",
    "fr": "Espaces"
  },
  "Need attention": {
    "en": "Need attention",
    "fr": "Attention requise"
  },
  "Channels that cannot publish": {
    "en": "Channels that cannot publish",
    "fr": "Canaux ne pouvant pas publier"
  },
  "Failed posts": {
    "en": "Failed posts",
    "fr": "Publications en échec"
  },
  "Scheduled posts": {
    "en": "Scheduled posts",
    "fr": "Publications planifiées"
  },
  "Scheduled posts · Failed posts": {
    "en": "Scheduled posts · Failed posts",
    "fr": "Publications planifiées · Publications en échec"
  },
  "You do not own or administer any workspace with Agency access yet.": {
    "en": "You do not own or administer any workspace with Agency access yet.",
    "fr": "Vous ne gérez pas encore d’espace donnant accès à Agence."
  },
  "No workspaces match this search.": {
    "en": "No workspaces match this search.",
    "fr": "Aucun espace ne correspond à cette recherche."
  },
  "No workspaces need attention.": {
    "en": "No workspaces need attention.",
    "fr": "Aucun espace ne nécessite d’attention."
  },
  "View workspace": {
    "en": "View workspace",
    "fr": "Voir l’espace"
  },
  "Workspaces you manage": {
    "en": "Workspaces you manage",
    "fr": "Espaces que vous gérez"
  },
  "Workspace": {
    "en": "Workspace",
    "fr": "Espace"
  },
  "Owner": {
    "en": "Owner",
    "fr": "Propriétaire"
  },
  "Admin": {
    "en": "Admin",
    "fr": "Administrateur"
  },
  "Status": {
    "en": "Status",
    "fr": "Statut"
  },
  "Channels": {
    "en": "Channels",
    "fr": "Canaux"
  },
  "Scheduled": {
    "en": "Scheduled",
    "fr": "Planifiées"
  },
  "Failed": {
    "en": "Failed",
    "fr": "En échec"
  },
  "Open tasks": {
    "en": "Open tasks",
    "fr": "Tâches ouvertes"
  },
  "Team": {
    "en": "Team",
    "fr": "Équipe"
  },
  "Clients": {
    "en": "Clients",
    "fr": "Clients"
  },
  "Actions": {
    "en": "Actions",
    "fr": "Actions"
  },
  "Compare the workspaces you manage.": {
    "en": "Compare the workspaces you manage.",
    "fr": "Comparez les espaces que vous gérez."
  },
  "Agency data could not be loaded. Refresh and try again.": {
    "en": "Agency data could not be loaded. Refresh and try again.",
    "fr": "Impossible de charger les données de l’agence. Actualisez, puis réessayez."
  },
  "Client workspaces": {
    "en": "All workspaces",
    "fr": "Tous les espaces"
  },
  "Workspace name": {
    "en": "Workspace name",
    "fr": "Nom de l’espace"
  },
  "Team members": {
    "en": "Team members",
    "fr": "Membres de l’équipe"
  },
  "Search": {
    "en": "Search",
    "fr": "Recherche"
  },
  "Workspace filters": {
    "en": "Workspace filters",
    "fr": "Filtres des espaces"
  },
  "Clear search": {
    "en": "Clear search",
    "fr": "Effacer la recherche"
  },
  "Sort by": {
    "en": "Sort by",
    "fr": "Trier par"
  },
  "Order": {
    "en": "Order",
    "fr": "Ordre"
  },
  "Highest first": {
    "en": "Highest first",
    "fr": "Valeurs décroissantes"
  },
  "Lowest first": {
    "en": "Lowest first",
    "fr": "Valeurs croissantes"
  },
  "Needs attention only": {
    "en": "Needs attention only",
    "fr": "Attention requise uniquement"
  },
  "Apply filters": {
    "en": "Apply filters",
    "fr": "Appliquer les filtres"
  },
  "Client filters": {
    "en": "Client filters",
    "fr": "Filtres des clients"
  },
  "Opening…": {
    "en": "Opening…",
    "fr": "Ouverture…"
  },
  "Client accounts and pending client invitations in workspaces you own or administer.": {
    "en": "Client accounts and pending client invitations in workspaces you own or administer.",
    "fr": "Comptes clients et invitations en attente dans les espaces que vous gérez."
  },
  "Search matches workspace names only. All client accounts and pending invitations are listed for the matching workspaces.": {
    "en": "Search matches workspace names only. All client accounts and pending invitations are listed for the matching workspaces.",
    "fr": "La recherche porte uniquement sur les noms des espaces. Tous les comptes clients et invitations en attente des espaces correspondants sont affichés."
  },
  "View team": {
    "en": "View team",
    "fr": "Voir l’équipe"
  },
  "Manage team": {
    "en": "Manage team",
    "fr": "Gérer l’équipe"
  },
  "This workspace is suspended, so its clients are not shown.": {
    "en": "This workspace is suspended, so its clients are not shown.",
    "fr": "Cet espace est suspendu ; ses clients ne sont pas affichés."
  },
  "Data deletion is in progress for this workspace.": {
    "en": "Data deletion is in progress for this workspace.",
    "fr": "La suppression des données est en cours pour cet espace."
  },
  "Client accounts are not shown because you cannot view this workspace&apos;s team.": {
    "en": "Client accounts are not shown because you cannot view this workspace&apos;s team.",
    "fr": "Les comptes clients ne sont pas affichés car vous n’avez pas accès à l’équipe de cet espace."
  },
  "No client accounts match this search.": {
    "en": "No client accounts match this search.",
    "fr": "Aucun compte client ne correspond à cette recherche."
  },
  "No client accounts yet.": {
    "en": "No client accounts yet.",
    "fr": "Aucun compte client pour le moment."
  },
  "Client": {
    "en": "Client",
    "fr": "Client"
  },
  "Email": {
    "en": "Email",
    "fr": "E-mail"
  },
  "Pending invitations": {
    "en": "Pending invitations",
    "fr": "Invitations en attente"
  },
  "Expired": {
    "en": "Expired",
    "fr": "Expirée"
  },
  "Pending": {
    "en": "Pending",
    "fr": "En attente"
  },
  "Expires": {
    "en": "Expires",
    "fr": "Expiration"
  },
  "Invitations cannot be shown here. Manage them from the workspace team settings.": {
    "en": "Invitations cannot be shown here. Manage them from the workspace team settings.",
    "fr": "Les invitations ne peuvent pas être affichées ici. Gérez-les dans les paramètres de l’équipe de l’espace."
  },
  "Client accounts across your workspaces.": {
    "en": "Client accounts across your workspaces.",
    "fr": "Comptes clients de vos espaces."
  },
  "Client accounts could not be loaded. Refresh and try again.": {
    "en": "Client accounts could not be loaded. Refresh and try again.",
    "fr": "Impossible de charger les comptes clients. Actualisez, puis réessayez."
  },
  "Compare the workspaces you own or administer. Failed posts cover the last {0} days.": {
    "en": "Compare the workspaces you own or administer. Failed posts cover the last {0} days.",
    "fr": "Comparez les espaces que vous gérez. Les publications en échec couvrent les {0} derniers jours."
  },
  "of {0}": {
    "en": "of {0}",
    "fr": "sur {0}"
  },
  "of {0} open": {
    "en": "of {0} open",
    "fr": "sur {0} ouvertes"
  },
  "Across {0}": {
    "en": "Across {0}",
    "fr": "Dans {0}"
  },
  "Could not switch to {0}. Check your connection and try again.": {
    "en": "Could not switch to {0}. Check your connection and try again.",
    "fr": "Impossible d’ouvrir {0}. Vérifiez votre connexion, puis réessayez."
  },
  "Each point shows a listed workspace’s current count, in table order.": {
    "en": "Each point shows a listed workspace’s current count, in table order.",
    "fr": "Chaque point indique le nombre actuel d’un espace affiché, dans l’ordre du tableau."
  },
  "Scheduled posts by listed workspace": {
    "en": "Scheduled posts by listed workspace",
    "fr": "Publications planifiées par espace affiché"
  },
  "Failed posts by listed workspace": {
    "en": "Failed posts by listed workspace",
    "fr": "Publications en échec par espace affiché"
  },
  "Quick switch": {
    "en": "Quick switch",
    "fr": "Changer d’espace"
  },
  "Shown workspaces": {
    "en": "Shown workspaces",
    "fr": "Espaces affichés"
  },
  "Choose a workspace": {
    "en": "Choose a workspace",
    "fr": "Choisir un espace"
  },
  "Open workspace": {
    "en": "Open workspace",
    "fr": "Ouvrir l’espace"
  },
  "More than {0} workspaces match this search; only the first {1} by name are shown. Search for more of the name to narrow them.": {
    "en": "More than {0} workspaces match this search; only the first {1} by name are shown. Search for more of the name to narrow them.",
    "fr": "Plus de {0} espaces correspondent à cette recherche ; seuls les {1} premiers par nom sont affichés. Précisez le nom pour réduire les résultats."
  },
  "You manage more than {0} workspaces; only the first {1} by name are shown. Search by name to find another workspace.": {
    "en": "You manage more than {0} workspaces; only the first {1} by name are shown. Search by name to find another workspace.",
    "fr": "Vous gérez plus de {0} espaces ; seuls les {1} premiers par nom sont affichés. Recherchez un nom pour trouver un autre espace."
  },
  "You manage more than {0} workspaces; only the first {1} by name are shown. Search by workspace name to find another.": {
    "en": "You manage more than {0} workspaces; only the first {1} by name are shown. Search by workspace name to find another.",
    "fr": "Vous gérez plus de {0} espaces ; seuls les {1} premiers par nom sont affichés. Recherchez un nom pour trouver un autre espace."
  },
  " The needs-attention filter only looked at those {0}.": {
    "en": " The needs-attention filter only looked at those {0}.",
    "fr": " Le filtre d’attention requise porte uniquement sur ces {0} espaces."
  },
  "{0} matching workspaces": {
    "en": "{0} matching workspaces",
    "fr": "{0} espaces correspondants"
  },
  "Showing {0} of {1} client accounts.": {
    "en": "Showing {0} of {1} client accounts.",
    "fr": "Affichage de {0} comptes clients sur {1}."
  },
  "{0} client accounts.": {
    "en": "{0} client accounts.",
    "fr": "{0} comptes clients."
  },
  "Remove filter": {
    "en": "Remove filter",
    "fr": "Retirer le filtre"
  },
  "Active filters": {
    "en": "Active filters",
    "fr": "Filtres actifs"
  },
  "No match": {
    "en": "No match",
    "fr": "Aucun résultat"
  },
  "Use a signed-in browser session.": {
    "en": "Use a signed-in browser session.",
    "fr": "Utilisez une session connectée dans votre navigateur."
  },
  "Sign in to continue.": {
    "en": "Sign in to continue.",
    "fr": "Connectez-vous pour continuer."
  },
  "Choose a valid workspace and matching confirmation.": {
    "en": "Choose a valid workspace and matching confirmation.",
    "fr": "Choisissez un espace valide et la confirmation correspondante."
  },
  "Workspace not found.": {
    "en": "Workspace not found.",
    "fr": "Espace introuvable."
  },
  "Choose valid agency export filters.": {
    "en": "Choose valid agency export filters.",
    "fr": "Choisissez des filtres d’export Agence valides."
  },
  "Agency views are currently unavailable.": {
    "en": "Agency views are currently unavailable.",
    "fr": "Les vues Agence sont actuellement indisponibles."
  },
  "Agency is not available for your workspaces.": {
    "en": "Agency is not available for your workspaces.",
    "fr": "Agence n’est pas disponible pour vos espaces."
  },
  "Agency access policy is unavailable.": {
    "en": "Agency access policy is unavailable.",
    "fr": "Les conditions d’accès à Agence sont indisponibles."
  },
  "A currently available Agency overview workspace is required.": {
    "en": "A currently available Agency overview workspace is required.",
    "fr": "Un espace actuellement accessible dans la vue Agence est nécessaire."
  },
  "Search text can be at most {0} characters.": {
    "en": "Search text can be at most {0} characters.",
    "fr": "Le texte de recherche peut contenir au maximum {0} caractères."
  },
  "Choose valid agency filters.": {
    "en": "Choose valid agency filters.",
    "fr": "Choisissez des filtres Agence valides."
  },
  "Agency tools are available only to a signed-in person, not to a workspace key.": {
    "en": "Agency tools are available only to a signed-in person, not to a workspace key.",
    "fr": "Les outils Agence sont réservés aux personnes connectées et ne sont pas accessibles avec une clé d’espace."
  },
  "Unknown agency tool.": {
    "en": "Unknown agency tool.",
    "fr": "Outil Agence inconnu."
  },
  "Confirm the workspace selection.": {
    "en": "Confirm the workspace selection.",
    "fr": "Confirmez le choix de l’espace."
  },
  "Unknown agency session tool.": {
    "en": "Unknown agency session tool.",
    "fr": "Outil de session Agence inconnu."
  },
  "This credential permits only the Agency overview.": {
    "en": "This credential permits only the Agency overview.",
    "fr": "Cet accès permet uniquement de consulter la vue Agence."
  },
  "Tool arguments must be an object.": {
    "en": "Tool arguments must be an object.",
    "fr": "Les paramètres de l’outil doivent être un objet."
  },
  "Person MCP access could not be checked.": {
    "en": "Person MCP access could not be checked.",
    "fr": "Impossible de vérifier votre accès personnel MCP."
  },
  "The Agency overview could not be read.": {
    "en": "The Agency overview could not be read.",
    "fr": "Impossible de consulter la vue Agence."
  },
  "Method not found.": {
    "en": "Method not found.",
    "fr": "Méthode introuvable."
  }
};
export type CustomerCopy = { [K in keyof typeof customerCopy]: { en: string; fr: string } };
export const customerCopySchema = z.object(Object.fromEntries(Object.keys(customerCopy).map(key => [key, z.object({ en: z.string().min(1).max(4000), fr: z.string().min(1).max(4000) }).strict()])) as { [K in keyof CustomerCopy]: z.ZodObject<{ en: z.ZodString; fr: z.ZodString }> }).strict();
export type UiLocale = 'en' | 'fr';
export const uiLocale = (language: string | null): UiLocale => language?.trim().toLowerCase().startsWith('fr') ? 'fr' : 'en';
/** Also localizes safe service failures returned in the service's English wire language. */
export const uiCopy = (locale: UiLocale, catalog: CustomerCopy = customerCopy) => (text: string, ...values: Array<string | number>): string => {
  let result = catalog[text as keyof CustomerCopy]?.[locale];
  if (result === undefined && locale === 'fr') {
    for (const row of Object.values(catalog)) {
      const indices: string[] = [];
      const pattern = row.en.split(/(\{\d+\})/g).map(part => {
        if (/^\{\d+\}$/.test(part)) { indices.push(part.slice(1, -1)); return '(.+?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      const match = new RegExp(`^${pattern}$`, 's').exec(text);
      if (match) {
        result = row.fr.replace(/\{(\d+)\}/g, (token, index: string) => match[indices.indexOf(index) + 1] ?? token);
        break;
      }
    }
  }
  return (result ?? text).replace(/\{(\d+)\}/g, (match, index: string) => String(values[Number(index)] ?? match));
};
