import { headers } from 'next/headers';
import { runtimeConfig } from '@/server/config/store';
import { z } from 'zod';

// Shared-config owner must register ui.loadingCopy; fallback also covers configuration outages.
const defaults = { en: 'Loading your workspace…', fr: 'Chargement de votre espace de travail…' };
const catalogSchema = z.object({ en: z.string().trim().min(1).max(4000), fr: z.string().trim().min(1).max(4000) }).strict();

export default async function Loading() {
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const copy = await runtimeConfig('ui.loadingCopy').then(value => catalogSchema.parse(value)).catch(() => defaults);
  return <div className="route-state" role="status" aria-busy="true">
    <div className="route-state__mark" aria-hidden="true" />
    <p>{copy[locale]}</p>
  </div>;
}
