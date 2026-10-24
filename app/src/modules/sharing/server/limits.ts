import { sharingError } from './messages';
import { runtimeConfig, runtimeConfigBatch } from '@/server/config/store';
import { ownerCopy, ownerCopySchema, resolveOwnerCopy, type OwnerCopy } from '../ui/owner-copy';
import { publicCopy, publicCopyDefaults, publicCopySchema } from '../ui/copy';
import { SHARING_COPY_CONFIG, SHARING_LIMIT_CONFIG, type SharingCopy, type SharingLimits } from '../config';

const unavailable = () => sharingError('unavailable', 'Sharing is temporarily unavailable. Try again later.');
const short = (key: string) => key.replace(/^(sharing|bio)\./, (_, p: string) => (p === 'bio' ? 'bio_' : ''));

/** Read and validate every sharing bound from Root configuration; fail closed when any is unreadable. */
export async function sharingLimits(read?: (key: string) => Promise<unknown>): Promise<SharingLimits> {
  const out: SharingLimits = {};
  try {
    const batch = read ? null : await runtimeConfigBatch(SHARING_LIMIT_CONFIG.map(item => item.key));
    const values = read ? await Promise.all(SHARING_LIMIT_CONFIG.map(item => read(item.key))) : SHARING_LIMIT_CONFIG.map(item => batch![item.key]);
    for (const [index, item] of SHARING_LIMIT_CONFIG.entries()) {
      const parsed = item.schema.safeParse(values[index]);
      if (!parsed.success) throw await unavailable();
      out[short(item.key)] = parsed.data as number;
    }
  } catch { throw await unavailable(); }
  if (out.defaultExpiryDays! > out.maxExpiryDays!) throw await unavailable();
  return out;
}

/** Customer text of the signed-in sharing screens, resolved to one language for the browser. */
export async function loadOwnerCopy(locale: 'en' | 'fr'): Promise<Record<string, string>> {
  // Saved catalogs from earlier releases acquire new phrases without losing valid overrides.
  try {
    const saved = ownerCopySchema.partial().safeParse(await runtimeConfig('sharing.ownerCopy'));
    return resolveOwnerCopy(locale, { ...ownerCopy, ...(saved.success ? saved.data : {}) } as OwnerCopy);
  } catch { return resolveOwnerCopy(locale); }
}

/** Visitor page text from Root; unreadable or invalid text degrades to the shipped defaults rather than blocking the page. */
export async function loadPublicCopy(locale: 'en' | 'fr') {
  try { return publicCopy(locale, publicCopySchema.parse(await runtimeConfig('sharing.publicCopy')) as typeof publicCopyDefaults); }
  catch { return publicCopy(locale); }
}

/** Visitor-facing copy from Root. Unreadable or invalid copy degrades to empty text rather than blocking the page. */
export async function sharingCopy(read: (key: string) => Promise<unknown> = runtimeConfig, locale: 'en' | 'fr' = 'en'): Promise<SharingCopy> {
  const [intro, notice, footer] = await Promise.all(SHARING_COPY_CONFIG.map(async item => {
    try {
      const parsed = item.schema.safeParse(await read(item.key));
      if (!parsed.success) return '';
      // Per-language settings (the answer notice) hold { en, fr }; single-text settings are one string.
      return typeof parsed.data === 'string' ? parsed.data : String((parsed.data as Record<string, string>)[locale] ?? '');
    } catch { return ''; }
  }));
  return { intro: intro ?? '', answerNotice: notice ?? '', bioFooter: footer ?? '' };
}
