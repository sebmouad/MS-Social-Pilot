import { bilingualCatalogSchema } from '../kit/copy-schema';
import { fillCopy } from '../kit/copy';
export const templateCopyDefaults = {
  "requestFailed": {
    "en": "The request could not be confirmed. Refresh the list and check the current template before trying again.",
    "fr": "La demande n’a pas pu être confirmée. Actualisez la liste et vérifiez le modèle avant de réessayer."
  },
  "saveUnknown": {
    "en": "The save result is unknown. Refresh the list and check the current template before trying again.",
    "fr": "Le résultat de l’enregistrement est inconnu. Actualisez la liste et vérifiez le modèle avant de réessayer."
  },
  "deleteUnknown": {
    "en": "The deletion result is unknown. Refresh and check the template before retrying.",
    "fr": "Le résultat de la suppression est inconnu. Actualisez et vérifiez le modèle avant de réessayer."
  },
  "needNameAndBody": {
    "en": "Enter a template name and message before saving.",
    "fr": "Saisissez un nom et un message avant d’enregistrer."
  },
  "updated": {
    "en": "Template updated.",
    "fr": "Modèle mis à jour."
  },
  "created": {
    "en": "Template created. It is ready to select in the post composer.",
    "fr": "Modèle créé. Vous pouvez le choisir dans le composeur de publication."
  },
  "deleted": {
    "en": "Template deleted. Existing drafts and published posts are unchanged.",
    "fr": "Modèle supprimé. Les brouillons et publications existants ne changent pas."
  },
  "unknownDate": {
    "en": "Unknown",
    "fr": "Inconnue"
  },
  "search": {
    "en": "Search templates",
    "fr": "Rechercher des modèles"
  },
  "searchPlaceholder": {
    "en": "Name, category or message",
    "fr": "Nom, catégorie ou message"
  },
  "searchButton": {
    "en": "Search",
    "fr": "Rechercher"
  },
  "clear": {
    "en": "Clear",
    "fr": "Effacer"
  },
  "newTemplate": {
    "en": "New template",
    "fr": "Nouveau modèle"
  },
  "caption": {
    "en": "Reusable post templates",
    "fr": "Modèles de publication réutilisables"
  },
  "template": {
    "en": "Template",
    "fr": "Modèle"
  },
  "category": {
    "en": "Category",
    "fr": "Catégorie"
  },
  "preview": {
    "en": "Message preview",
    "fr": "Aperçu du message"
  },
  "updatedColumn": {
    "en": "Updated",
    "fr": "Mis à jour"
  },
  "noHashtags": {
    "en": "No hashtags",
    "fr": "Aucun hashtag"
  },
  "includesComment": {
    "en": " · Includes first comment",
    "fr": " · Avec premier commentaire"
  },
  "uncategorized": {
    "en": "Uncategorized",
    "fr": "Sans catégorie"
  },
  "edit": {
    "en": "Edit",
    "fr": "Modifier"
  },
  "delete": {
    "en": "Delete",
    "fr": "Supprimer"
  },
  "actionsFor.variant0": {
    "en": "Actions for {v0}",
    "fr": "Actions pour {v0}"
  },
  "noMatch": {
    "en": "No templates match this search.",
    "fr": "Aucun modèle ne correspond à cette recherche."
  },
  "empty": {
    "en": "No templates yet. Create one to reuse message text, hashtags and a first comment in the post composer.",
    "fr": "Aucun modèle pour l’instant. Créez-en un pour réutiliser un message, des hashtags et un premier commentaire dans le composeur."
  },
  "clearSearch": {
    "en": "Clear search",
    "fr": "Effacer la recherche"
  },
  "pages": {
    "en": "Template pages",
    "fr": "Pages de modèles"
  },
  "previous": {
    "en": "Previous page",
    "fr": "Page précédente"
  },
  "next": {
    "en": "Next page",
    "fr": "Page suivante"
  },
  "page.variant0": {
    "en": "Page {v0}",
    "fr": "Page {v0}"
  },
  "help": {
    "en": "Templates are shared with workspace members who can create posts. They save message text, hashtags, first comment and an optional label; media and links are chosen separately in the composer.",
    "fr": "Les modèles sont partagés avec les membres de l’espace qui peuvent créer des publications. Ils enregistrent le message, les hashtags, le premier commentaire et une étiquette facultative ; les médias et les liens se choisissent dans le composeur."
  },
  "editTitle": {
    "en": "Edit template",
    "fr": "Modifier le modèle"
  },
  "newTitle": {
    "en": "New template",
    "fr": "Nouveau modèle"
  },
  "dialogDescription": {
    "en": "Templates save reusable post content. Saving a template does not create or publish a post.",
    "fr": "Un modèle conserve du contenu réutilisable. L’enregistrer ne crée ni ne publie aucune publication."
  },
  "cancel": {
    "en": "Cancel",
    "fr": "Annuler"
  },
  "saving": {
    "en": "Saving…",
    "fr": "Enregistrement…"
  },
  "saveChanges": {
    "en": "Save changes",
    "fr": "Enregistrer"
  },
  "createTemplate": {
    "en": "Create template",
    "fr": "Créer le modèle"
  },
  "name": {
    "en": "Name",
    "fr": "Nom"
  },
  "optional": {
    "en": "(optional)",
    "fr": "(facultatif)"
  },
  "message": {
    "en": "Message",
    "fr": "Message"
  },
  "hashtags": {
    "en": "Hashtags",
    "fr": "Hashtags"
  },
  "firstComment": {
    "en": "First comment",
    "fr": "Premier commentaire"
  },
  "delay": {
    "en": "Wait before the first comment",
    "fr": "Délai avant le premier commentaire"
  },
  "delayHint": {
    "en": "(minutes; 0 sends it right after publication)",
    "fr": "(minutes ; 0 l’envoie juste après la publication)"
  },
  "delayHelp.variant0": {
    "en": "Choose a whole number from 0 to {v0} minutes.",
    "fr": "Choisissez un nombre entier de 0 à {v0} minutes."
  },
  "label": {
    "en": "Label",
    "fr": "Étiquette"
  },
  "noLabel": {
    "en": "No label",
    "fr": "Aucune étiquette"
  },
  "mediaHelp": {
    "en": "Media and links are selected separately in the composer.",
    "fr": "Les médias et les liens se choisissent séparément dans le composeur."
  },
  "deleteTitle": {
    "en": "Delete template",
    "fr": "Supprimer le modèle"
  },
  "deleteBody.variant0": {
    "en": "This removes “{v0}” from your workspace. Posts already created from it remain unchanged.",
    "fr": "Cela retire « {v0} » de votre espace. Les publications déjà créées à partir de ce modèle ne changent pas."
  },
  "deleteConfirm": {
    "en": "Delete template",
    "fr": "Supprimer le modèle"
  },
  "deleting": {
    "en": "Deleting…",
    "fr": "Suppression…"
  },
  "deleteFailed": {
    "en": "Could not delete the template. Nothing was changed.",
    "fr": "Impossible de supprimer le modèle. Rien n’a été modifié."
  }
};
export type TemplateCopyCatalog = typeof templateCopyDefaults;
export const templateCopySchema = bilingualCatalogSchema(templateCopyDefaults);
export function resolveTemplateCopy(catalog:TemplateCopyCatalog) { return {"en":{"requestFailed":catalog["requestFailed"].en,
"saveUnknown":catalog["saveUnknown"].en,
"deleteUnknown":catalog["deleteUnknown"].en,
"needNameAndBody":catalog["needNameAndBody"].en,
"updated":catalog["updated"].en,
"created":catalog["created"].en,
"deleted":catalog["deleted"].en,
"unknownDate":catalog["unknownDate"].en,
"search":catalog["search"].en,
"searchPlaceholder":catalog["searchPlaceholder"].en,
"searchButton":catalog["searchButton"].en,
"clear":catalog["clear"].en,
"newTemplate":catalog["newTemplate"].en,
"caption":catalog["caption"].en,
"template":catalog["template"].en,
"category":catalog["category"].en,
"preview":catalog["preview"].en,
"updatedColumn":catalog["updatedColumn"].en,
"noHashtags":catalog["noHashtags"].en,
"includesComment":catalog["includesComment"].en,
"uncategorized":catalog["uncategorized"].en,
"edit":catalog["edit"].en,
"delete":catalog["delete"].en,
"actionsFor":(name: string)=>fillCopy(catalog["actionsFor.variant0"].en,{v0:(name)}),
"noMatch":catalog["noMatch"].en,
"empty":catalog["empty"].en,
"clearSearch":catalog["clearSearch"].en,
"pages":catalog["pages"].en,
"previous":catalog["previous"].en,
"next":catalog["next"].en,
"page":(n: number)=>fillCopy(catalog["page.variant0"].en,{v0:(n)}),
"help":catalog["help"].en,
"editTitle":catalog["editTitle"].en,
"newTitle":catalog["newTitle"].en,
"dialogDescription":catalog["dialogDescription"].en,
"cancel":catalog["cancel"].en,
"saving":catalog["saving"].en,
"saveChanges":catalog["saveChanges"].en,
"createTemplate":catalog["createTemplate"].en,
"name":catalog["name"].en,
"optional":catalog["optional"].en,
"message":catalog["message"].en,
"hashtags":catalog["hashtags"].en,
"firstComment":catalog["firstComment"].en,
"delay":catalog["delay"].en,
"delayHint":catalog["delayHint"].en,
"delayHelp":(max: number)=>fillCopy(catalog["delayHelp.variant0"].en,{v0:(max.toLocaleString('en'))}),
"label":catalog["label"].en,
"noLabel":catalog["noLabel"].en,
"mediaHelp":catalog["mediaHelp"].en,
"deleteTitle":catalog["deleteTitle"].en,
"deleteBody":(name: string)=>fillCopy(catalog["deleteBody.variant0"].en,{v0:(name)}),
"deleteConfirm":catalog["deleteConfirm"].en,
"deleting":catalog["deleting"].en,
"deleteFailed":catalog["deleteFailed"].en},
"fr":{"requestFailed":catalog["requestFailed"].fr,
"saveUnknown":catalog["saveUnknown"].fr,
"deleteUnknown":catalog["deleteUnknown"].fr,
"needNameAndBody":catalog["needNameAndBody"].fr,
"updated":catalog["updated"].fr,
"created":catalog["created"].fr,
"deleted":catalog["deleted"].fr,
"unknownDate":catalog["unknownDate"].fr,
"search":catalog["search"].fr,
"searchPlaceholder":catalog["searchPlaceholder"].fr,
"searchButton":catalog["searchButton"].fr,
"clear":catalog["clear"].fr,
"newTemplate":catalog["newTemplate"].fr,
"caption":catalog["caption"].fr,
"template":catalog["template"].fr,
"category":catalog["category"].fr,
"preview":catalog["preview"].fr,
"updatedColumn":catalog["updatedColumn"].fr,
"noHashtags":catalog["noHashtags"].fr,
"includesComment":catalog["includesComment"].fr,
"uncategorized":catalog["uncategorized"].fr,
"edit":catalog["edit"].fr,
"delete":catalog["delete"].fr,
"actionsFor":(name: string)=>fillCopy(catalog["actionsFor.variant0"].fr,{v0:(name)}),
"noMatch":catalog["noMatch"].fr,
"empty":catalog["empty"].fr,
"clearSearch":catalog["clearSearch"].fr,
"pages":catalog["pages"].fr,
"previous":catalog["previous"].fr,
"next":catalog["next"].fr,
"page":(n: number)=>fillCopy(catalog["page.variant0"].fr,{v0:(n)}),
"help":catalog["help"].fr,
"editTitle":catalog["editTitle"].fr,
"newTitle":catalog["newTitle"].fr,
"dialogDescription":catalog["dialogDescription"].fr,
"cancel":catalog["cancel"].fr,
"saving":catalog["saving"].fr,
"saveChanges":catalog["saveChanges"].fr,
"createTemplate":catalog["createTemplate"].fr,
"name":catalog["name"].fr,
"optional":catalog["optional"].fr,
"message":catalog["message"].fr,
"hashtags":catalog["hashtags"].fr,
"firstComment":catalog["firstComment"].fr,
"delay":catalog["delay"].fr,
"delayHint":catalog["delayHint"].fr,
"delayHelp":(max: number)=>fillCopy(catalog["delayHelp.variant0"].fr,{v0:(max.toLocaleString('fr'))}),
"label":catalog["label"].fr,
"noLabel":catalog["noLabel"].fr,
"mediaHelp":catalog["mediaHelp"].fr,
"deleteTitle":catalog["deleteTitle"].fr,
"deleteBody":(name: string)=>fillCopy(catalog["deleteBody.variant0"].fr,{v0:(name)}),
"deleteConfirm":catalog["deleteConfirm"].fr,
"deleting":catalog["deleting"].fr,
"deleteFailed":catalog["deleteFailed"].fr}}; }
