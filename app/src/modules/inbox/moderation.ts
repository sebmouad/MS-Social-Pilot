import { z } from 'zod';

/**
 * Provider-neutral comment moderation rules, ported from the legacy
 * `src/lib/moderation.ts` matcher. A rule looks for links, phone numbers or
 * keywords and then hides the comment, records it for the team, or replies
 * through the channel's platform module. Platform support is decided by the
 * installed module's declared Inbox capabilities, never by provider name.
 */
export const MODERATION_MATCHES = ['links', 'phones', 'keywords'] as const;
export type ModerationMatch = (typeof MODERATION_MATCHES)[number];
export const MODERATION_ACTIONS = ['hide', 'alert', 'reply', 'comment_to_dm'] as const;
export type ModerationActionKind = (typeof MODERATION_ACTIONS)[number];

const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(com|net|org|info|biz|io|co|me|ly|link|xyz|shop|site|online)\b(\/\S*)?/i;
/** Eight digits or more, allowing the spaces, dots, dashes and brackets people write. */
const PHONE = /(?:\+|\b)(?:\d[\s.\-()]{0,2}){8,}\d?/;

/** Lower case without accents, so "Promo" finds "PROMO" and "prómo". */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function matchesModerationRule(rule: { match: string; keywords: readonly string[] }, text: string): boolean {
  if (!text.trim()) return false;
  switch (rule.match as ModerationMatch) {
    case 'links': return LINK.test(text);
    case 'phones': return PHONE.test(text);
    case 'keywords': {
      const body = foldText(text);
      return rule.keywords.some(keyword => keyword.trim() && body.includes(foldText(keyword.trim())));
    }
    default: return false;
  }
}

/** `{first_name}`, `{author_name}` and `{page}` (the channel name) filled for one person. */
export function fillModerationReply(template: string, values: { name: string | null; channel: string }): string {
  const full = values.name?.trim() ?? '';
  const first = full.split(/\s+/)[0] ?? '';
  return template
    .replace(/\{\{?\s*author_name\s*\}?\}/g, full)
    .replace(/\{\{?\s*first_name\s*\}?\}/g, first)
    .replace(/\{\{?\s*page\s*\}?\}/g, values.channel)
    .replace(/\{\{?\s*channel_name\s*\}?\}/g, values.channel)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const moderationRuleFields = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  targetIds: z.array(id).max(500),
  match: z.enum(MODERATION_MATCHES),
  keywords: z.array(z.string().trim().min(1).max(100)).max(100),
  action: z.enum(MODERATION_ACTIONS),
  replyText: z.string().trim().max(2000).nullable(),
  dailyCap: z.number().int().min(1).max(500),
  oncePerUser: z.boolean(),
}).strict();
export type ModerationRuleInput = z.infer<typeof moderationRuleFields>;

export const moderationConfirmation = {
  create: (name: string) => `CREATE MODERATION RULE ${name}`,
  update: (ruleId: string) => `UPDATE MODERATION RULE ${ruleId}`,
  remove: (ruleId: string) => `DELETE MODERATION RULE ${ruleId}`,
  run: (channelId: string | null) => `RUN MODERATION RULES ${channelId ?? 'ALL'}`,
  undo: (actionId: string) => `UNDO MODERATION ACTION ${actionId}`,
};

export const moderationActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rule.create'), rule: moderationRuleFields, confirmation: z.string().max(500) }).strict(),
  z.object({ action: z.literal('rule.update'), id, rule: moderationRuleFields, confirmation: z.string().max(500) }).strict(),
  z.object({ action: z.literal('rule.delete'), id, confirmation: z.string().max(500) }).strict(),
  z.object({ action: z.literal('rules.run'), channelId: id.nullable(), confirmation: z.string().max(500) }).strict(),
  z.object({ action: z.literal('action.undo'), id, confirmation: z.string().max(500) }).strict(),
]);
export type ModerationRequest = z.infer<typeof moderationActionSchema>;

/** A rule needs keywords to look for, or words to reply with. */
export function moderationRuleProblem(rule: Pick<ModerationRuleInput, 'match' | 'keywords' | 'action' | 'replyText'>): 'keywords' | 'reply' | null {
  if (rule.match === 'keywords' && rule.keywords.length === 0) return 'keywords';
  if ((rule.action === 'reply' || rule.action === 'comment_to_dm') && !rule.replyText?.trim()) return 'reply';
  return null;
}

/** Customer copy in both shipped languages; keys mirror legacy `moderation.*`. */
export const moderationCopy = {
  en: {
    title: 'Moderation rules',
    pageIntro: 'Hide, record or answer comments that match your rules.',
    intro: 'Check stored comments on your channels against these rules. Run them when you want; each action is listed below and can be undone where the channel allows it.',
    emptyTitle: 'No moderation rules yet',
    emptyHint: 'Add a rule to hide spam links, phone numbers or words you don’t want under your posts.',
    addRule: 'Add a rule', saveRule: 'Save rule', cancel: 'Cancel', confirmTitle: 'Please confirm', confirmGo: 'Continue', edit: 'Edit', remove: 'Delete',
    paused: 'Paused', pause: 'Pause', resume: 'Turn on',
    name: 'Rule name', namePlaceholder: 'For example: Hide spam links',
    when: 'When a comment contains', then: 'Then',
    'match.links': 'a link', 'match.phones': 'a phone number', 'match.keywords': 'one of these words',
    'action.hide': 'Hide it', 'action.alert': 'Record it for the team', 'action.reply': 'Reply as the channel', 'action.comment_to_dm': 'Send a private message',
    'done.hide': 'Hidden', 'done.alert': 'Recorded', 'done.reply': 'Replied', 'done.comment_to_dm': 'Private message sent',
    keywords: 'Words to look for', keywordsHint: 'Separate them with commas. Capitals and accents are ignored.',
    replyText: 'Reply', replyHint: 'Use {first_name} for the commenter’s first name and {page} for the channel name.',
    oncePerUser: 'Reply to each person only once',
    channels: 'Channels', allChannels: 'Every channel, including ones connected later',
    dailyCap: 'Most actions a day', dailyCapHint: 'Stops the rule after this many actions in 24 hours.',
    run: 'Run rules now', runDone: 'Rules checked {examined} comments and acted on {acted}.',
    logHeading: 'What the rules did', logHint: 'The latest actions, newest first.',
    logEmptyTitle: 'Nothing yet', logEmptyHint: 'When a rule acts on a comment, it is listed here.',
    undone: 'Undone', someone: 'Someone', failed: 'Not completed: {reason}',
    undoHide: 'Show comment again', undoHideConfirm: 'Show this comment again? It becomes visible to everyone on the channel.',
    undoneOk: 'Done. The log shows it as undone.',
    needsKeywords: 'Add at least one word to look for.', needsReply: 'Write the reply to send.',
    deleteConfirm: 'Delete this rule? What it already did stays as it is.',
    saved: 'Rule saved.', loadFailed: 'Moderation rules could not be loaded. Please try again.',
    unconfirmed: 'The outcome is unconfirmed. Check the log before trying again.',
  },
  fr: {
    title: 'Règles de modération',
    pageIntro: 'Masquez, enregistrez ou répondez aux commentaires qui correspondent à vos règles.',
    intro: 'Vérifiez les commentaires enregistrés de vos canaux avec ces règles. Lancez-les quand vous voulez ; chaque action est listée ci-dessous et peut être annulée si le canal le permet.',
    emptyTitle: 'Aucune règle de modération',
    emptyHint: 'Ajoutez une règle pour masquer les liens indésirables, les numéros de téléphone ou les mots dont vous ne voulez pas sous vos publications.',
    addRule: 'Ajouter une règle', saveRule: 'Enregistrer la règle', cancel: 'Annuler', confirmTitle: 'Confirmez', confirmGo: 'Continuer', edit: 'Modifier', remove: 'Supprimer',
    paused: 'En pause', pause: 'Mettre en pause', resume: 'Activer',
    name: 'Nom de la règle', namePlaceholder: 'Par exemple : Masquer les liens indésirables',
    when: 'Quand un commentaire contient', then: 'Alors',
    'match.links': 'un lien', 'match.phones': 'un numéro de téléphone', 'match.keywords': 'l’un de ces mots',
    'action.hide': 'Le masquer', 'action.alert': 'L’enregistrer pour l’équipe', 'action.reply': 'Répondre au nom du canal', 'action.comment_to_dm': 'Envoyer un message privé',
    'done.hide': 'Masqué', 'done.alert': 'Enregistré', 'done.reply': 'Répondu', 'done.comment_to_dm': 'Message privé envoyé',
    keywords: 'Mots à rechercher', keywordsHint: 'Séparez-les par des virgules. Majuscules et accents sont ignorés.',
    replyText: 'Réponse', replyHint: 'Utilisez {first_name} pour le prénom de la personne et {page} pour le nom du canal.',
    oncePerUser: 'Ne répondre qu’une fois à chaque personne',
    channels: 'Canaux', allChannels: 'Tous les canaux, y compris ceux connectés plus tard',
    dailyCap: 'Nombre maximal d’actions par jour', dailyCapHint: 'Arrête la règle après ce nombre d’actions en 24 heures.',
    run: 'Lancer les règles', runDone: 'Les règles ont vérifié {examined} commentaires et agi sur {acted}.',
    logHeading: 'Ce que les règles ont fait', logHint: 'Les dernières actions, les plus récentes en premier.',
    logEmptyTitle: 'Rien pour l’instant', logEmptyHint: 'Quand une règle agit sur un commentaire, elle apparaît ici.',
    undone: 'Annulé', someone: 'Quelqu’un', failed: 'Non effectué : {reason}',
    undoHide: 'Afficher à nouveau', undoHideConfirm: 'Afficher à nouveau ce commentaire ? Il redevient visible pour tout le monde sur le canal.',
    undoneOk: 'C’est fait. Le journal l’indique comme annulé.',
    needsKeywords: 'Ajoutez au moins un mot à rechercher.', needsReply: 'Rédigez la réponse à envoyer.',
    deleteConfirm: 'Supprimer cette règle ? Ce qu’elle a déjà fait reste en l’état.',
    saved: 'Règle enregistrée.', loadFailed: 'Les règles de modération n’ont pas pu être chargées. Veuillez réessayer.',
    unconfirmed: 'Le résultat n’est pas confirmé. Consultez le journal avant de réessayer.',
  },
} as const;
export type ModerationLocale = keyof typeof moderationCopy;
export type ModerationCopyKey = keyof typeof moderationCopy.en;
export function moderationText(locale: ModerationLocale, key: ModerationCopyKey, values: Record<string, string | number> = {}): string {
  return (moderationCopy[locale][key] as string).replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);
}
