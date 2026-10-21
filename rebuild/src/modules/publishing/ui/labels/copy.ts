import { bilingualCatalogSchema } from '../kit/copy-schema';
import { fillCopy } from '../kit/copy';
type Usage = { posts:number; templates:number; contentMixRules:number };
export const labelCopyDefaults = {
  "noun.rule.one": { en: "{count} content-mix rule", fr: "{count} règle" },
  "noun.rule.many": { en: "{count} content-mix rules", fr: "{count} règles" },
  "noun.template.one": { en: "{count} template", fr: "{count} modèle" },
  "noun.template.many": { en: "{count} templates", fr: "{count} modèles" },
  "noun.post.one": { en: "{count} post", fr: "{count} publication" },
  "noun.post.many": { en: "{count} posts", fr: "{count} publications" },
  "requestFailed": {
    "en": "The request could not be confirmed. Refresh the list and check the current label before trying again.",
    "fr": "La demande n’a pas pu être confirmée. Actualisez la liste et vérifiez l’étiquette avant de réessayer."
  },
  "removal.variant0": {
    "en": "Deleting this label detaches it from {v0}, clears it from {v1} and removes {v2}. The posts and templates themselves are kept.",
    "fr": "Supprimer cette étiquette la retire de {v0}, de {v1} et supprime {v2} de mix de contenu. Les publications et les modèles sont conservés."
  },
  "removalUnknown": {
    "en": "Deleting a label detaches it from every post in the workspace, clears it from templates and removes content-mix rules that use it. The posts and templates themselves are kept.",
    "fr": "Supprimer une étiquette la retire de toutes les publications de l’espace, des modèles et des règles de mix de contenu qui l’utilisent. Les publications et les modèles sont conservés."
  },
  "limited": {
    "en": "Your access is limited to some channels, so only members with access to all channels can rename or delete labels.",
    "fr": "Votre accès est limité à certains canaux : seuls les membres ayant accès à tous les canaux peuvent renommer ou supprimer des étiquettes."
  },
  "saveUnknown": {
    "en": "The save result is unknown. Refresh the list and check the label before trying again.",
    "fr": "Le résultat de l’enregistrement est inconnu. Actualisez la liste et vérifiez l’étiquette avant de réessayer."
  },
  "deleteUnknown": {
    "en": "The deletion result is unknown. Refresh and check the label before retrying.",
    "fr": "Le résultat de la suppression est inconnu. Actualisez et vérifiez l’étiquette avant de réessayer."
  },
  "updated": {
    "en": "Label updated everywhere it is used.",
    "fr": "Étiquette mise à jour partout où elle est utilisée."
  },
  "created": {
    "en": "Label created.",
    "fr": "Étiquette créée."
  },
  "deleted": {
    "en": "Label deleted. Posts and templates remain; the label is detached from them.",
    "fr": "Étiquette supprimée. Les publications et les modèles restent ; l’étiquette en est retirée."
  },
  "search": {
    "en": "Search labels",
    "fr": "Rechercher des étiquettes"
  },
  "name": {
    "en": "Label name",
    "fr": "Nom de l’étiquette"
  },
  "searchButton": {
    "en": "Search",
    "fr": "Rechercher"
  },
  "clear": {
    "en": "Clear",
    "fr": "Effacer"
  },
  "newLabel": {
    "en": "New label",
    "fr": "Nouvelle étiquette"
  },
  "caption": {
    "en": "Post labels",
    "fr": "Étiquettes de publication"
  },
  "label": {
    "en": "Label",
    "fr": "Étiquette"
  },
  "posts": {
    "en": "Posts",
    "fr": "Publications"
  },
  "templates": {
    "en": "Templates",
    "fr": "Modèles"
  },
  "mix": {
    "en": "Content mix rules",
    "fr": "Règles de mix de contenu"
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
    "en": "No labels match this search.",
    "fr": "Aucune étiquette ne correspond à cette recherche."
  },
  "empty": {
    "en": "No labels yet. Create one to group posts by campaign, client or theme.",
    "fr": "Aucune étiquette pour l’instant. Créez-en une pour regrouper les publications par campagne, client ou thème."
  },
  "clearSearch": {
    "en": "Clear search",
    "fr": "Effacer la recherche"
  },
  "limitedNote": {
    "en": "Your access is limited to some channels, so label counts are hidden and only members with access to all channels can rename or delete labels. You can still create labels.",
    "fr": "Votre accès est limité à certains canaux : les compteurs sont masqués et seuls les membres ayant accès à tous les canaux peuvent renommer ou supprimer des étiquettes. Vous pouvez toujours en créer."
  },
  "pages": {
    "en": "Label pages",
    "fr": "Pages d’étiquettes"
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
  "editTitle": {
    "en": "Edit label",
    "fr": "Modifier l’étiquette"
  },
  "newTitle": {
    "en": "New label",
    "fr": "Nouvelle étiquette"
  },
  "dialogDescription": {
    "en": "Labels tag posts for filtering and planning. Saving a label does not change or publish any post.",
    "fr": "Les étiquettes servent à filtrer et planifier les publications. Enregistrer une étiquette ne modifie ni ne publie aucune publication."
  },
  "cancel": {
    "en": "Cancel",
    "fr": "Annuler"
  },
  "saveChanges": {
    "en": "Save changes",
    "fr": "Enregistrer"
  },
  "createLabel": {
    "en": "Create label",
    "fr": "Créer l’étiquette"
  },
  "saving": {
    "en": "Saving…",
    "fr": "Enregistrement…"
  },
  "nameField": {
    "en": "Name",
    "fr": "Nom"
  },
  "colour": {
    "en": "Colour",
    "fr": "Couleur"
  },
  "renameHelp": {
    "en": "Renaming or recolouring changes this label on every post and template that uses it.",
    "fr": "Renommer ou changer la couleur modifie cette étiquette sur toutes les publications et tous les modèles qui l’utilisent."
  },
  "nameRequired": {
    "en": "Enter a label name.",
    "fr": "Saisissez un nom d’étiquette."
  },
  "deleteTitle": {
    "en": "Delete label",
    "fr": "Supprimer l’étiquette"
  },
  "deleteConfirm": {
    "en": "Delete label",
    "fr": "Supprimer l’étiquette"
  },
  "deleting": {
    "en": "Deleting…",
    "fr": "Suppression…"
  },
  "deleteFailed": {
    "en": "Could not delete the label. Nothing was changed.",
    "fr": "Impossible de supprimer l’étiquette. Rien n’a été modifié."
  },
  "colours.blue": {
    "fr": "Bleu",
    "en": "Blue"
  },
  "colours.green": {
    "fr": "Vert",
    "en": "Green"
  },
  "colours.red": {
    "fr": "Rouge",
    "en": "Red"
  },
  "colours.orange": {
    "fr": "Orange",
    "en": "Orange"
  },
  "colours.yellow": {
    "fr": "Jaune",
    "en": "Yellow"
  },
  "colours.purple": {
    "fr": "Violet",
    "en": "Purple"
  },
  "colours.pink": {
    "fr": "Rose",
    "en": "Pink"
  },
  "colours.teal": {
    "fr": "Turquoise",
    "en": "Teal"
  },
  "colours.gray": {
    "fr": "Gris",
    "en": "Gray"
  },
  "colours.grey": {
    "fr": "Gris",
    "en": "Grey"
  }
};
export type LabelCopyCatalog = typeof labelCopyDefaults;
export const labelCopySchema = bilingualCatalogSchema(labelCopyDefaults);
export function resolveLabelCopy(catalog:LabelCopyCatalog) { return {"en":{"requestFailed":catalog["requestFailed"].en,
"removal":(usage: Usage)=>fillCopy(catalog["removal.variant0"].en,{v0:(fillCopy(catalog[usage.posts === 1 ? "noun.post.one" : "noun.post.many"].en, {count:usage.posts})),v1:(fillCopy(catalog[usage.templates === 1 ? "noun.template.one" : "noun.template.many"].en, {count:usage.templates})),v2:(fillCopy(catalog[usage.contentMixRules === 1 ? "noun.rule.one" : "noun.rule.many"].en, {count:usage.contentMixRules}))}),
"removalUnknown":catalog["removalUnknown"].en,
"limited":catalog["limited"].en,
"saveUnknown":catalog["saveUnknown"].en,
"deleteUnknown":catalog["deleteUnknown"].en,
"updated":catalog["updated"].en,
"created":catalog["created"].en,
"deleted":catalog["deleted"].en,
"search":catalog["search"].en,
"name":catalog["name"].en,
"searchButton":catalog["searchButton"].en,
"clear":catalog["clear"].en,
"newLabel":catalog["newLabel"].en,
"caption":catalog["caption"].en,
"label":catalog["label"].en,
"posts":catalog["posts"].en,
"templates":catalog["templates"].en,
"mix":catalog["mix"].en,
"edit":catalog["edit"].en,
"delete":catalog["delete"].en,
"actionsFor":(name: string)=>fillCopy(catalog["actionsFor.variant0"].en,{v0:(name)}),
"noMatch":catalog["noMatch"].en,
"empty":catalog["empty"].en,
"clearSearch":catalog["clearSearch"].en,
"limitedNote":catalog["limitedNote"].en,
"pages":catalog["pages"].en,
"previous":catalog["previous"].en,
"next":catalog["next"].en,
"page":(n: number)=>fillCopy(catalog["page.variant0"].en,{v0:(n)}),
"editTitle":catalog["editTitle"].en,
"newTitle":catalog["newTitle"].en,
"dialogDescription":catalog["dialogDescription"].en,
"cancel":catalog["cancel"].en,
"saveChanges":catalog["saveChanges"].en,
"createLabel":catalog["createLabel"].en,
"saving":catalog["saving"].en,
"nameField":catalog["nameField"].en,
"colour":catalog["colour"].en,
"renameHelp":catalog["renameHelp"].en,
"nameRequired":catalog["nameRequired"].en,
"deleteTitle":catalog["deleteTitle"].en,
"deleteConfirm":catalog["deleteConfirm"].en,
"deleting":catalog["deleting"].en,
"deleteFailed":catalog["deleteFailed"].en,
"colours":{"blue":catalog["colours.blue"].en,"green":catalog["colours.green"].en,"red":catalog["colours.red"].en,"orange":catalog["colours.orange"].en,"yellow":catalog["colours.yellow"].en,"purple":catalog["colours.purple"].en,"pink":catalog["colours.pink"].en,"teal":catalog["colours.teal"].en,"gray":catalog["colours.gray"].en,"grey":catalog["colours.grey"].en} as Record<string,string>},
"fr":{"requestFailed":catalog["requestFailed"].fr,
"removal":(usage: Usage)=>fillCopy(catalog["removal.variant0"].fr,{v0:(fillCopy(catalog[usage.posts <= 1 ? "noun.post.one" : "noun.post.many"].fr, {count:usage.posts})),v1:(fillCopy(catalog[usage.templates <= 1 ? "noun.template.one" : "noun.template.many"].fr, {count:usage.templates})),v2:(fillCopy(catalog[usage.contentMixRules <= 1 ? "noun.rule.one" : "noun.rule.many"].fr, {count:usage.contentMixRules}))}),
"removalUnknown":catalog["removalUnknown"].fr,
"limited":catalog["limited"].fr,
"saveUnknown":catalog["saveUnknown"].fr,
"deleteUnknown":catalog["deleteUnknown"].fr,
"updated":catalog["updated"].fr,
"created":catalog["created"].fr,
"deleted":catalog["deleted"].fr,
"search":catalog["search"].fr,
"name":catalog["name"].fr,
"searchButton":catalog["searchButton"].fr,
"clear":catalog["clear"].fr,
"newLabel":catalog["newLabel"].fr,
"caption":catalog["caption"].fr,
"label":catalog["label"].fr,
"posts":catalog["posts"].fr,
"templates":catalog["templates"].fr,
"mix":catalog["mix"].fr,
"edit":catalog["edit"].fr,
"delete":catalog["delete"].fr,
"actionsFor":(name: string)=>fillCopy(catalog["actionsFor.variant0"].fr,{v0:(name)}),
"noMatch":catalog["noMatch"].fr,
"empty":catalog["empty"].fr,
"clearSearch":catalog["clearSearch"].fr,
"limitedNote":catalog["limitedNote"].fr,
"pages":catalog["pages"].fr,
"previous":catalog["previous"].fr,
"next":catalog["next"].fr,
"page":(n: number)=>fillCopy(catalog["page.variant0"].fr,{v0:(n)}),
"editTitle":catalog["editTitle"].fr,
"newTitle":catalog["newTitle"].fr,
"dialogDescription":catalog["dialogDescription"].fr,
"cancel":catalog["cancel"].fr,
"saveChanges":catalog["saveChanges"].fr,
"createLabel":catalog["createLabel"].fr,
"saving":catalog["saving"].fr,
"nameField":catalog["nameField"].fr,
"colour":catalog["colour"].fr,
"renameHelp":catalog["renameHelp"].fr,
"nameRequired":catalog["nameRequired"].fr,
"deleteTitle":catalog["deleteTitle"].fr,
"deleteConfirm":catalog["deleteConfirm"].fr,
"deleting":catalog["deleting"].fr,
"deleteFailed":catalog["deleteFailed"].fr,
"colours":{"blue":catalog["colours.blue"].fr,
"green":catalog["colours.green"].fr,
"red":catalog["colours.red"].fr,
"orange":catalog["colours.orange"].fr,
"yellow":catalog["colours.yellow"].fr,
"purple":catalog["colours.purple"].fr,
"pink":catalog["colours.pink"].fr,
"teal":catalog["colours.teal"].fr,
"gray":catalog["colours.gray"].fr,
"grey":catalog["colours.grey"].fr} as Record<string,string>}}; }
