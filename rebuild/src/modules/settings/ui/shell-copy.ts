/** Shared settings chrome. Screen-specific copy lives beside each screen in `copy.ts`. */
export const shellCopy = {
  en: { eyebrow: 'Workspace settings' },
  fr: { eyebrow: 'Paramètres de l’espace' },
} as const;

/** Replaces `{name}` placeholders. Client-safe: no server imports. */
export const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
