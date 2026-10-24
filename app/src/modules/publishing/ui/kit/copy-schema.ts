import { z } from 'zod';

type BilingualMessage = { en: string; fr: string };
const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort().join('|');

/** Root can rewrite copy while retaining the data substitutions each message requires. */
export function bilingualCatalogSchema<T extends Record<string, BilingualMessage>>(defaults: T) {
  const shape = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key,
    z.object({ en: z.string().min(1), fr: z.string().min(1) }).strict().superRefine((message, context) => {
      for (const locale of ['en', 'fr'] as const) {
        if (placeholders(message[locale]) !== placeholders(value[locale])) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: [locale], message: 'Keep the existing named placeholders.' });
        }
      }
    }),
  ])) as unknown as Record<keyof T & string, z.ZodType<BilingualMessage>>;
  return z.object(shape).strict();
}
