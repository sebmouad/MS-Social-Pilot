import { z } from 'zod';
type Paths<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}` }[keyof T & string];
type Pair = { en: string; fr: string };
/** Root copy is one strict bilingual text entry per leaf; browser views keep their established structure. */
export function bilingualCatalog<T extends object>(defaults: { en: T; fr: T }) {
  const flatten = (value: object, prefix = ''): Record<string, string> => Object.fromEntries(Object.entries(value).flatMap(([key, leaf]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof leaf === 'string' ? [[path, leaf]] : Object.entries(flatten(leaf, path));
  }));
  const en = flatten(defaults.en), fr = flatten(defaults.fr);
  const catalog = Object.fromEntries(Object.keys(en).map(key => [key, { en: en[key]!, fr: fr[key]! }])) as Record<Paths<T>, Pair>;
  const text = z.string().min(1).max(4000).refine(value => value.trim().length > 0);
  const pair = z.object({ en: text, fr: text }).strict();
  const schema = z.object(Object.fromEntries(Object.keys(en).map(key => [key, pair])) as unknown as Record<Paths<T>, typeof pair>).strict();
  const view = (value: Record<Paths<T>, Pair>, locale: 'en' | 'fr'): T => {
    const output: Record<string, unknown> = {};
    for (const [path, pair] of Object.entries(value) as Array<[string, Pair]>) {
      const parts = path.split('.'); let node = output;
      for (const key of parts.slice(0, -1)) { node[key] ??= {}; node = node[key] as Record<string, unknown>; }
      node[parts[parts.length - 1]!] = pair[locale];
    }
    return output as T;
  };
  return { catalog, schema, view };
}
