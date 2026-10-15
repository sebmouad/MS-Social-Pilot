import { z } from 'zod';

/** Shared building blocks for Root-managed settings, used by the core registry and by platform modules. */
export const cron = z.string().min(9).max(100).refine((value) => {
  const fields = value.trim().split(/\s+/);
  return fields.length === 5 && fields.every((field) => /^[\d*/?,\-]+$/.test(field));
}, 'Use a five-field cron expression.');
export const url = z.string().url().refine((value) => value.startsWith('https://'), 'Use an HTTPS URL.');
export const stringList = z.array(z.string().trim().min(1).max(200)).max(100);
export const optionList = (values: readonly string[]) => z.enum(values as [string, ...string[]]);

export type Consumption = 'active' | 'configured' | 'planned';
export type Option = { value: string; label: string };
export type Entry = {
  key: string; group: string; label: string; kind: 'text' | 'secret' | 'boolean' | 'number' | 'select' | 'json';
  description: string; defaultValue: unknown; schema: z.ZodTypeAny; consumption: Consumption; options?: readonly Option[];
};
export const entry = <const T extends Entry>(value: T) => value;
export const options = (values: readonly { id: string; name: string }[]): Option[] => values.map(({ id, name }) => ({ value: id, label: name }));
