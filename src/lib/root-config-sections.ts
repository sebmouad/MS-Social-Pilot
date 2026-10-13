/**
 * Root's app settings, split into one screen each (URL, AI, storage, email,
 * security, general). Platform settings are not here: see root-platforms.
 * Plain module (no Prisma).
 */

export const CONFIG_SECTIONS = ['url', 'ai', 'storage', 'email', 'security', 'general'] as const;

export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

export function isConfigSection(value: string): value is ConfigSection {
  return (CONFIG_SECTIONS as readonly string[]).includes(value);
}

/** The screen an app (non-platform) setting belongs on; whatever fits none is General. */
export function configSection(key: string, group: string): ConfigSection {
  if (key === 'app.url' || key === 'site.public' || group === 'links') return 'url';
  if (group === 'ai') return 'ai';
  if (group === 'media' || group === 'retention') return 'storage';
  if (group === 'email') return 'email';
  if (key.startsWith('auth.') || key.startsWith('security.') || key.startsWith('limits.') || key === 'cron.secret') return 'security';
  return 'general';
}
