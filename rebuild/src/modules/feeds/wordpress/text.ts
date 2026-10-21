import names from './html-entities.json';

// HTML protocol data, not operational policy. The complete HTML5 named-reference
// table (including legacy semicolonless names) is vendored from Python html.entities.html5.
const entities: Readonly<Record<string, string>> = names;
const maxNameLength = Math.max(...Object.keys(entities).map(name => name.length));
const c1: Readonly<Record<number, number>> = {
  128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225,
  136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216,
  146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732,
  153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376,
};

/** Decode one HTML text layer. Never coerce a decoded character to a number or
 * recursively interpret escaped literal text. NBSP/NNBSP remain their exact code points. */
export function decodeWordpressText(value: string): string {
  return value.replace(/&(#(?:[xX][\da-fA-F]+|\d+);?|[A-Za-z][A-Za-z0-9]*;?)/g, (whole, entity: string) => {
    if (entity.startsWith('#')) {
      const hex = /^#x/i.test(entity);
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return String.fromCodePoint(code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? 0xfffd : (c1[code] ?? code));
    }
    // HTML names are case-sensitive and may expand to more than one code point.
    for (let end = Math.min(entity.length, maxNameLength); end > 0; end -= 1) {
      const name = entity.slice(0, end);
      if (Object.hasOwn(entities, name)) return entities[name]! + entity.slice(end);
    }
    return whole;
  });
}

/** Some caption generators store a C0 control byte (seen: U+0016) where French typography
 * needs a narrow no-break space. Before French high punctuation it becomes U+202F; any other
 * C0 control (except tab/newline) is dropped so it never reaches a provider. */
export function stripCaptionControls(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+(?=[?!:;»])/g, '\u202F')
    .replace(/(«)[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g, '$1\u202F')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export const normalizeWordpressCaption = (value: string): string => stripCaptionControls(decodeWordpressText(value)).trim();
