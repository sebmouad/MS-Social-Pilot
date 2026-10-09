/**
 * Facebook's audience breakdown keys, as a reader would write them.
 *
 * Graph returns countries as ISO codes ("FR"), age groups as "F.25-34" and
 * languages as "fr_FR". Those are identifiers, not labels: a chart reading
 * "M.35-44" makes the reader decode it. Names come from the platform's own
 * `Intl.DisplayNames`, so they are in the reader's language with no table to
 * keep up to date.
 */

/** "FR" -> "🇫🇷 France". An unknown code is left as it came. */
export function countryLabel(code: string, locale: string): string {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return code;
  let name = upper;
  try {
    name = new Intl.DisplayNames([locale], { type: 'region' }).of(upper) ?? upper;
  } catch {
    // An engine without region names still gets the flag and the code.
  }
  const flag = String.fromCodePoint(...[...upper].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
  return `${flag} ${name}`;
}

/** "fr_FR" -> "French (France)" / "français (France)". */
export function languageLabel(key: string, locale: string): string {
  const tag = key.replace('_', '-');
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(tag);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : key;
  } catch {
    return key;
  }
}

/**
 * "F.25-34" -> "Women 25–34", with the words supplied by the caller's
 * translations. Keys that are not in Facebook's shape are left as they came.
 */
export function genderAgeLabel(
  key: string,
  words: { women: (age: string) => string; men: (age: string) => string; other: (age: string) => string },
): string {
  const match = /^([FMU])\.(.+)$/.exec(key.trim());
  if (!match) return key;
  const age = match[2]!.replace('-', '–');
  return match[1] === 'F' ? words.women(age) : match[1] === 'M' ? words.men(age) : words.other(age);
}
