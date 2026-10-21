import { z } from 'zod';

/** Root-editable customer text. Source phrases are stable catalog identities. */
export const customerCopy = {
  "Tasks": {
    "en": "Tasks",
    "fr": "Tâches"
  },
  "Review your task filters.": {
    "en": "Review your task filters.",
    "fr": "Vérifiez les filtres des tâches."
  },
  "Choose valid task filters and try again.": {
    "en": "Choose valid task filters and try again.",
    "fr": "Choisissez des filtres valides, puis réessayez."
  },
  "Assign work, set due dates and follow progress.": {
    "en": "Assign work, set due dates and follow progress.",
    "fr": "Attribuez le travail, fixez les échéances et suivez l’avancement."
  },
  "Assign work, set due dates and follow progress for this workspace.": {
    "en": "Assign work, set due dates and follow progress for this workspace.",
    "fr": "Attribuez le travail, fixez les échéances et suivez l’avancement dans cet espace."
  },
  "Tasks could not be loaded. Refresh and try again.": {
    "en": "Tasks could not be loaded. Refresh and try again.",
    "fr": "Impossible de charger les tâches. Actualisez, puis réessayez."
  },
  "Task pages": {
    "en": "Task pages",
    "fr": "Pages des tâches"
  },
  "Previous tasks": {
    "en": "Previous tasks",
    "fr": "Tâches précédentes"
  },
  "Next tasks": {
    "en": "Next tasks",
    "fr": "Tâches suivantes"
  },
  "Task filters": {
    "en": "Task filters",
    "fr": "Filtres des tâches"
  },
  "Search": {
    "en": "Search",
    "fr": "Recherche"
  },
  "Status": {
    "en": "Status",
    "fr": "Statut"
  },
  "Assigned to": {
    "en": "Assigned to",
    "fr": "Responsable"
  },
  "Due": {
    "en": "Due",
    "fr": "Échéance"
  },
  "Me": {
    "en": "Me",
    "fr": "Moi"
  },
  "Unassigned": {
    "en": "Unassigned",
    "fr": "Non attribuée"
  },
  "Selected member": {
    "en": "Selected member",
    "fr": "Membre sélectionné"
  },
  "Overdue only": {
    "en": "Overdue only",
    "fr": "En retard uniquement"
  },
  "Title or notes": {
    "en": "Title or notes",
    "fr": "Titre ou notes"
  },
  "Clear search": {
    "en": "Clear search",
    "fr": "Effacer la recherche"
  },
  "All statuses": {
    "en": "All statuses",
    "fr": "Tous les statuts"
  },
  "Anyone": {
    "en": "Anyone",
    "fr": "Tout le monde"
  },
  "Only part of the team is listed here. Use Me or Unassigned, or search by title.": {
    "en": "Only part of the team is listed here. Use Me or Unassigned, or search by title.",
    "fr": "Seule une partie de l’équipe est affichée. Choisissez Moi ou Non attribuée, ou recherchez par titre."
  },
  "Apply filters": {
    "en": "Apply filters",
    "fr": "Appliquer les filtres"
  },
  "Reset filters": {
    "en": "Reset filters",
    "fr": "Réinitialiser les filtres"
  },
  "To do": {
    "en": "To do",
    "fr": "À faire"
  },
  "In progress": {
    "en": "In progress",
    "fr": "En cours"
  },
  "Done": {
    "en": "Done",
    "fr": "Terminée"
  },
  "The result is unknown. Refresh the list and check the task before trying again.": {
    "en": "The result is unknown. Refresh the list and check the task before trying again.",
    "fr": "Le résultat est inconnu. Actualisez la liste et vérifiez la tâche avant de réessayer."
  },
  "The change could not be confirmed. Refresh the list and check the task before trying again.": {
    "en": "The change could not be confirmed. Refresh the list and check the task before trying again.",
    "fr": "La modification n’a pas pu être confirmée. Actualisez la liste et vérifiez la tâche avant de réessayer."
  },
  "Reopen": {
    "en": "Reopen",
    "fr": "Rouvrir"
  },
  "Start": {
    "en": "Start",
    "fr": "Commencer"
  },
  "Mark done": {
    "en": "Mark done",
    "fr": "Terminer"
  },
  "Refresh tasks": {
    "en": "Refresh tasks",
    "fr": "Actualiser les tâches"
  },
  "Untitled post": {
    "en": "Untitled post",
    "fr": "Publication sans titre"
  },
  "Enter a task title.": {
    "en": "Enter a task title.",
    "fr": "Saisissez un titre pour la tâche."
  },
  "Task updated.": {
    "en": "Task updated.",
    "fr": "Tâche mise à jour."
  },
  "Task created.": {
    "en": "Task created.",
    "fr": "Tâche créée."
  },
  "Posts could not be loaded. Check your connection and try again.": {
    "en": "Posts could not be loaded. Check your connection and try again.",
    "fr": "Impossible de charger les publications. Vérifiez votre connexion, puis réessayez."
  },
  "Enter at least one task, one per line.": {
    "en": "Enter at least one task, one per line.",
    "fr": "Saisissez au moins une tâche, une par ligne."
  },
  "Task deleted.": {
    "en": "Task deleted.",
    "fr": "Tâche supprimée."
  },
  "Comments could not be loaded. Close this window and try again.": {
    "en": "Comments could not be loaded. Close this window and try again.",
    "fr": "Impossible de charger les commentaires. Fermez cette fenêtre, puis réessayez."
  },
  "Enter a comment.": {
    "en": "Enter a comment.",
    "fr": "Saisissez un commentaire."
  },
  "The comment was saved, but the list could not be refreshed.": {
    "en": "The comment was saved, but the list could not be refreshed.",
    "fr": "Le commentaire a été enregistré, mais la liste n’a pas pu être actualisée."
  },
  "Comment deleted.": {
    "en": "Comment deleted.",
    "fr": "Commentaire supprimé."
  },
  " (overdue)": {
    "en": " (overdue)",
    "fr": " (en retard)"
  },
  " (today)": {
    "en": " (today)",
    "fr": " (aujourd’hui)"
  },
  "No date": {
    "en": "No date",
    "fr": "Sans échéance"
  },
  "Linked post": {
    "en": "Linked post",
    "fr": "Publication liée"
  },
  "Linked post is not available to you.": {
    "en": "Linked post is not available to you.",
    "fr": "La publication liée ne vous est pas accessible."
  },
  "Details": {
    "en": "Details",
    "fr": "Détails"
  },
  "Edit": {
    "en": "Edit",
    "fr": "Modifier"
  },
  "Save": {
    "en": "Save",
    "fr": "Enregistrer"
  },
  "Delete": {
    "en": "Delete",
    "fr": "Supprimer"
  },
  "Delete comment": {
    "en": "Delete comment",
    "fr": "Supprimer le commentaire"
  },
  "This comment is permanently removed from the task.": {
    "en": "This comment is permanently removed from the task.",
    "fr": "Ce commentaire sera définitivement supprimé de la tâche."
  },
  "Cancel": {
    "en": "Cancel",
    "fr": "Annuler"
  },
  "Workspace task totals": {
    "en": "Workspace task totals",
    "fr": "Totaux des tâches de l’espace"
  },
  "Overdue": {
    "en": "Overdue",
    "fr": "En retard"
  },
  "New task": {
    "en": "New task",
    "fr": "Nouvelle tâche"
  },
  "Add checklist": {
    "en": "Add checklist",
    "fr": "Ajouter une liste de tâches"
  },
  "No tasks match these filters.": {
    "en": "No tasks match these filters.",
    "fr": "Aucune tâche ne correspond à ces filtres."
  },
  "No tasks yet.": {
    "en": "No tasks yet.",
    "fr": "Aucune tâche pour le moment."
  },
  "View team": {
    "en": "View team",
    "fr": "Voir l’équipe"
  },
  "Create a task or paste a checklist to start tracking work.": {
    "en": "Create a task or paste a checklist to start tracking work.",
    "fr": "Créez une tâche ou collez une liste pour commencer le suivi."
  },
  "Tasks created by your team appear here.": {
    "en": "Tasks created by your team appear here.",
    "fr": "Les tâches créées par votre équipe apparaissent ici."
  },
  "Task layout": {
    "en": "Task layout",
    "fr": "Vue des tâches"
  },
  "Board": {
    "en": "Board",
    "fr": "Tableau"
  },
  "Drag a task to another column, or use its status buttons to move it.": {
    "en": "Drag a task to another column, or use its status buttons to move it.",
    "fr": "Faites glisser une tâche vers une autre colonne ou utilisez ses boutons de statut pour la déplacer."
  },
  "Nothing here.": {
    "en": "Nothing here.",
    "fr": "Aucune tâche ici."
  },
  "List": {
    "en": "List",
    "fr": "Liste"
  },
  "Workspace tasks": {
    "en": "Workspace tasks",
    "fr": "Tâches de l’espace"
  },
  "Task": {
    "en": "Task",
    "fr": "Tâche"
  },
  "Actions": {
    "en": "Actions",
    "fr": "Actions"
  },
  "Edit task": {
    "en": "Edit task",
    "fr": "Modifier la tâche"
  },
  "Saving...": {
    "en": "Saving...",
    "fr": "Enregistrement…"
  },
  "Save task": {
    "en": "Save task",
    "fr": "Enregistrer la tâche"
  },
  "Title": {
    "en": "Title",
    "fr": "Titre"
  },
  "Notes": {
    "en": "Notes",
    "fr": "Notes"
  },
  "Due date": {
    "en": "Due date",
    "fr": "Échéance"
  },
  "No post linked.": {
    "en": "No post linked.",
    "fr": "Aucune publication liée."
  },
  "A post you cannot see is linked. It stays linked unless you remove it.": {
    "en": "A post you cannot see is linked. It stays linked unless you remove it.",
    "fr": "Une publication à laquelle vous n’avez pas accès est liée. Elle le restera sauf si vous supprimez le lien."
  },
  "Search posts to link": {
    "en": "Search posts to link",
    "fr": "Rechercher une publication à lier"
  },
  "Search post text": {
    "en": "Search post text",
    "fr": "Rechercher dans les publications"
  },
  "Searching...": {
    "en": "Searching...",
    "fr": "Recherche…"
  },
  "Find posts": {
    "en": "Find posts",
    "fr": "Rechercher des publications"
  },
  "Remove link": {
    "en": "Remove link",
    "fr": "Supprimer le lien"
  },
  "Posts are not available to link from your access.": {
    "en": "Posts are not available to link from your access.",
    "fr": "Vos accès ne permettent pas de lier des publications."
  },
  "No posts match that search.": {
    "en": "No posts match that search.",
    "fr": "Aucune publication ne correspond à cette recherche."
  },
  "Previous posts": {
    "en": "Previous posts",
    "fr": "Publications précédentes"
  },
  "More posts": {
    "en": "More posts",
    "fr": "Autres publications"
  },
  "Each line becomes a task. Everything is created together, or nothing is.": {
    "en": "Each line becomes a task. Everything is created together, or nothing is.",
    "fr": "Chaque ligne devient une tâche. Toutes les tâches sont créées ensemble, ou aucune ne l’est."
  },
  "Creating...": {
    "en": "Creating...",
    "fr": "Création…"
  },
  "Create tasks": {
    "en": "Create tasks",
    "fr": "Créer les tâches"
  },
  "Tasks, one per line (up to": {
    "en": "Tasks, one per line (up to",
    "fr": "Tâches, une par ligne (maximum"
  },
  "First due date (optional)": {
    "en": "First due date (optional)",
    "fr": "Première échéance (facultatif)"
  },
  "Days between due dates": {
    "en": "Days between due dates",
    "fr": "Jours entre les échéances"
  },
  "Delete task": {
    "en": "Delete task",
    "fr": "Supprimer la tâche"
  },
  "The task and its comments are permanently removed for everyone in this workspace.": {
    "en": "The task and its comments are permanently removed for everyone in this workspace.",
    "fr": "La tâche et ses commentaires seront définitivement supprimés pour tous les membres de cet espace."
  },
  "Deleting...": {
    "en": "Deleting...",
    "fr": "Suppression…"
  },
  "Close": {
    "en": "Close",
    "fr": "Fermer"
  },
  "Comments": {
    "en": "Comments",
    "fr": "Commentaires"
  },
  "Loading comments...": {
    "en": "Loading comments...",
    "fr": "Chargement des commentaires…"
  },
  "No comments yet.": {
    "en": "No comments yet.",
    "fr": "Aucun commentaire pour le moment."
  },
  "Former member": {
    "en": "Former member",
    "fr": "Ancien membre"
  },
  "Load more comments": {
    "en": "Load more comments",
    "fr": "Charger d’autres commentaires"
  },
  "Add a comment": {
    "en": "Add a comment",
    "fr": "Ajouter un commentaire"
  },
  "Posting...": {
    "en": "Posting...",
    "fr": "Envoi…"
  },
  "Post comment": {
    "en": "Post comment",
    "fr": "Envoyer le commentaire"
  },
  "Moved to {0}.": {
    "en": "Moved to {0}.",
    "fr": "Déplacée vers {0}."
  },
  "Linking: {0}": {
    "en": "Linking: {0}",
    "fr": "À lier : {0}"
  },
  "Linked: {0}": {
    "en": "Linked: {0}",
    "fr": "Liée : {0}"
  },
  "A checklist can have at most {0} tasks. Remove {1} and try again.": {
    "en": "A checklist can have at most {0} tasks. Remove {1} and try again.",
    "fr": "Une liste peut contenir au maximum {0} tâches. Retirez-en {1}, puis réessayez."
  },
  "Line {0} is longer than {1} characters.": {
    "en": "Line {0} is longer than {1} characters.",
    "fr": "La ligne {0} dépasse {1} caractères."
  },
  "Days between due dates must be a whole number from 0 to {0}.": {
    "en": "Days between due dates must be a whole number from 0 to {0}.",
    "fr": "Le nombre de jours entre les échéances doit être un entier de 0 à {0}."
  },
  "{0} tasks created.": {
    "en": "{0} tasks created.",
    "fr": "{0} tâches créées."
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
  "draft": {
    "en": "draft",
    "fr": "brouillon"
  },
  "scheduled": {
    "en": "scheduled",
    "fr": "planifiée"
  },
  "published": {
    "en": "published",
    "fr": "publiée"
  },
  "failed": {
    "en": "failed",
    "fr": "en échec"
  },
  "pending": {
    "en": "pending",
    "fr": "en attente"
  },
  "processing": {
    "en": "processing",
    "fr": "en cours"
  },
  "partial": {
    "en": "partial",
    "fr": "partiellement publiée"
  },
  "Draft the post\nGet approval\nSchedule it": {
    "en": "Draft the post\nGet approval\nSchedule it",
    "fr": "Rédiger la publication\nObtenir une approbation\nPlanifier"
  },
  "Tasks are unavailable for your role in this workspace.": {
    "en": "Tasks are unavailable for your role in this workspace.",
    "fr": "Votre rôle ne permet pas d’accéder aux tâches dans cet espace."
  },
  "This workspace is suspended.": {
    "en": "This workspace is suspended.",
    "fr": "Cet espace est suspendu."
  },
  "Enter a {0}.": {
    "en": "Enter a {0}.",
    "fr": "Saisissez : {0}."
  },
  "The {0} is longer than {1} characters.": {
    "en": "The {0} is longer than {1} characters.",
    "fr": "Le champ {0} dépasse {1} caractères."
  },
  "This key returns at most {0} results per call, so a checklist can create at most {1} tasks at once. Nothing was created.": {
    "en": "This key returns at most {0} results per call, so a checklist can create at most {1} tasks at once. Nothing was created.",
    "fr": "Cette clé renvoie au maximum {0} résultats par appel ; une liste peut donc créer au maximum {1} tâches à la fois. Aucune tâche n’a été créée."
  },
  "A checklist can create at most {0} tasks at once.": {
    "en": "A checklist can create at most {0} tasks at once.",
    "fr": "Une liste peut créer au maximum {0} tâches à la fois."
  },
  "Due dates can be at most {0} days apart.": {
    "en": "Due dates can be at most {0} days apart.",
    "fr": "Les échéances peuvent être espacées de {0} jours au maximum."
  },
  "This task is unavailable in the current workspace.": {
    "en": "This task is unavailable in the current workspace.",
    "fr": "Cette tâche est indisponible dans cet espace."
  },
  "Tasks are currently unavailable.": {
    "en": "Tasks are currently unavailable.",
    "fr": "Les tâches sont actuellement indisponibles."
  },
  "Choose valid task filters.": {
    "en": "Choose valid task filters.",
    "fr": "Choisissez des filtres de tâches valides."
  },
  "Choose a valid comment page.": {
    "en": "Choose a valid comment page.",
    "fr": "Choisissez une page de commentaires valide."
  },
  "Choose a valid post search.": {
    "en": "Choose a valid post search.",
    "fr": "Choisissez une recherche de publication valide."
  },
  "The task change could not be recorded, so it was not saved.": {
    "en": "The task change could not be recorded, so it was not saved.",
    "fr": "La modification de la tâche n’a pas pu être enregistrée."
  },
  "Workspace data deletion is in progress.": {
    "en": "Workspace data deletion is in progress.",
    "fr": "La suppression des données de l’espace est en cours."
  },
  "Choose an active team member as the assignee.": {
    "en": "Choose an active team member as the assignee.",
    "fr": "Choisissez un membre actif de l’équipe comme responsable."
  },
  "Choose a post you can access in this workspace.": {
    "en": "Choose a post you can access in this workspace.",
    "fr": "Choisissez une publication accessible dans cet espace."
  },
  "Type the exact confirmation text to continue.": {
    "en": "Type the exact confirmation text to continue.",
    "fr": "Saisissez le texte de confirmation exact pour continuer."
  },
  "Choose a valid task action.": {
    "en": "Choose a valid task action.",
    "fr": "Choisissez une action de tâche valide."
  },
  "The checklist dates run past the supported calendar. Use an earlier start date.": {
    "en": "The checklist dates run past the supported calendar. Use an earlier start date.",
    "fr": "Les dates de la liste dépassent le calendrier pris en charge. Choisissez une date de début antérieure."
  },
  "Only the comment author or a workspace manager can remove this comment.": {
    "en": "Only the comment author or a workspace manager can remove this comment.",
    "fr": "Seuls l’auteur du commentaire ou un responsable de l’espace peuvent le supprimer."
  },
  "You can only delete tasks you created, unless you manage the workspace.": {
    "en": "You can only delete tasks you created, unless you manage the workspace.",
    "fr": "Vous pouvez supprimer uniquement les tâches que vous avez créées, sauf si vous gérez cet espace."
  },
  "You can only change tasks you created or that are assigned to you.": {
    "en": "You can only change tasks you created or that are assigned to you.",
    "fr": "Vous pouvez modifier uniquement les tâches que vous avez créées ou qui vous sont attribuées."
  },
  "This task is already in that status. Refresh and check its current status.": {
    "en": "This task is already in that status. Refresh and check its current status.",
    "fr": "Cette tâche a déjà ce statut. Actualisez pour vérifier son statut actuel."
  },
  "This task changed while you were working. Refresh and try again.": {
    "en": "This task changed while you were working. Refresh and try again.",
    "fr": "Cette tâche a été modifiée pendant votre travail. Actualisez, puis réessayez."
  },
  "This task changed while you were editing it. Refresh to see the latest version, then repeat your change.": {
    "en": "This task changed while you were editing it. Refresh to see the latest version, then repeat your change.",
    "fr": "Cette tâche a été modifiée pendant votre saisie. Actualisez pour voir la dernière version, puis recommencez votre modification."
  },
  "Change at least one task field.": {
    "en": "Change at least one task field.",
    "fr": "Modifiez au moins un champ de la tâche."
  },
  "Choose a valid task request.": {
    "en": "Choose a valid task request.",
    "fr": "Choisissez une demande de tâche valide."
  },
  "task title": {
    "en": "task title",
    "fr": "titre de la tâche"
  },
  "task notes": {
    "en": "task notes",
    "fr": "notes de la tâche"
  },
  "comment": {
    "en": "comment",
    "fr": "commentaire"
  },
  "Choose a valid task.": {
    "en": "Choose a valid task.",
    "fr": "Choisissez une tâche valide."
  },
  "Unknown task action.": {
    "en": "Unknown task action.",
    "fr": "Action de tâche inconnue."
  },
  "pending approval": {
    "en": "pending approval",
    "fr": "en attente d’approbation"
  },
  "rejected": {
    "en": "rejected",
    "fr": "refusée"
  },
  "publishing": {
    "en": "publishing",
    "fr": "publication en cours"
  },
  "partially failed": {
    "en": "partially failed",
    "fr": "partiellement en échec"
  },
  "cancelled": {
    "en": "cancelled",
    "fr": "annulée"
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
        result = row.fr.replace(/\{(\d+)\}/g, (token, index: string) => {
          const value = match[indices.indexOf(index) + 1];
          const field = (['task title', 'task notes', 'comment'] as const).find(key => catalog[key].en === value);
          return field ? catalog[field].fr : value ?? token;
        });
        break;
      }
    }
  }
  return (result ?? text).replace(/\{(\d+)\}/g, (match, index: string) => String(values[Number(index)] ?? match));
};
