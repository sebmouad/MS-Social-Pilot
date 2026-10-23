import { z } from 'zod';
import { adsCopy } from './analysis/copy';
import { creativeCopy } from './ui/creative-copy';

export const adsCustomerCopy = {
"resultsCaption": {"en": "{level} results for {account}", "fr": "Résultats {level} pour {account}"},
"accountFallback": {"en": "ad account", "fr": "compte publicitaire"},
"managementInvalidView": {"en": "Choose a valid Ads management view.", "fr": "Choisissez une vue de gestion publicitaire valide."},
"managementLoadFailure": {"en": "Ads management could not be loaded. Please try again.", "fr": "Impossible de charger la gestion publicitaire. Réessayez."},
"managementInvalidRequest": {"en": "Invalid Ads management request.", "fr": "Demande de gestion publicitaire invalide."},
"managementOriginDenied": {"en": "Cross-origin request denied.", "fr": "Demande provenant d’un autre site refusée."},
"managementOutcomeUnknown": {"en": "The change outcome is unconfirmed. Check Ads change history before repeating it.", "fr": "Le résultat de la modification n’est pas confirmé. Consultez l’historique publicitaire avant de la répéter."},

"facebookNamePrintable": {"en": "Names must contain 1 to {max} printable characters.", "fr": "Les noms doivent contenir de 1 à {max} caractères imprimables."},
"facebookCampaignNamePrintable": {"en": "Campaign names must contain 1 to {max} printable characters.", "fr": "Les noms de campagne doivent contenir de 1 à {max} caractères imprimables."},
"facebookAdSetNamePrintable": {"en": "Ad set names must contain 1 to {max} printable characters.", "fr": "Les noms d’ensemble doivent contenir de 1 à {max} caractères imprimables."},
"filterTextLimit": {"en": "{key} must be text with at most {max} characters.", "fr": "{key} doit être un texte de {max} caractères maximum."},
"startDateFormat": {"en": "start must be a valid YYYY-MM-DD date.", "fr": "La date de début doit respecter le format AAAA-MM-JJ."},
"endDateFormat": {"en": "end must be a valid YYYY-MM-DD date.", "fr": "La date de fin doit respecter le format AAAA-MM-JJ."},
"reportLevel": {"en": "level must be campaign, adset, or ad.", "fr": "Le niveau doit être campaign, adset ou ad."},
"reportOffsets": {"en": "offset and limit must be valid integers.", "fr": "Le décalage et la limite doivent être des entiers valides."},
"accountOffset": {"en": "accountOffset must be a non-negative integer.", "fr": "Le décalage des comptes doit être un entier positif ou nul."},
"findingConcentrated": {"en": "{name} accounts for {share}% of spend.", "fr": "{name} représente {share} % des dépenses."},
"findingBestCtr": {"en": "{name} has a click-through rate {ratio} times the account average.", "fr": "Le taux de clic de {name} est {ratio} fois la moyenne du compte."},
"viewOnlyObject": {"en": "You can view this {kind}. Changes are not available for your access or this account.", "fr": "Vous pouvez consulter cet objet : {kind}. Les modifications ne sont pas disponibles pour vos droits ou ce compte."},
"grantMissing": {"en": "Reconnect this advertising connection and allow advertising changes.", "fr": "Reconnectez cette connexion publicitaire et autorisez les modifications publicitaires."},
"needsReconnectObject": {"en": "Changes are paused for this {kind} until the advertising connection is reconnected with permission to make changes.", "fr": "Les modifications sont suspendues pour cet objet ({kind}) tant que la connexion publicitaire n’est pas reconnectée avec l’autorisation de modifier."},
"needsReconnectAction": {"en": "Reconnect in Settings", "fr": "Reconnecter dans les paramètres"},
"needsReconnectAccount": {"en": "Advertising changes are paused for {account}. Reconnect its connection and allow advertising changes to create or edit campaigns, ad sets and ads.", "fr": "Les modifications publicitaires sont suspendues pour {account}. Reconnectez sa connexion et autorisez les modifications pour créer ou modifier campagnes, ensembles et publicités."},
"adCreateName": {"en": "Enter an ad name.", "fr": "Saisissez un nom de publicité."},
"adCreateParent": {"en": "Choose a valid ad set.", "fr": "Choisissez un ensemble de publicités valide."},
"adCreateParentMissing": {"en": "This ad set cannot be verified for the selected account. Wait for the next sync or choose another ad set.", "fr": "Cet ensemble de publicités ne peut pas être vérifié pour le compte sélectionné. Attendez la prochaine synchronisation ou choisissez-en un autre."},
"adCreateTitle": {"en": "Create paused ad under {adSetName}", "fr": "Créer une publicité en pause dans {adSetName}"},
"adCreateDescription": {"en": "The ad uses an existing creative and starts paused. Nothing is delivered or spent until you resume it separately.", "fr": "La publicité utilise un visuel existant et démarre en pause. Rien n’est diffusé ni dépensé tant que vous ne la reprenez pas séparément."},
"adCreateNameLabel": {"en": "Ad name", "fr": "Nom de la publicité"},
"adCreateCreativeLabel": {"en": "Creative", "fr": "Visuel"},
"adCreateChoose": {"en": "Choose a creative", "fr": "Choisissez un visuel"},
"adCreateLoad": {"en": "Load creatives", "fr": "Charger les visuels"},
"adCreateNoCreatives": {"en": "This account has no creatives yet. Create one first, then add the ad.", "fr": "Ce compte n’a pas encore de visuel. Créez-en un, puis ajoutez la publicité."},
"adCreateReview": {"en": "Review ad", "fr": "Vérifier la publicité"},
"adCreateAction": {"en": "Create paused ad", "fr": "Créer la publicité en pause"},
"adCreateConfirmTitle": {"en": "Create this paused ad?", "fr": "Créer cette publicité en pause ?"},
"adCreateHeldLabel": {"en": "Ad creation needs review", "fr": "La création de la publicité doit être vérifiée"},
"adCreateSuccess": {"en": "Paused ad created.", "fr": "Publicité créée en pause."},
"adCreateChooseCreative": {"en": "Choose a creative.", "fr": "Choisissez un visuel."},
"hierarchyNote": {"en": "Campaigns contain ad sets, and ad sets contain ads. Figures at each level overlap, so do not add them together.", "fr": "Les campagnes contiennent des ensembles de publicités, qui contiennent des publicités. Les chiffres de chaque niveau se recoupent : ne les additionnez pas."},
"hierarchyAdSetsOf": {"en": "Ad sets in {name}", "fr": "Ensembles de {name}"},
"hierarchyAdsOf": {"en": "Ads in {name}", "fr": "Publicités de {name}"},
"hierarchyUngrouped": {"en": "Not linked to a parent in stored data", "fr": "Non rattaché à un parent dans les données enregistrées"},
"objectDailyLine": {"en": "{date} · {currency}{spend} · {impressions} impressions · {clicks} clicks", "fr": "{date} · {currency}{spend} · {impressions} impressions · {clicks} clics"},
"validation001": {"en":"The advertising action could not be completed. Check the connection and try again.","fr":"L’action publicitaire n’a pas pu aboutir. Vérifiez la connexion et réessayez."},
"validation002": {"en":"Choose valid Ads report filters.","fr":"Choisissez des filtres de rapport publicitaire valides."},
"validation003": {"en":"Choose valid Ads report filters. {value0} must be text with at most {value1} characters.","fr":"Choisissez des filtres valides. {value0} doit être un texte de {value1} caractères maximum."},
"validation004": {"en":"Choose a {value0} from {value1} to {value2}.","fr":"Choisissez {value0} entre {value1} et {value2}."},
"validation005": {"en":"Advertising changes are temporarily unavailable. Try again later.","fr":"Les modifications publicitaires sont temporairement indisponibles. Réessayez plus tard."},
"validation006": {"en":"Ads operations already registered for {value0}.","fr":"Les opérations publicitaires sont déjà enregistrées pour {value0}."},
"validation007": {"en":"Choose a valid ad change.","fr":"Choisissez une modification publicitaire valide."},
"validation008": {"en":"Enter a campaign name and objective.","fr":"Saisissez un nom de campagne et un objectif."},
"validation009": {"en":"Choose a valid campaign objective.","fr":"Choisissez un objectif de campagne valide."},
"validation010": {"en":"Enter an ad set name.","fr":"Saisissez un nom d’ensemble de publicités."},
"validation011": {"en":"Budgets must be positive whole minor currency units.","fr":"Les budgets doivent être des nombres entiers positifs en unités monétaires mineures."},
"validation012": {"en":"Choose a valid campaign.","fr":"Choisissez une campagne valide."},
"validation013": {"en":"Enter a two-letter country code.","fr":"Saisissez un code pays de deux lettres."},
"validation014": {"en":"Choose a valid optimization goal.","fr":"Choisissez un objectif d’optimisation valide."},
"validation015": {"en":"Enter valid creative details.","fr":"Saisissez des informations de visuel valides."},
"validation016": {"en":"Enter an HTTPS destination without credentials.","fr":"Saisissez une destination HTTPS sans identifiants."},
"validation017": {"en":"Image creatives do not have a destination.","fr":"Les visuels de type image n’ont pas de destination."},
"validation018": {"en":"Choose a selected channel.","fr":"Choisissez un canal sélectionné."},
"validation019": {"en":"Choose a stored image.","fr":"Choisissez une image enregistrée."},
"validation020": {"en":"Choose a supported creative operation.","fr":"Choisissez une opération de visuel prise en charge."},
"validation021": {"en":"Invalid ad object.","fr":"Objet publicitaire invalide."},
"validation022": {"en":"Invalid ad status.","fr":"État publicitaire invalide."},
"validation023": {"en":"Budgets must be positive whole minor currency units on a campaign or ad set.","fr":"Les budgets doivent être des nombres entiers positifs en unités monétaires mineures pour une campagne ou un ensemble."},
"validation024": {"en":"Enter a name.","fr":"Saisissez un nom."},
"validation025": {"en":"Choose an ad and a creative.","fr":"Choisissez une publicité et un visuel."},
"validation026": {"en":"This change is not available for the selected advertising account.","fr":"Cette modification n’est pas disponible pour le compte publicitaire sélectionné."},
"validation027": {"en":"Ad set creation is unavailable for limited page access.","fr":"La création d’ensembles de publicités est indisponible avec un accès limité aux canaux."},
"validation028": {"en":"Names must contain 1 to {value0} characters.","fr":"Les noms doivent contenir de 1 à {value0} caractères."},
"validation029": {"en":"This Ads request has already moved past pending.","fr":"Cette demande publicitaire n’est plus en attente."},
"validation030": {"en":"This request was reviewed and recorded as not applied. Create a new request only if you still want to make the change.","fr":"Cette demande a été vérifiée et enregistrée comme non appliquée. Créez une nouvelle demande uniquement si vous souhaitez toujours effectuer la modification."},
"validation031": {"en":"The advertising platform rejected this change. Nothing was changed. Review the details before submitting a new request.","fr":"La plateforme publicitaire a refusé cette modification. Aucun changement n’a eu lieu. Vérifiez les détails avant de soumettre une nouvelle demande."},
"validation032": {"en":"The result of this change is unknown. Do not repeat it. Check the object in the advertising platform, then record what you found in Ads change history.","fr":"Le résultat est inconnu. Ne répétez pas la modification. Vérifiez l’objet sur la plateforme publicitaire, puis enregistrez votre constat dans l’historique."},
"validation033": {"en":"This advertising request is still in progress or has not been resolved. Do not submit it again.","fr":"Cette demande publicitaire est encore en cours ou n’a pas été résolue. Ne la soumettez pas à nouveau."},
"validation034": {"en":"Ads comparison data is temporarily unavailable.","fr":"Les données de comparaison publicitaire sont temporairement indisponibles."},
"validation035": {"en":"Choose a valid export size limit.","fr":"Choisissez une limite de taille d’export valide."},
"validation036": {"en":"Advertising comparison exceeds the configured export size limit.","fr":"La comparaison publicitaire dépasse la limite de taille d’export autorisée."},
"validation037": {"en":"Cannot export an incomplete object report.","fr":"Impossible d’exporter un rapport d’objets incomplet."},
"validation038": {"en":"No spend was recorded in this period.","fr":"Aucune dépense enregistrée sur cette période."},
"validation039": {"en":"Cost per click fell {value0}% compared with the previous period.","fr":"Le coût par clic a diminué de {value0} % par rapport à la période précédente."},
"validation040": {"en":"Cost per click rose {value0}% compared with the previous period.","fr":"Le coût par clic a augmenté de {value0} % par rapport à la période précédente."},
"validation041": {"en":"Click-through rate rose {value0}% compared with the previous period.","fr":"Le taux de clic a augmenté de {value0} % par rapport à la période précédente."},
"validation042": {"en":"Click-through rate fell {value0}% compared with the previous period.","fr":"Le taux de clic a diminué de {value0} % par rapport à la période précédente."},
"validation043": {"en":"Clicks on {value0} cost {value1} times the account average.","fr":"Les clics sur {value0} coûtent {value1} fois la moyenne du compte."},
"validation044": {"en":"Choose one value for each filter.","fr":"Choisissez une valeur pour chaque filtre."},
"validation045": {"en":"Remove unknown Ads filters and try again.","fr":"Supprimez les filtres publicitaires inconnus et réessayez."},
"validation046": {"en":"Choose one value for each Ads filter.","fr":"Choisissez une valeur pour chaque filtre publicitaire."},
"validation047": {"en":"Keep each Ads filter to {value0} characters or fewer.","fr":"Limitez chaque filtre publicitaire à {value0} caractères."},
"validation048": {"en":"Choose a valid page number or reset the filters.","fr":"Choisissez un numéro de page valide ou réinitialisez les filtres."},
"validation049": {"en":"Choose a valid {value0}.","fr":"Choisissez une valeur valide pour {value0}."},
"validation050": {"en":"Compare at most {value0} accounts. Choose a single account or fewer accounts.","fr":"Comparez au maximum {value0} comptes. Choisissez un seul compte ou moins de comptes."},
"validation051": {"en":"Only workspace owners and admins can manage ads.","fr":"Seuls les propriétaires et administrateurs de l’espace peuvent gérer les publicités."},
"validation052": {"en":"Invalid ad object request.","fr":"Demande d’objet publicitaire invalide."},
"validation053": {"en":"Invalid ad set request.","fr":"Demande d’ensemble de publicités invalide."},
"validation054": {"en":"Use a safe CSV filename.","fr":"Utilisez un nom de fichier CSV valide."},
"validation055": {"en":"Ad account is unavailable in this workspace.","fr":"Le compte publicitaire est indisponible dans cet espace."},
"validation056": {"en":"Choose a date preset or custom dates, without combining them.","fr":"Choisissez une période prédéfinie ou des dates personnalisées sans les combiner."},
"validation057": {"en":"Too much report data for one request. Choose fewer accounts or a shorter date range. No results were loaded.","fr":"Trop de données pour une demande. Choisissez moins de comptes ou une période plus courte. Aucun résultat n’a été chargé."},
"validation058": {"en":"Advertising report exceeds the configured export size limit.","fr":"Le rapport publicitaire dépasse la limite de taille d’export autorisée."},
"validation059": {"en":"Advertising report data is temporarily unavailable.","fr":"Les données du rapport publicitaire sont temporairement indisponibles."},
"validation060": {"en":"Choose a valid advertising report export size limit.","fr":"Choisissez une limite de taille d’export de rapport publicitaire valide."},
"validation061": {"en":"Keep this filter to {value0} characters or fewer.","fr":"Limitez ce filtre à {value0} caractères."},
"validation062": {"en":"Choose one value for this filter.","fr":"Choisissez une valeur pour ce filtre."},
"validation063": {"en":"Choose an available date range.","fr":"Choisissez une période disponible."},
"validation064": {"en":"This account is unavailable. Choose an available account or All accounts.","fr":"Ce compte est indisponible. Choisissez un compte disponible ou Tous les comptes."},
"validation065": {"en":"Choose an available account or All accounts.","fr":"Choisissez un compte disponible ou Tous les comptes."},
"validation066": {"en":"Enter a valid start date.","fr":"Saisissez une date de début valide."},
"validation067": {"en":"Enter a valid end date.","fr":"Saisissez une date de fin valide."},
"validation068": {"en":"End date must be on or after start date.","fr":"La date de fin doit être égale ou postérieure à la date de début."},
"validation069": {"en":"Choose a date range of {value0} days or fewer.","fr":"Choisissez une période de {value0} jours maximum."},
"validation070": {"en":"Choose a valid report page.","fr":"Choisissez une page de rapport valide."},
"validation071": {"en":"Ads reports are temporarily unavailable.","fr":"Les rapports publicitaires sont temporairement indisponibles."},
"validation072": {"en":"The complete report exceeds the current result limit. Narrow the date range or account selection and try again.","fr":"Le rapport complet dépasse la limite actuelle de résultats. Réduisez la période ou la sélection de comptes et réessayez."},
"service001": {"en":"Sign in with an active account to view Ads reports.","fr":"Connectez-vous avec un compte actif pour consulter les rapports publicitaires."},
"service002": {"en":"Ads report access is unavailable in this workspace.","fr":"Les rapports publicitaires ne sont pas disponibles dans cet espace."},
"service003": {"en":"The selected advertising account is unavailable.","fr":"Le compte publicitaire sélectionné est indisponible."},
"service004": {"en":"Invalid ad object.","fr":"Objet publicitaire invalide."},
"service005": {"en":"Ads performance access is unavailable.","fr":"L’accès aux performances publicitaires est indisponible."},
"service006": {"en":"This advertising account is unavailable.","fr":"Ce compte publicitaire est indisponible."},
"service007": {"en":"This ad object cannot be verified for the selected account.","fr":"Cet objet publicitaire ne peut pas être vérifié pour le compte sélectionné."},
"service008": {"en":"Ads object reads are unavailable.","fr":"La consultation des objets publicitaires est indisponible."},
"service009": {"en":"Choose one valid ad change.","fr":"Choisissez une seule modification publicitaire valide."},
"service010": {"en":"Ad set creation is unavailable for limited page access.","fr":"La création d’ensembles de publicités est indisponible avec un accès limité aux canaux."},
"service011": {"en":"Choose an advertising account.","fr":"Choisissez un compte publicitaire."},
"service012": {"en":"Invalid ad account ID.","fr":"Identifiant de compte publicitaire invalide."},
"service013": {"en":"Choose one valid Ads report level.","fr":"Choisissez un niveau de rapport publicitaire valide."},
"service014": {"en":"Choose a valid Ads object id.","fr":"Choisissez un identifiant d’objet publicitaire valide."},
"service015": {"en":"An Ads object id requires one explicit account and report level.","fr":"Un identifiant d’objet nécessite un compte explicite et un niveau de rapport."},
"service016": {"en":"Choose a valid Ads export row limit.","fr":"Choisissez une limite de lignes valide pour l’export publicitaire."},
"service017": {"en":"This Ads export contains too many rows. Choose fewer accounts or a shorter date range. No partial file was created.","fr":"Cet export contient trop de lignes. Choisissez moins de comptes ou une période plus courte. Aucun fichier partiel n’a été créé."},
"service018": {"en":"Ads reports are temporarily unavailable. Try again later.","fr":"Les rapports publicitaires sont temporairement indisponibles. Réessayez plus tard."},
"service019": {"en":"Choose valid Ads filters.","fr":"Choisissez des filtres publicitaires valides."},
"service020": {"en":"Choose a valid account page.","fr":"Choisissez une page de comptes valide."},
"service021": {"en":"The advertising account directory exceeds its configured limit.","fr":"La liste des comptes publicitaires dépasse la limite autorisée."},
"service022": {"en":"Choose valid Ads report levels.","fr":"Choisissez des niveaux de rapport publicitaire valides."},
"service023": {"en":"Choose one account and report level for an Ads object filter.","fr":"Choisissez un compte et un niveau de rapport pour filtrer un objet publicitaire."},
"service024": {"en":"Reports are temporarily unavailable. Try again later.","fr":"Les rapports sont temporairement indisponibles. Réessayez plus tard."},
"service025": {"en":"Choose valid Ads report filters.","fr":"Choisissez des filtres de rapport publicitaire valides."},
"service026": {"en":"This Ads report is too large to return. Choose a shorter range, fewer results, or a lower result limit.","fr":"Ce rapport est trop volumineux. Choisissez une période plus courte ou moins de résultats."},
"service027": {"en":"Choose valid Ads management input.","fr":"Choisissez des paramètres de gestion publicitaire valides."},
"service028": {"en":"Choose a page size within the current result limit.","fr":"Choisissez une taille de page dans la limite actuelle de résultats."},
"service029": {"en":"Choose an advertising account and image.","fr":"Choisissez un compte publicitaire et une image."},
"service030": {"en":"The sources page exceeds the current result limit.","fr":"La page des sources dépasse la limite actuelle de résultats."},
"service031": {"en":"An advertising change still needs review. Check Ads change history and record its verified outcome before deleting related data.","fr":"Une modification publicitaire doit encore être vérifiée. Consultez l’historique et enregistrez son résultat vérifié avant de supprimer les données associées."},
"service032": {"en":"Ads management is temporarily unavailable. Try again later.","fr":"La gestion publicitaire est temporairement indisponible. Réessayez plus tard."},
"service033": {"en":"Sign in with an active account to manage ads.","fr":"Connectez-vous avec un compte actif pour gérer les publicités."},
"service034": {"en":"You are no longer a member of this workspace.","fr":"Vous n’êtes plus membre de cet espace."},
"service035": {"en":"Only workspace owners and admins can manage ads.","fr":"Seuls les propriétaires et administrateurs de l’espace peuvent gérer les publicités."},
"service036": {"en":"Ads management is not available for this workspace.","fr":"La gestion publicitaire n’est pas disponible dans cet espace."},
"service037": {"en":"This advertising account or its connection is unavailable. Reconnect it before managing ads.","fr":"Ce compte publicitaire ou sa connexion est indisponible. Reconnectez-le avant de gérer les publicités."},
"service038": {"en":"Advertising changes are currently unavailable.","fr":"Les modifications publicitaires sont actuellement indisponibles."},
"service039": {"en":"Ads management is currently unavailable.","fr":"La gestion publicitaire est actuellement indisponible."},
"service040": {"en":"Reconnect this advertising connection to continue.","fr":"Reconnectez cette connexion publicitaire pour continuer."},
"service041": {"en":"This advertising connection is unavailable. Reconnect it before managing ads.","fr":"Cette connexion publicitaire est indisponible. Reconnectez-la avant de gérer les publicités."},
"service042": {"en":"This campaign cannot be verified for the selected account.","fr":"Cette campagne ne peut pas être vérifiée pour le compte sélectionné."},
"service043": {"en":"This channel is outside your current access.","fr":"Ce canal ne fait pas partie de vos droits actuels."},
"service044": {"en":"Choose a selected channel connected to this advertising account.","fr":"Choisissez un canal sélectionné connecté à ce compte publicitaire."},
"service045": {"en":"This stored image is unavailable in this workspace. Choose another image.","fr":"Cette image enregistrée est indisponible dans cet espace. Choisissez une autre image."},
"service046": {"en":"Creative creation is unavailable for this account.","fr":"La création de visuels est indisponible pour ce compte."},
"service047": {"en":"Choose a valid sources page size.","fr":"Choisissez une taille de page de sources valide."},
"service048": {"en":"Choose a valid sources page.","fr":"Choisissez une page de sources valide."},
"service049": {"en":"This budget is above the limit allowed for a single change.","fr":"Ce budget dépasse la limite autorisée pour une modification."},
"service050": {"en":"This request key was already used for a different advertising change.","fr":"Cet identifiant de demande a déjà été utilisé pour une autre modification publicitaire."},
"service051": {"en":"Provide a request ID containing 8 to 128 letters, numbers, dots, underscores, colons or hyphens.","fr":"Fournissez un identifiant de demande de 8 à 128 lettres, chiffres, points, traits de soulignement, deux-points ou tirets."},
"service052": {"en":"This advertising account is no longer selected. Select it again before managing ads.","fr":"Ce compte publicitaire n’est plus sélectionné. Sélectionnez-le à nouveau pour gérer les publicités."},
"service053": {"en":"An earlier change to this object has no confirmed outcome. Check it in Ads change history and resolve it before making another change.","fr":"Une modification précédente de cet objet n’a pas de résultat confirmé. Consultez et résolvez-la dans l’historique avant toute nouvelle modification."},
"service054": {"en":"Ads management is temporarily unavailable. Check Ads change history before submitting a new request.","fr":"La gestion publicitaire est temporairement indisponible. Consultez l’historique avant de soumettre une nouvelle demande."},
"service055": {"en":"The advertising account changed while preparing this request. Review it and try again.","fr":"Le compte publicitaire a changé pendant la préparation. Vérifiez-le et réessayez."},
"service056": {"en":"The advertising change confirmation is no longer current. Review it and try again.","fr":"La confirmation de la modification n’est plus à jour. Vérifiez-la et réessayez."},
"service057": {"en":"Current advertising access could not be verified. Review access and try again.","fr":"Vos droits publicitaires actuels n’ont pas pu être vérifiés. Vérifiez vos accès et réessayez."},
"service058": {"en":"The advertising platform rejected this change. Nothing was changed. Review the details and try again.","fr":"La plateforme publicitaire a refusé cette modification. Aucun changement n’a eu lieu. Vérifiez les détails et réessayez."},
"service059": {"en":"The result of this change is unknown. Do not repeat it. Check the object in the advertising platform, then record what you found in Ads change history.","fr":"Le résultat est inconnu. Ne répétez pas la modification. Vérifiez l’objet sur la plateforme publicitaire, puis enregistrez votre constat dans l’historique."},
"service060": {"en":"The change was applied but its record could not be completed. Do not repeat it; the object stays on hold in Ads change history until the outcome is reviewed.","fr":"La modification a été appliquée mais son enregistrement n’a pas pu aboutir. Ne la répétez pas ; l’objet reste suspendu dans l’historique jusqu’à sa vérification."},
"service061": {"en":"Choose a valid status.","fr":"Choisissez un état valide."},
"service062": {"en":"Choose a valid page.","fr":"Choisissez une page valide."},
"service063": {"en":"Choose a valid change and outcome.","fr":"Choisissez une modification et un résultat valides."},
"service064": {"en":"Keep the note to {max} printable characters.","fr":"Limitez la note à {max} caractères imprimables."},
"service065": {"en":"This change was not found.","fr":"Cette modification est introuvable."},
"service066": {"en":"This change does not need resolving.","fr":"Cette modification ne nécessite pas de résolution."},
"service067": {"en":"This resolution could not be saved. Try again.","fr":"Cette résolution n’a pas pu être enregistrée. Réessayez."},
"service068": {"en":"This change was already resolved.","fr":"Cette modification a déjà été résolue."},
"service069": {"en":"Creative browsing is not available for the selected advertising account.","fr":"La consultation des visuels est indisponible pour le compte publicitaire sélectionné."},
"service070": {"en":"Creatives could not be loaded right now. Try again later.","fr":"Les visuels ne peuvent pas être chargés actuellement. Réessayez plus tard."},
"service071": {"en":"Unknown Ads analysis tool.","fr":"Outil d’analyse publicitaire inconnu."},
"service072": {"en":"Choose json or csv.","fr":"Choisissez json ou csv."},
"service073": {"en":"This export exceeds the result limit of this credential.","fr":"Cet export dépasse la limite de résultats de votre accès."},
"service074": {"en":"Export options require csv format.","fr":"Les options d’export nécessitent le format csv."},
"service075": {"en":"Ads comparison is temporarily unavailable. Try again later.","fr":"La comparaison publicitaire est temporairement indisponible. Réessayez plus tard."},
"service076": {"en":"Choose valid Ads comparison filters.","fr":"Choisissez des filtres de comparaison publicitaire valides."},
"service077": {"en":"Choose to compare with the previous period or across accounts.","fr":"Choisissez de comparer avec la période précédente ou entre comptes."},
"service078": {"en":"Choose campaigns, ad sets or ads.","fr":"Choisissez les campagnes, ensembles ou publicités."},
"service079": {"en":"Choose a valid sort column.","fr":"Choisissez une colonne de tri valide."},
"service080": {"en":"Choose ascending or descending order.","fr":"Choisissez un ordre croissant ou décroissant."},
"service081": {"en":"Totals are recomputed from stored daily flows; ratios are not averaged.","fr":"Les totaux sont recalculés à partir des données quotidiennes ; les ratios ne sont pas moyennés."},
"service082": {"en":"Amounts in different currencies are never combined.","fr":"Les montants de devises différentes ne sont jamais combinés."},
"service083": {"en":"Reach is not additive and is not totalled; object rows show the highest single day.","fr":"La portée n’est pas additive et n’est pas totalisée ; les lignes affichent la meilleure journée."},
"service084": {"en":"Choose objects or findings.","fr":"Choisissez les objets ou les constats."},
"service085": {"en":"Choose en or fr.","fr":"Choisissez en ou fr."},
"service086": {"en":"Too many objects to export completely. Choose fewer accounts or a shorter date range.","fr":"Trop d’objets pour un export complet. Choisissez moins de comptes ou une période plus courte."},
"service087": {"en":"The page size exceeds the current result limit.","fr":"La taille de page dépasse la limite actuelle de résultats."},
"service088": {"en":"Unknown Ads directory tool.","fr":"Outil de liste publicitaire inconnu."},
"service089": {"en":"Choose valid Ads directory filters.","fr":"Choisissez des filtres de liste publicitaire valides."},
"service090": {"en":"Choose a valid parent object.","fr":"Choisissez un objet parent valide."},
"service091": {"en":"Figures come from stored daily reports. Levels overlap, so campaign, ad set and ad figures must not be added together.","fr":"Les chiffres proviennent des rapports quotidiens enregistrés. Les niveaux se chevauchent : les chiffres des campagnes, ensembles et publicités ne doivent pas être additionnés."},
"service092": {"en":"Choose a valid ad object.","fr":"Choisissez un objet publicitaire valide."},
"service093": {"en":"Choose an account, a level and an object.","fr":"Choisissez un compte, un niveau et un objet."},
"service094": {"en":"No stored report rows were found for this object in the selected range.","fr":"Aucune donnée enregistrée pour cet objet sur la période sélectionnée."},
"heldCreation": {"en":"The result is unknown. The same request can be checked again safely; it will not create a second object.","fr":"Le résultat est inconnu. Vous pouvez vérifier à nouveau la même demande sans créer un second objet."},
"refusedHeld": {"en":"This request was sent before and its result is not known, so it stays held until a recorded result is available.","fr":"Cette demande a déjà été envoyée et son résultat est inconnu. Elle reste suspendue jusqu’à l’enregistrement du résultat."},
"attestedCreation": {"en":"This request was reviewed and recorded as applied. Check the advertising platform for the object identity and its current delivery status.","fr":"Cette demande a été vérifiée et enregistrée comme appliquée. Consultez la plateforme publicitaire pour identifier l’objet et son état de diffusion actuel."},
"identityUnknown": {"en":"The created object identity was not confirmed. Check change history before making another request.","fr":"L’identité de l’objet créé n’a pas été confirmée. Consultez l’historique avant de créer une nouvelle demande."},
"restoredHeld": {"en":"A creation request from before this page reloaded has no confirmed result. Check the same request again; it cannot create a second object.","fr":"Une demande de création antérieure au rechargement de cette page reste sans résultat confirmé. Vérifiez à nouveau cette même demande ; elle ne peut pas créer de second objet."},
"networkHeld": {"en":"The result could not be confirmed. Checking again uses the same request ID, so it cannot create a second object.","fr":"Le résultat n’a pas pu être confirmé. Une nouvelle vérification utilise le même identifiant et ne peut pas créer de second objet."},
"networkChangeHeld": {"en":"The result could not be confirmed. Retry uses the same request ID, so it cannot create a second change.","fr":"Le résultat n’a pas pu être confirmé. Réessayer utilise le même identifiant et ne peut pas créer de seconde modification."},
"dailyBudgetDetail": {"en":" with a daily budget of {amount}","fr":" avec un budget quotidien de {amount}"},
"currencyDetail": {"en":" in {currency}","fr":" en {currency}"},
"currencyUnavailableAmount": {"en":"{amount} (currency unavailable)","fr":"{amount} (devise indisponible)"},
"accounts": {"en":"accounts","fr":"comptes"},
"objects": {"en":"objects","fr":"objets"},
"object": {"en":"Object","fr":"Objet"},
"dailyRows": {"en":"daily rows","fr":"lignes quotidiennes"},
"pagesLabel": {"en":"{kind} report pages","fr":"Pages du rapport : {kind}"},
"pending": {"en":"In progress (on hold)","fr":"En cours (suspendue)"},
"succeeded": {"en":"Applied","fr":"Appliquée"},
"rejected": {"en":"Not applied","fr":"Non appliquée"},
"uncertain": {"en":"Unknown result","fr":"Résultat inconnu"},
"resolved_applied": {"en":"Confirmed applied","fr":"Application confirmée"},
"resolved_not_applied": {"en":"Confirmed not applied","fr":"Non-application confirmée"},
"statusChange": {"en":"Pause or resume","fr":"Mettre en pause ou reprendre"},
"budgetChange": {"en":"Budget change","fr":"Modification du budget"},
"rename": {"en":"Rename","fr":"Renommer"},
"creativeChange": {"en":"Creative change","fr":"Modification du visuel"},
"delete": {"en":"Delete","fr":"Supprimer"},
"newCampaign": {"en":"New campaign","fr":"Nouvelle campagne"},
"newAdSet": {"en":"New ad set","fr":"Nouvel ensemble de publicités"},
"newCreative": {"en":"New unattached creative","fr":"Nouveau visuel sans affectation"},
"campaign": {"en":"campaign","fr":"campagne"},
"adset": {"en":"ad set","fr":"ensemble de publicités"},
"ad": {"en":"ad","fr":"publicité"},
"value": {"en":"Value","fr":"Valeur"},
"yes": {"en":"Yes","fr":"Oui"},
"no": {"en":"No","fr":"Non"},
"dailyActions": {"en":"Daily actions","fr":"Actions quotidiennes"},
"additionalMeasures": {"en":"Additional measures","fr":"Mesures supplémentaires"},
"inParent": {"en":" · in {parent}","fr":" · dans {parent}"},
"customRangeHelp": {"en":"Choose Custom dates to edit this range. Custom ranges can include up to {days} days.","fr":"Choisissez Dates personnalisées pour modifier cette période. Les périodes personnalisées peuvent contenir jusqu’à {days} jours."},
"customRangeLimit": {"en":"Custom ranges can include up to {days} days.","fr":"Les périodes personnalisées peuvent contenir jusqu’à {days} jours."},
"dailyRowCount": {"en":"{count} daily row{suffix}","fr":"{count} ligne(s) quotidienne(s)"},
"pagerSummary": {"en":"Showing {from}–{to} of {total} {kind}","fr":"Affichage de {from}–{to} sur {total} {kind}"},
"manageTabsLabel": {"en": "Manage advertising objects", "fr": "Gérer les objets publicitaires"},
"manageTabCreatives": {"en": "Creatives", "fr": "Visuels"},
"manageMoreTabs": {"en": "More", "fr": "Plus"},
"manageStatus": {"en": "Status", "fr": "État"},
"manageSynced": {"en": "Updated", "fr": "Mis à jour"},
"manageNoCampaigns": {"en": "No campaigns are stored for this account yet. Create a campaign first.", "fr": "Aucune campagne enregistrée pour ce compte pour l’instant. Créez d’abord une campagne."},
"manageNoAdSets": {"en": "No ad sets are stored for this account yet. Create an ad set first.", "fr": "Aucun ensemble enregistré pour ce compte pour l’instant. Créez d’abord un ensemble de publicités."},
"manageCreateAdSetNote": {"en": "Choose a stored campaign, then create a paused ad set under it.", "fr": "Choisissez une campagne enregistrée, puis créez un ensemble en pause."},
"manageCreativesList": {"en": "Account creatives", "fr": "Visuels du compte"},
"manageCreativesEmpty": {"en": "No creatives were returned for this account.", "fr": "Aucun visuel retourné pour ce compte."},
"manageCreativesReadOnly": {"en": "Creatives can be listed and created here. Renaming, pausing or deleting a creative is not available.", "fr": "Les visuels peuvent être listés et créés ici. Renommer, suspendre ou supprimer un visuel n’est pas disponible."},
"manageCreativePreview": {"en": "Preview", "fr": "Aperçu"},
  "text001": {
    "en": "Ad accounts",
    "fr": "Comptes publicitaires"
  },
  "text002": {
    "en": "Connect the advertising accounts you want to manage.",
    "fr": "Connectez les comptes publicitaires que vous souhaitez gérer."
  },
  "text003": {
    "en": "No ad accounts connected",
    "fr": "Aucun compte publicitaire connecté"
  },
  "text004": {
    "en": "View connections",
    "fr": "Voir les connexions"
  },
  "text005": {
    "en": "Connect and select an advertising account to see delivery and manage campaigns here.",
    "fr": "Connectez et sélectionnez un compte publicitaire pour consulter sa diffusion et gérer ses campagnes ici."
  },
  "text006": {
    "en": "Advertising account totals",
    "fr": "Totaux des comptes publicitaires"
  },
  "text007": {
    "en": "Linked accounts",
    "fr": "Comptes associés"
  },
  "text008": {
    "en": "Enabled accounts",
    "fr": "Comptes activés"
  },
  "text009": {
    "en": "Accounts with sync time",
    "fr": "Comptes avec une date de synchronisation"
  },
  "text010": {
    "en": "Campaigns with data",
    "fr": "Campagnes avec des données"
  },
  "text011": {
    "en": "Account performance",
    "fr": "Performance du compte"
  },
  "text012": {
    "en": "Daily spend, impressions, and clicks are summed. Reach, frequency, and CPP use the latest daily row.",
    "fr": "Les dépenses, impressions et clics quotidiens sont additionnés. La portée, la fréquence et le CPP utilisent la dernière journée."
  },
  "text013": {
    "en": "Campaign, ad set, and ad details →",
    "fr": "Détails des campagnes, ensembles et publicités →"
  },
  "text014": {
    "en": "Enabled",
    "fr": "Activé"
  },
  "text015": {
    "en": "Disabled",
    "fr": "Désactivé"
  },
  "text016": {
    "en": "· Platform status:",
    "fr": "· État sur la plateforme :"
  },
  "text017": {
    "en": "not provided",
    "fr": "non fourni"
  },
  "text018": {
    "en": "No sync recorded",
    "fr": "Aucune synchronisation enregistrée"
  },
  "text019": {
    "en": "Spend",
    "fr": "Dépenses"
  },
  "text020": {
    "en": "Impressions",
    "fr": "Impressions"
  },
  "text021": {
    "en": "Reach · latest day",
    "fr": "Portée · dernière journée"
  },
  "text022": {
    "en": "Clicks",
    "fr": "Clics"
  },
  "text023": {
    "en": "CPC",
    "fr": "CPC"
  },
  "text024": {
    "en": "CPM",
    "fr": "CPM"
  },
  "text025": {
    "en": "CTR",
    "fr": "Taux de clic"
  },
  "text026": {
    "en": "CPP · latest day",
    "fr": "CPP · dernière journée"
  },
  "text027": {
    "en": "Frequency · latest day",
    "fr": "Fréquence · dernière journée"
  },
  "text028": {
    "en": "Action and daily results",
    "fr": "Actions et résultats quotidiens"
  },
  "text029": {
    "en": "Action metrics · summed across daily rows",
    "fr": "Mesures d’actions · total des journées"
  },
  "text030": {
    "en": "No action breakdown stored.",
    "fr": "Aucune répartition des actions enregistrée."
  },
  "text031": {
    "en": "Daily measures",
    "fr": "Mesures quotidiennes"
  },
  "text032": {
    "en": "No account-level delivery rows in this date range.",
    "fr": "Aucune donnée de diffusion du compte sur cette période."
  },
  "text033": {
    "en": "No ad accounts match these filters",
    "fr": "Aucun compte ne correspond à ces filtres"
  },
  "text034": {
    "en": "Choose another account in the sidebar.",
    "fr": "Choisissez un autre compte dans la barre latérale."
  },
  "text035": {
    "en": "Stored campaign, ad set, and ad rows",
    "fr": "Données des campagnes, ensembles et publicités"
  },
  "text036": {
    "en": "These are stored insight records in the selected period. Metrics across account currencies are not combined.",
    "fr": "Ces données couvrent la période sélectionnée. Les mesures de comptes de devises différentes ne sont pas combinées."
  },
  "text037": {
    "en": "with stored data",
    "fr": "avec des données enregistrées"
  },
  "text038": {
    "en": "View performance →",
    "fr": "Voir les performances →"
  },
  "text039": {
    "en": "No campaign, ad set, or ad insight rows are stored in this date range.",
    "fr": "Aucune donnée de campagne, ensemble ou publicité enregistrée sur cette période."
  },
  "text040": {
    "en": "Open campaign, ad set, and ad details to review performance. Management controls appear when available for your connected accounts.",
    "fr": "Ouvrez les détails des campagnes, ensembles et publicités pour consulter leurs performances. Les commandes de gestion apparaissent lorsque vos comptes connectés les permettent."
  },
  "text041": {
    "en": "Campaign, ad set, and ad results",
    "fr": "Résultats des campagnes, ensembles et publicités"
  },
  "text042": {
    "en": "Connect an advertising account to review and manage its campaigns.",
    "fr": "Connectez un compte publicitaire pour consulter et gérer ses campagnes."
  },
  "text043": {
    "en": "Connect and select an advertising account to see campaign results and available actions here.",
    "fr": "Connectez et sélectionnez un compte publicitaire pour consulter les résultats et actions disponibles ici."
  },
  "text044": {
    "en": "Ad account",
    "fr": "Compte publicitaire"
  },
  "text045": {
    "en": "objects",
    "fr": "objets"
  },
  "text046": {
    "en": "daily row",
    "fr": "ligne quotidienne"
  },
  "text047": {
    "en": "Create ad sets",
    "fr": "Créer des ensembles de publicités"
  },
  "text048": {
    "en": "Choose a campaign already verified in this account’s stored performance history.",
    "fr": "Choisissez une campagne déjà vérifiée dans l’historique des performances de ce compte."
  },
  "text049": {
    "en": "No campaign, ad set, or ad insights stored",
    "fr": "Aucune donnée de campagne, ensemble ou publicité enregistrée"
  },
  "text050": {
    "en": "Return to ad accounts →",
    "fr": "Retour aux comptes publicitaires →"
  },
  "text051": {
    "en": "When insight rows are captured for the selected ad accounts and dates, each level will appear here with its saved metrics.",
    "fr": "Les mesures enregistrées apparaîtront ici pour chaque niveau dès que des données seront disponibles pour les comptes et dates sélectionnés."
  },
  "text052": {
    "en": "Create a campaign",
    "fr": "Créer une campagne"
  },
  "text053": {
    "en": "Each campaign is created paused under one enabled ad account.",
    "fr": "Chaque campagne est créée en pause dans un compte publicitaire activé."
  },
  "text054": {
    "en": "Review delivery and adjust eligible campaigns, ad sets, and ads. Changes require confirmation before they are sent.",
    "fr": "Consultez la diffusion et ajustez les campagnes, ensembles et publicités éligibles. Les modifications nécessitent une confirmation avant envoi."
  },
  "text055": {
    "en": "Object options",
    "fr": "Options des objets"
  },
  "text056": {
    "en": "Show",
    "fr": "Afficher"
  },
  "text057": {
    "en": "Campaigns",
    "fr": "Campagnes"
  },
  "text058": {
    "en": "Ad sets",
    "fr": "Ensembles de publicités"
  },
  "text059": {
    "en": "Ads",
    "fr": "Publicités"
  },
  "text060": {
    "en": "Search",
    "fr": "Rechercher"
  },
  "text061": {
    "en": "Parent ID",
    "fr": "Identifiant du parent"
  },
  "text062": {
    "en": "Sort by",
    "fr": "Trier par"
  },
  "text063": {
    "en": "Click-through rate",
    "fr": "Taux de clic"
  },
  "text064": {
    "en": "Cost per click",
    "fr": "Coût par clic"
  },
  "text065": {
    "en": "Cost per 1,000 views",
    "fr": "Coût pour 1 000 vues"
  },
  "text066": {
    "en": "Name",
    "fr": "Nom"
  },
  "text067": {
    "en": "Order",
    "fr": "Ordre"
  },
  "text068": {
    "en": "Highest first",
    "fr": "Du plus élevé"
  },
  "text069": {
    "en": "Lowest first",
    "fr": "Du plus faible"
  },
  "text070": {
    "en": "Apply",
    "fr": "Appliquer"
  },
  "text071": {
    "en": "result(s) ·",
    "fr": "résultat(s) ·"
  },
  "text072": {
    "en": "to",
    "fr": "au"
  },
  "text073": {
    "en": "Stored figures may be out of date.",
    "fr": "Les chiffres enregistrés peuvent être obsolètes."
  },
  "text074": {
    "en": "Ad objects",
    "fr": "Objets publicitaires"
  },
  "text075": {
    "en": "No matching objects. Adjust the filters or search.",
    "fr": "Aucun objet correspondant. Modifiez les filtres ou la recherche."
  },
  "text076": {
    "en": "Pages",
    "fr": "Pages"
  },
  "text077": {
    "en": "Previous",
    "fr": "Précédent"
  },
  "text078": {
    "en": "Next",
    "fr": "Suivant"
  },
  "text079": {
    "en": "Change history",
    "fr": "Historique des modifications"
  },
  "text080": {
    "en": "Filters",
    "fr": "Filtres"
  },
  "text081": {
    "en": "Date range",
    "fr": "Période"
  },
  "text082": {
    "en": "Unavailable date range",
    "fr": "Période indisponible"
  },
  "text083": {
    "en": "Custom dates",
    "fr": "Dates personnalisées"
  },
  "text084": {
    "en": "Choose Custom dates to edit this range. Custom ranges can include up to",
    "fr": "Choisissez Dates personnalisées pour modifier cette période. Les périodes personnalisées peuvent contenir jusqu’à"
  },
  "text085": {
    "en": "days.",
    "fr": "jours."
  },
  "text086": {
    "en": "Custom ranges can include up to",
    "fr": "Les périodes personnalisées peuvent contenir jusqu’à"
  },
  "text087": {
    "en": "Unavailable account",
    "fr": "Compte indisponible"
  },
  "text088": {
    "en": "All accounts",
    "fr": "Tous les comptes"
  },
  "text089": {
    "en": "Apply filters",
    "fr": "Appliquer les filtres"
  },
  "text090": {
    "en": "Reset filters",
    "fr": "Réinitialiser les filtres"
  },
  "text091": {
    "en": "Close",
    "fr": "Fermer"
  },
  "text092": {
    "en": "Details",
    "fr": "Détails"
  },
  "text093": {
    "en": "Loading details…",
    "fr": "Chargement des détails…"
  },
  "text094": {
    "en": "Unknown",
    "fr": "Inconnu"
  },
  "text095": {
    "en": "Daily figures",
    "fr": "Chiffres quotidiens"
  },
  "text096": {
    "en": "impressions ·",
    "fr": "impressions ·"
  },
  "text097": {
    "en": "clicks",
    "fr": "clics"
  },
  "text098": {
    "en": "Current status could not be checked. Showing stored reports only.",
    "fr": "L’état actuel n’a pas pu être vérifié. Seuls les rapports enregistrés sont affichés."
  },
  "text099": {
    "en": "You can view this",
    "fr": "Vous pouvez consulter cet objet :"
  },
  "text100": {
    "en": ". Changes are not available for your access or this account.",
    "fr": ". Les modifications ne sont pas disponibles pour vos droits ou ce compte."
  },
  "text101": {
    "en": "Changes are paused for this object until its open change is reviewed.",
    "fr": "Les modifications de cet objet sont suspendues jusqu’à la vérification de sa demande en cours."
  },
  "text102": {
    "en": "Open change history",
    "fr": "Ouvrir l’historique des modifications"
  },
  "text103": {
    "en": ", then close and reopen Details to check again.",
    "fr": ", puis fermez et rouvrez les détails pour vérifier à nouveau."
  },
  "text104": {
    "en": "Budget period",
    "fr": "Période du budget"
  },
  "text105": {
    "en": "Daily",
    "fr": "Quotidien"
  },
  "text106": {
    "en": "Lifetime",
    "fr": "Total"
  },
  "text107": {
    "en": "New budget",
    "fr": "Nouveau budget"
  },
  "text108": {
    "en": "Amount",
    "fr": "Montant"
  },
  "text109": {
    "en": "Maximum per change:",
    "fr": "Maximum par modification :"
  },
  "text110": {
    "en": "New name",
    "fr": "Nouveau nom"
  },
  "text111": {
    "en": "Choose a creative",
    "fr": "Choisir un visuel"
  },
  "text112": {
    "en": "No creatives are available in this account.",
    "fr": "Aucun visuel disponible dans ce compte."
  },
  "text113": {
    "en": "Creative",
    "fr": "Visuel"
  },
  "text114": {
    "en": "Replace this ad’s creative with the one you chose.",
    "fr": "Remplacez le visuel de cette publicité par celui que vous avez choisi."
  },
  "text115": {
    "en": "Change result needs review",
    "fr": "Le résultat de la modification doit être vérifié"
  },
  "text116": {
    "en": "The change result could not be confirmed. Its request ID is retained.",
    "fr": "Le résultat n’a pas pu être confirmé. L’identifiant de la demande est conservé."
  },
  "text117": {
    "en": "Retry checks the same request ID and does not start a second change. Review the platform and change history before trying again.",
    "fr": "Réessayer vérifie la même demande sans créer une seconde modification. Consultez la plateforme et l’historique avant de réessayer."
  },
  "text118": {
    "en": "Checking…",
    "fr": "Vérification…"
  },
  "text119": {
    "en": "Confirm this change",
    "fr": "Confirmer cette modification"
  },
  "text120": {
    "en": "This change can affect what you spend.",
    "fr": "Cette modification peut affecter vos dépenses."
  },
  "text121": {
    "en": "This action cannot be undone.",
    "fr": "Cette action est irréversible."
  },
  "text122": {
    "en": "This object already has a change in progress. This action cannot be confirmed until that change is reviewed.",
    "fr": "Cet objet a déjà une modification en cours. Cette action ne peut être confirmée avant sa vérification."
  },
  "text123": {
    "en": "The current change history could not be checked, so this action is paused. Check Ads change history before trying again.",
    "fr": "L’historique actuel n’a pas pu être vérifié ; cette action est suspendue. Consultez l’historique avant de réessayer."
  },
  "text124": {
    "en": "If the result is uncertain, this same request ID is retained for retry and the change stays on hold until it is reviewed.",
    "fr": "Si le résultat est incertain, le même identifiant est conservé et la modification reste suspendue jusqu’à sa vérification."
  },
  "text125": {
    "en": "Cancel",
    "fr": "Annuler"
  },
  "text126": {
    "en": "Applying…",
    "fr": "Application…"
  },
  "text127": {
    "en": "Refreshing…",
    "fr": "Actualisation…"
  },
  "text128": {
    "en": "No changes have been made through this workspace yet.",
    "fr": "Aucune modification n’a encore été effectuée dans cet espace."
  },
  "text129": {
    "en": "This change may still be in progress. It stays on hold until the result is recorded. Do not repeat it. The service will not allow a review while its request is still in flight.",
    "fr": "Cette modification peut encore être en cours. Elle reste suspendue jusqu’à l’enregistrement du résultat. Ne la répétez pas. Une vérification ne peut être enregistrée pendant l’envoi."
  },
  "text130": {
    "en": "This request is still recorded as in progress. Check the object in your advertising platform first; the service checks for an active dispatch before it records your finding. This only updates workspace history; it never sends or repeats the change.",
    "fr": "Cette demande est encore enregistrée comme en cours. Vérifiez d’abord l’objet sur votre plateforme publicitaire. Cette action met uniquement l’historique à jour et ne répète jamais la modification."
  },
  "text131": {
    "en": "The result is unknown. Check the object in your advertising platform first. Recording your finding changes only this workspace’s history; it never sends or repeats the change.",
    "fr": "Le résultat est inconnu. Vérifiez d’abord l’objet sur votre plateforme publicitaire. Enregistrer votre constat modifie uniquement l’historique de cet espace et ne répète jamais la modification."
  },
  "text132": {
    "en": "I checked: it was applied",
    "fr": "J’ai vérifié : appliquée"
  },
  "text133": {
    "en": "I checked: it was not applied",
    "fr": "J’ai vérifié : non appliquée"
  },
  "text134": {
    "en": "A partial creation may leave an uploaded image. Review the objects in the platform before recording an outcome.",
    "fr": "Une création partielle peut laisser une image chargée. Vérifiez les objets sur la plateforme avant d’enregistrer le résultat."
  },
  "text135": {
    "en": "Review note:",
    "fr": "Note de vérification :"
  },
  "text136": {
    "en": "Record your review",
    "fr": "Enregistrer votre vérification"
  },
  "text137": {
    "en": "Mark this change as applied.",
    "fr": "Marquer cette modification comme appliquée."
  },
  "text138": {
    "en": "Mark this change as not applied.",
    "fr": "Marquer cette modification comme non appliquée."
  },
  "text139": {
    "en": "Check the object in your advertising platform before continuing.",
    "fr": "Vérifiez l’objet sur votre plateforme publicitaire avant de continuer."
  },
  "text140": {
    "en": "This only records your finding in workspace history; it will not contact the platform or send the change again. The service checks for an active dispatch before saving a pending recovery.",
    "fr": "Cette action enregistre uniquement votre constat dans l’historique. Elle ne contacte pas la plateforme et ne répète pas la modification. L’absence d’envoi actif est vérifiée avant l’enregistrement."
  },
  "text141": {
    "en": "Review note (optional)",
    "fr": "Note de vérification (facultative)"
  },
  "text142": {
    "en": "Recording…",
    "fr": "Enregistrement…"
  },
  "text143": {
    "en": "Account performance charts",
    "fr": "Graphiques de performance du compte"
  },
  "text144": {
    "en": "Currency unavailable",
    "fr": "Devise indisponible"
  },
  "text145": {
    "en": "Results",
    "fr": "Résultats"
  },
  "text146": {
    "en": "No comparable results measure is available.",
    "fr": "Aucune mesure de résultats comparable n’est disponible."
  },
  "text147": {
    "en": "Impressions to clicks",
    "fr": "Des impressions aux clics"
  },
  "text148": {
    "en": "Results are unavailable as a comparable measure. Individual action types remain in the details below.",
    "fr": "Les résultats ne sont pas disponibles sous forme de mesure comparable. Chaque type d’action reste visible dans les détails ci-dessous."
  },
  "text149": {
    "en": "Campaign performance for {value0}",
    "fr": "Performance des campagnes pour {value0}"
  },
  "text150": {
    "en": "No impressions stored.",
    "fr": "Aucune impression enregistrée."
  },
  "text151": {
    "en": "Spend per campaign",
    "fr": "Dépenses par campagne"
  },
  "text152": {
    "en": "Daily spend per campaign, {value0}",
    "fr": "Dépenses quotidiennes par campagne, {value0}"
  },
  "text153": {
    "en": "From views to results",
    "fr": "Des vues aux résultats"
  },
  "text154": {
    "en": "Impressions to clicks, {value0}",
    "fr": "Des impressions aux clics, {value0}"
  },
  "text155": {
    "en": "Results differ by objective, so they are not added together. Each action type stays in the stored details.",
    "fr": "Les résultats dépendent de l’objectif et ne sont donc pas additionnés. Chaque type d’action reste dans les détails enregistrés."
  },
  "text156": {
    "en": "Campaign",
    "fr": "Campagne"
  },
  "text157": {
    "en": "Ad set",
    "fr": "Ensemble de publicités"
  },
  "text158": {
    "en": "Ad",
    "fr": "Publicité"
  },
  "text159": {
    "en": "ID copied",
    "fr": "Identifiant copié"
  },
  "text160": {
    "en": "The ID could not be copied. Select it in the table instead.",
    "fr": "L’identifiant n’a pas pu être copié. Sélectionnez-le dans le tableau."
  },
  "text161": {
    "en": "Try again",
    "fr": "Réessayer"
  },
  "text162": {
    "en": "No stored delivery for these objects.",
    "fr": "Aucune diffusion enregistrée pour ces objets."
  },
  "text163": {
    "en": "Actions for {value0}",
    "fr": "Actions pour {value0}"
  },
  "text164": {
    "en": "Copy ID",
    "fr": "Copier l’identifiant"
  },
  "text165": {
    "en": "Open in objects list",
    "fr": "Ouvrir dans la liste des objets"
  },
  "text166": {
    "en": "·",
    "fr": "·"
  },
  "text167": {
    "en": "Stored delivery",
    "fr": "Diffusion enregistrée"
  },
  "text168": {
    "en": "Delivered",
    "fr": "Diffusé"
  },
  "text169": {
    "en": "day",
    "fr": "jour"
  },
  "text170": {
    "en": "days",
    "fr": "jours"
  },
  "text171": {
    "en": "No delivery yet",
    "fr": "Aucune diffusion pour le moment"
  },
  "text172": {
    "en": "Daily spend for {value0}",
    "fr": "Dépenses quotidiennes pour {value0}"
  },
  "text173": {
    "en": "Manage",
    "fr": "Gérer"
  },
  "text174": {
    "en": "Stored details",
    "fr": "Détails enregistrés"
  },
  "text175": {
    "en": "Report day unavailable",
    "fr": "Date du rapport indisponible"
  },
  "text176": {
    "en": "Fetch time unavailable",
    "fr": "Date de collecte indisponible"
  },
  "text177": {
    "en": "Not reported",
    "fr": "Non communiqué"
  },
  "text178": {
    "en": "No daily measures stored.",
    "fr": "Aucune mesure quotidienne enregistrée."
  },
  "text179": {
    "en": "Delivery measures",
    "fr": "Mesures de diffusion"
  },
  "text180": {
    "en": "Report day (UTC)",
    "fr": "Date du rapport (UTC)"
  },
  "text181": {
    "en": "Fetched at (UTC)",
    "fr": "Collecté le (UTC)"
  },
  "text182": {
    "en": "Currency",
    "fr": "Devise"
  },
  "text183": {
    "en": "Reach (daily, non-additive)",
    "fr": "Portée (quotidienne, non additive)"
  },
  "text184": {
    "en": "CPP",
    "fr": "CPP"
  },
  "text185": {
    "en": "Frequency",
    "fr": "Fréquence"
  },
  "text186": {
    "en": "Item {value0}",
    "fr": "Élément {value0}"
  },
  "text187": {
    "en": "No additional values stored.",
    "fr": "Aucune valeur supplémentaire enregistrée."
  },
  "text188": {
    "en": "Showing",
    "fr": "Affichage"
  },
  "text189": {
    "en": "–",
    "fr": "–"
  },
  "text190": {
    "en": "of",
    "fr": "sur"
  },
  "text191": {
    "en": "Page {value0} of {value1}",
    "fr": "Page {value0} sur {value1}"
  },
  "text192": {
    "en": "Page",
    "fr": "Page"
  },
  "text193": {
    "en": "Account",
    "fr": "Compte"
  },
  "text194": {
    "en": "Previous page",
    "fr": "Page précédente"
  },
  "text195": {
    "en": "Next page",
    "fr": "Page suivante"
  },
  "text196": {
    "en": "Export Ads report",
    "fr": "Exporter le rapport publicitaire"
  },
  "text197": {
    "en": "Export all matching daily rows across every page, up to {value0} rows and {value1} bytes. Action metrics and additional fields are included; sensitive connection fields are redacted.",
    "fr": "Exporte toutes les lignes quotidiennes correspondantes sur toutes les pages, jusqu’à {value0} lignes et {value1} octets. Les mesures d’actions et champs supplémentaires sont inclus ; les informations sensibles de connexion sont masquées."
  },
  "text198": {
    "en": "Export all matching daily rows",
    "fr": "Exporter toutes les lignes quotidiennes correspondantes"
  },
  "text199": {
    "en": "Preparing CSV…",
    "fr": "Préparation du CSV…"
  },
  "text200": {
    "en": "The change was not applied. Review it before submitting a new request.",
    "fr": "La modification n’a pas été appliquée. Vérifiez-la avant de soumettre une nouvelle demande."
  },
  "text201": {
    "en": "This request had already succeeded earlier: the {value0}{value1} was created paused{value2}. Its delivery status may have changed since, so check its current status in the advertising platform.",
    "fr": "Cette demande avait déjà abouti : {value0}{value1} a été créé en pause{value2}. Son état de diffusion peut avoir changé depuis ; vérifiez son état actuel sur la plateforme publicitaire."
  },
  "text202": {
    "en": "Paused {value0} created{value1}{value2}. It will not run or spend until you activate it.",
    "fr": "Création en pause : {value0}{value1}{value2}. Aucune diffusion ni dépense avant activation."
  },
  "text203": {
    "en": "Enter a campaign name from 1 to {value0} characters.",
    "fr": "Saisissez un nom de campagne de 1 à {value0} caractères."
  },
  "text204": {
    "en": "Correct the highlighted field to continue.",
    "fr": "Corrigez le champ signalé pour continuer."
  },
  "text205": {
    "en": "Your browser could not save this pending request. Allow tab storage and try again. Nothing was sent.",
    "fr": "Votre navigateur n’a pas pu enregistrer cette demande. Autorisez le stockage de l’onglet et réessayez. Aucun envoi n’a eu lieu."
  },
  "text206": {
    "en": "The campaign could not be created.",
    "fr": "La campagne n’a pas pu être créée."
  },
  "text207": {
    "en": "Create campaign in {value0}",
    "fr": "Créer une campagne dans {value0}"
  },
  "text208": {
    "en": "Creating…",
    "fr": "Création…"
  },
  "text209": {
    "en": "Campaign creation needs review",
    "fr": "La création de la campagne doit être vérifiée"
  },
  "text210": {
    "en": "Do not start another creation. Checking again reuses the same request ID. Review the advertising platform and",
    "fr": "Ne lancez pas de nouvelle création. Une nouvelle vérification réutilise le même identifiant. Consultez la plateforme publicitaire et"
  },
  "text211": {
    "en": "Ads change history",
    "fr": "l’historique des modifications publicitaires"
  },
  "text212": {
    "en": "before trying again.",
    "fr": "avant de réessayer."
  },
  "text213": {
    "en": "Check the same request again",
    "fr": "Vérifier à nouveau la même demande"
  },
  "text214": {
    "en": "Open Ads change history",
    "fr": "Ouvrez l’historique des modifications publicitaires"
  },
  "text215": {
    "en": "to resolve the earlier change.",
    "fr": "pour résoudre la modification précédente."
  },
  "text216": {
    "en": "Enter an ad set name from 1 to {value0} characters.",
    "fr": "Saisissez un nom d’ensemble de publicités de 1 à {value0} caractères."
  },
  "text217": {
    "en": "Enter a valid daily budget{value0} with up to {value1} decimal places.",
    "fr": "Saisissez un budget quotidien valide{value0} avec au maximum {value1} décimales."
  },
  "text218": {
    "en": "Enter a two-letter country code, such as MA.",
    "fr": "Saisissez un code pays de deux lettres, par exemple MA."
  },
  "text219": {
    "en": "Correct the highlighted fields to continue.",
    "fr": "Corrigez les champs signalés pour continuer."
  },
  "text220": {
    "en": "The ad set could not be created.",
    "fr": "L’ensemble de publicités n’a pas pu être créé."
  },
  "text221": {
    "en": "Create ad set under {value0}",
    "fr": "Créer un ensemble de publicités dans {value0}"
  },
  "text222": {
    "en": "MA",
    "fr": "MA"
  },
  "text223": {
    "en": "Ad set creation needs review",
    "fr": "La création de l’ensemble de publicités doit être vérifiée"
  },
  "text224": {
    "en": "under",
    "fr": "dans"
  },
  "text225": {
    "en": ":",
    "fr": " :"
  },
  "text226": {
    "en": "This could not be saved. Check Ads change history and try again.",
    "fr": "Enregistrement impossible. Consultez l’historique des modifications publicitaires et réessayez."
  },
  "text227": {
    "en": "Your review was recorded. This action did not contact the advertising platform or send the change again.",
    "fr": "Votre vérification a été enregistrée. Cette action n’a pas contacté la plateforme publicitaire ni renvoyé la modification."
  },
  "text228": {
    "en": "Change history could not be refreshed. Try again.",
    "fr": "L’historique des modifications n’a pas pu être actualisé. Réessayez."
  },
  "text229": {
    "en": "Change history updated.",
    "fr": "Historique des modifications actualisé."
  },
  "text230": {
    "en": "Refresh change history",
    "fr": "Actualiser l’historique des modifications"
  },
  "text231": {
    "en": "Nouveau visuel sans affectation",
    "fr": "Nouveau visuel sans affectation"
  },
  "text232": {
    "en": "Ads change",
    "fr": "Modification publicitaire"
  },
  "text233": {
    "en": "Needs review",
    "fr": "À vérifier"
  },
  "text234": {
    "en": "Creation receipts",
    "fr": "Reçus de création"
  },
  "text235": {
    "en": "Record review",
    "fr": "Enregistrer la vérification"
  },
  "text236": {
    "en": "Review change history",
    "fr": "Consulter l’historique des modifications"
  },
  "text237": {
    "en": "The details could not be loaded.",
    "fr": "Les détails n’ont pas pu être chargés."
  },
  "text238": {
    "en": "This change could not be prepared.",
    "fr": "Cette modification n’a pas pu être préparée."
  },
  "text239": {
    "en": "Change applied.",
    "fr": "Modification appliquée."
  },
  "text240": {
    "en": "Your review confirmed that the previous change was not applied. You can prepare a new change.",
    "fr": "Votre vérification confirme que la modification précédente n’a pas été appliquée. Vous pouvez préparer une nouvelle modification."
  },
  "text241": {
    "en": "The result is unknown. The same request can be checked again safely.",
    "fr": "Le résultat est inconnu. Vous pouvez vérifier à nouveau la même demande en toute sécurité."
  },
  "text242": {
    "en": "Enter a valid amount{value0} with up to {value1} decimal places.",
    "fr": "Saisissez un montant valide{value0} avec au maximum {value1} décimales."
  },
  "text243": {
    "en": "Enter an amount no higher than {value0}.",
    "fr": "Saisissez un montant inférieur ou égal à {value0}."
  },
  "text244": {
    "en": "Set the {value0} budget to {value1}.",
    "fr": "Définir le budget {value0} à {value1}."
  },
  "text245": {
    "en": "Enter a name.",
    "fr": "Saisissez un nom."
  },
  "text246": {
    "en": "Keep the name to {value0} characters or fewer.",
    "fr": "Limitez le nom à {value0} caractères."
  },
  "text247": {
    "en": "Rename this {value0} to “{value1}”.",
    "fr": "Renommer {value0} en « {value1} »."
  },
  "text248": {
    "en": "Creatives could not be loaded.",
    "fr": "Les visuels n’ont pas pu être chargés."
  },
  "text249": {
    "en": "Current status: {value0} · delivery: {value1}",
    "fr": "État actuel : {value0} · diffusion : {value1}"
  },
  "text250": {
    "en": "New budget{value0}",
    "fr": "Nouveau budget{value0}"
  },
  "text251": {
    "en": ".",
    "fr": "."
  },
  "text252": {
    "en": "Delete this {value0}.",
    "fr": "Supprimer {value0}."
  },
  "text253": {
    "en": "…",
    "fr": "…"
  },
  "text254": {
    "en": "Try the same change again",
    "fr": "Réessayer la même modification"
  },
  "text255": {
    "en": "Confirm change",
    "fr": "Confirmer la modification"
  },
  "text256": {
    "en": "From",
    "fr": "Du"
  },
  "text257": {
    "en": "To",
    "fr": "Au"
  },
  "text258": {
    "en": "Showing {value0}–{value1} of {value2} accounts · Page {value3} of {value4}. Stored delivery performance · {value5}. Account currencies remain separate.",
    "fr": "Affichage des comptes {value0}–{value1} sur {value2} · Page {value3} sur {value4}. Performances de diffusion enregistrées · {value5}. Les devises des comptes restent distinctes."
  },
  "text259": {
    "en": "Synced {value0}",
    "fr": "Synchronisé le {value0}"
  },
  "text260": {
    "en": "Showing {value0}–{value1} of {value2} objects · Page {value3} of {value4}. Stored daily insight records · {value5}. Select an account and date range in the sidebar.",
    "fr": "Affichage des objets {value0}–{value1} sur {value2} · Page {value3} sur {value4}. Données quotidiennes enregistrées · {value5}. Sélectionnez un compte et une période dans la barre latérale."
  },
  "text261": {
    "en": "Campaigns, ad sets and ads",
    "fr": "Campagnes, ensembles et publicités"
  },
  "text262": {
    "en": "Last delivery",
    "fr": "Dernière diffusion"
  },
  "text263": {
    "en": "None in range",
    "fr": "Aucune sur cette période"
  },
  "text264": {
    "en": "Actions",
    "fr": "Actions"
  },
  "text265": {
    "en": "Check your filters",
    "fr": "Vérifiez vos filtres"
  },
  "text266": {
    "en": "Correct your selection in Filters, or use Reset filters. No report was loaded.",
    "fr": "Corrigez votre sélection dans les filtres ou réinitialisez-les. Aucun rapport n’a été chargé."
  },
  "text267": {
    "en": "Return to page 1",
    "fr": "Revenir à la page 1"
  },
  "text268": {
    "en": "Retry from page 1",
    "fr": "Réessayer depuis la page 1"
  },
  "text269": {
    "en": "Check the report page",
    "fr": "Vérifiez la page du rapport"
  },
  "text270": {
    "en": "Report could not be loaded completely",
    "fr": "Le rapport n’a pas pu être chargé entièrement"
  },
  "text271": {
    "en": "Use the page controls in Filters or return to the first page. No report was loaded.",
    "fr": "Utilisez les commandes de page dans les filtres ou revenez à la première page. Aucun rapport n’a été chargé."
  },
  "text272": {
    "en": "No partial report is shown. Narrow the account or date range, then try again.",
    "fr": "Aucun rapport partiel n’est affiché. Réduisez les comptes ou la période et réessayez."
  }
};
export const adsCustomerCopySchema = z.object(Object.fromEntries(Object.keys(adsCustomerCopy).map(key => [key, z.object({ en: z.string().min(1).max(4000), fr: z.string().min(1).max(4000) }).strict()])) as { [K in keyof typeof adsCustomerCopy]: z.ZodObject<{ en: z.ZodString; fr: z.ZodString }> }).strict();
export type AdsCustomerCopy = typeof adsCustomerCopy;
export type AdsCustomerKey = keyof AdsCustomerCopy;
export type AdsCatalogs = { customer: AdsCustomerCopy; analysis: { [L in 'en' | 'fr']: { [K in keyof typeof adsCopy.en]: string } }; creative: { [L in 'en' | 'fr']: { [K in keyof typeof creativeCopy.en]: string } } };
export const defaultAdsCatalogs: AdsCatalogs = { customer: adsCustomerCopy, analysis: adsCopy, creative: creativeCopy };
export function customerText(copy: AdsCustomerCopy, locale: 'en' | 'fr', key: AdsCustomerKey, values: Record<string, string | number> = {}) {
  return copy[key][locale].replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);
}

export type AdsTranslator = (key: AdsCustomerKey, values?: Record<string, string | number>) => string;
export function adsTranslator(catalogs: AdsCatalogs = defaultAdsCatalogs, locale: 'en' | 'fr' = 'en'): AdsTranslator { return (key, values) => customerText(catalogs.customer, locale, key, values); }

/** Pure parsers use catalog defaults; public request boundaries resolve the current catalog. */
export const defaultAdsText: AdsTranslator = (key, values) => customerText(adsCustomerCopy, 'en', key, values);

export function localizeAdsMessage(catalogs: AdsCatalogs, locale: 'en' | 'fr', message: string): string {
  for (const key of Object.keys(adsCustomerCopy) as AdsCustomerKey[]) {
    for (const source of [adsCustomerCopy[key].en, catalogs.customer[key].en]) {
      const names: string[] = [];
      const pattern = source.split(/(\{\w+\})/g).map(part => {
        if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '([\\s\\S]*?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      const found = new RegExp(`^${pattern}$`).exec(message);
      if (found) return customerText(catalogs.customer, locale, key, Object.fromEntries(names.map((name, i) => [name, found[i + 1]])));
    }
  }
  return message;
}

export function bilingualCatalog<T extends Record<string, string>>(copy: { en: T; fr: { [K in keyof T]: string } }): { [K in keyof T]: { en: string; fr: string } } {
  return Object.fromEntries(Object.keys(copy.en).map(key => [key, { en: copy.en[key], fr: copy.fr[key] }])) as { [K in keyof T]: { en: string; fr: string } };
}
export function bilingualCatalogSchema<T extends Record<string, { en: string; fr: string }>>(copy: T) {
  return z.object(Object.fromEntries(Object.keys(copy).map(key => [key, z.object({ en: z.string().min(1).max(4000), fr: z.string().min(1).max(4000) }).strict()])) as { [K in keyof T]: z.ZodObject<{ en: z.ZodString; fr: z.ZodString }> }).strict();
}
export function catalogLanguages<T extends Record<string, { en: string; fr: string }>>(copy: T): { [L in 'en' | 'fr']: { [K in keyof T]: string } } {
  return { en: Object.fromEntries(Object.entries(copy).map(([key, value]) => [key, value.en])), fr: Object.fromEntries(Object.entries(copy).map(([key, value]) => [key, value.fr])) } as { [L in 'en' | 'fr']: { [K in keyof T]: string } };
}
export const adsAnalysisCatalog = bilingualCatalog(adsCopy);
export const adsCreativeCatalog = bilingualCatalog(creativeCopy);
