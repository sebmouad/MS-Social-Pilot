import type { AutopilotLogEntry } from './wordpress/autopilot';

/**
 * The autopilot's activity log in the page language (2026-11-16). Entries carry a code and values; the sentence is
 * written when shown, so a French page reads French. Entries saved before codes existed are recognised by their English
 * sentence and written the same way (2026-11-17); any other text is shown as saved.
 */
export type LogCode = 'photosUnread' | 'replanned' | 'stranded' | 'refilled' | 'publishFailed' | 'channelHeld' | 'hot' | 'hotShort' | 'breathe' | 'spread' | 'notSpread' | 'radarFailed';

const TEXT: Record<'en' | 'fr', Record<LogCode, string>> = {
  en: {
    stranded: '« {title} » was left unsure by an interrupted run and never created; its time is planned again.',
    refilled: '« {title} » never went out after an interrupted run; another recipe goes out at {time} so the day keeps its posts.',
    photosUnread: 'Photos could not be read ({found} of {tried} recipes found): {why}',
    replanned: 'Re-planned with this Page’s memory: « {from} » (expected ×{fromValue}) replaced by « {to} » at {time}.',
    publishFailed: '« {title} » failed to publish; another recipe replaces it.',
    channelHeld: 'This channel cannot publish right now (its connection or permissions). Its recipes are on hold; the other channels carry on.',
    hot: '« {title} » is taking off: {reach} people reached in {hours} h, {times}× what a post usually has by then.',
    hotShort: '« {title} » is taking off: {reach} people reached, {times}× usual.',
    breathe: 'The next post waits until {time} so this one keeps its reach.',
    spread: 'Planned on {count} similar channels: {channels}.{others}',
    notSpread: 'Not spread to other channels: {why}.',
    radarFailed: 'The viral radar could not run: {reason}. Planning carried on.',
  },
  fr: {
    stranded: '« {title} » est resté incertain après une exécution interrompue et n’a jamais été créé ; son horaire est replanifié.',
    refilled: '« {title} » n’est jamais parti après une exécution interrompue ; une autre recette part à {time} pour que la journée garde ses publications.',
    photosUnread: 'Les photos n’ont pas pu être lues ({found} recettes trouvées sur {tried}) : {why}',
    replanned: 'Replanifié avec la mémoire de cette Page : « {from} » (attendu ×{fromValue}) remplacée par « {to} » à {time}.',
    publishFailed: '« {title} » n’a pas pu être publié ; une autre recette le remplace.',
    channelHeld: 'Ce canal ne peut pas publier pour le moment (connexion ou autorisations). Ses recettes sont en attente ; les autres canaux continuent.',
    hot: '« {title} » décolle : {reach} personnes touchées en {hours} h, {times}× ce qu’une publication obtient d’habitude à ce stade.',
    hotShort: '« {title} » décolle : {reach} personnes touchées, {times}× l’habitude.',
    breathe: 'La publication suivante attend jusqu’à {time} pour que celle-ci garde sa portée.',
    spread: 'Planifiée sur {count} canaux proches : {channels}.{others}',
    notSpread: 'Pas diffusée sur d’autres canaux : {why}.',
    radarFailed: 'Le radar viral n’a pas pu tourner : {reason}. La planification a continué.',
  },
};
const WHY: Record<'en' | 'fr', { already: string; noSlot: string; refused: string; none: string; others: string }> = {
  en: { already: '{n} already had this recipe', noSlot: '{n} had no free time in the next three days', refused: '{n} could not be changed', none: 'no similar channel', others: ' Others: {why}.' },
  fr: { already: '{n} l’avaient déjà eue', noSlot: '{n} sans horaire libre dans les trois jours', refused: '{n} n’ont pas pu être modifiés', none: 'aucun canal proche', others: ' Autres : {why}.' },
};

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);

/** Why a recipe was not spread, from the counts stored with the entry. */
function why(locale: 'en' | 'fr', params: Record<string, string | number>): string {
  const w = WHY[locale];
  const parts = [Number(params.already) ? fill(w.already, { n: params.already! }) : '', Number(params.noSlot) ? fill(w.noSlot, { n: params.noSlot! }) : '', Number(params.refused) ? fill(w.refused, { n: params.refused! }) : ''].filter(Boolean);
  return parts.join(', ');
}

/** The English sentences entries were saved with before they carried a code (16 Nov 2026), read back as code and values. */
const LEGACY: Array<[RegExp, LogCode, (m: RegExpMatchArray) => Record<string, string | number>]> = [
  [/^« (.+) » was left unsure by an interrupted run and never created; its time is planned again\.$/, 'stranded', m => ({ title: m[1]! })],
  [/^« (.+) » failed to publish; another recipe replaces it\.$/, 'publishFailed', m => ({ title: m[1]! })],
  [/^This channel cannot publish right now \(its connection or permissions\)\./, 'channelHeld', () => ({})],
  [/^« (.+) » is taking off: (\d+) people reached, ([\d.]+)× usual\.$/, 'hotShort', m => ({ title: m[1]!, reach: Number(m[2]), times: Number(m[3]) })],
  [/^The next post waits until (\d\d:\d\d) UTC so this one keeps its reach\.$/, 'breathe', m => ({ time: `${m[1]} UTC` })],
  [/^Planned on (\d+) similar channels: (.+)\.$/, 'spread', m => ({ count: Number(m[1]), channels: m[2]! })],
];
const fromLegacy = (text: string | undefined): { code: LogCode; params: Record<string, string | number> } | null => {
  for (const [pattern, code, params] of LEGACY) { const m = text?.match(pattern); if (m) return { code, params: params(m) }; }
  return null;
};

/** The entry's sentence in the page language (without the channel name, shown apart). */
export function logSentence(entry: AutopilotLogEntry, locale: 'en' | 'fr'): string {
  const coded = entry.code && entry.code in TEXT.en ? { code: entry.code as LogCode, params: entry.params ?? {} } : fromLegacy(entry.text);
  if (!coded) return entry.text ?? '';
  const { code, params } = coded;
  const reasons = why(locale, params);
  if (code === 'notSpread') return fill(TEXT[locale].notSpread, { why: reasons || WHY[locale].none });
  if (code === 'spread') return fill(TEXT[locale].spread, { ...params, others: reasons ? fill(WHY[locale].others, { why: reasons }) : '' });
  const shown = { ...params, ...(typeof params.reach === 'number' ? { reach: new Intl.NumberFormat(locale).format(params.reach) } : {}), ...(typeof params.times === 'number' ? { times: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(params.times) } : {}) };
  return fill(TEXT[locale][code], shown);
}
