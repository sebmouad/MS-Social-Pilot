/**
 * Copy catalog for AI writing assist, English and French. The rebuild UI renders English today;
 * French is kept in step for the locale rollout (ported from legacy `compose.ai*` messages).
 */
export const aiCopy = {
  en: {
    region: 'AI writing assist',
    heading: 'AI writing assist',
    note: 'Suggestions only. Nothing is saved or posted until you choose to.',
    budgetLeft: (amount: string) => `About ${amount} left in this month’s AI budget.`,
    budgetUsed: 'This month’s AI budget is used up. It resets next month.',
    assist: 'Assist', tone: 'Tone', toneOptional: '(optional)', toneKeep: 'Keep as is', language: 'Language', languageHint: 'For example French',
    kinds: { caption: 'Write a post about this', improve: 'Improve wording', translate: 'Translate', hashtags: 'Suggest hashtags' },
    tones: { friendly: 'Friendly', professional: 'Professional', playful: 'Playful', urgent: 'Urgent', informative: 'Informative' },
    run: 'Get suggestion', working: 'Working…', suggestion: 'Suggestion',
    useReplace: 'Use this text', useAppend: 'Add to post', discard: 'Discard',
    needText: 'Write something first, then choose what AI assist should do.',
    needLanguage: 'Choose a language to translate into.',
    failed: 'AI assist could not complete this request.',
    unreachable: 'AI assist could not be reached. Your text is unchanged.',
  },
  fr: {
    region: 'Aide à la rédaction par IA',
    heading: 'Aide à la rédaction par IA',
    note: 'Suggestions uniquement. Rien n’est enregistré ni publié sans votre accord.',
    budgetLeft: (amount: string) => `Environ ${amount} restant dans le budget IA de ce mois.`,
    budgetUsed: 'Le budget IA de ce mois est épuisé. Il se renouvelle le mois prochain.',
    assist: 'Aide', tone: 'Ton', toneOptional: '(facultatif)', toneKeep: 'Conserver tel quel', language: 'Langue', languageHint: 'Par exemple anglais',
    kinds: { caption: 'Rédiger une publication à ce sujet', improve: 'Améliorer la formulation', translate: 'Traduire', hashtags: 'Suggérer des hashtags' },
    tones: { friendly: 'Amical', professional: 'Professionnel', playful: 'Enjoué', urgent: 'Urgent', informative: 'Informatif' },
    run: 'Obtenir une suggestion', working: 'En cours…', suggestion: 'Suggestion',
    useReplace: 'Utiliser ce texte', useAppend: 'Ajouter à la publication', discard: 'Ignorer',
    needText: 'Écrivez d’abord un texte, puis choisissez ce que l’IA doit faire.',
    needLanguage: 'Choisissez la langue de traduction.',
    failed: 'L’aide par IA n’a pas pu traiter cette demande.',
    unreachable: 'L’aide par IA est injoignable. Votre texte n’a pas été modifié.',
  },
} as const;
export type AiCopy = (typeof aiCopy)['en'];
