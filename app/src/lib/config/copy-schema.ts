import { z } from 'zod';

/** Strict plain-text catalog, with the same typed fields as its browser-safe defaults. */
export function copySchema<T extends Record<string, string>>(defaults: T) {
  return z.object(Object.fromEntries(Object.keys(defaults).map(key => [key, z.string().trim().min(1).max(4000)])) as { [K in keyof T]: z.ZodString }).strict();
}
