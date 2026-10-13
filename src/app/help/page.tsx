import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SiteFrame } from '@/components/SiteFrame';
import { screenMetadata } from '@/lib/metadata';
import { siteIsPublic } from '@/lib/site';

export const dynamic = 'force-dynamic';

const QUESTIONS = ['connect', 'schedule', 'networks', 'team', 'clients', 'analytics', 'data'] as const;

export function generateMetadata() {
  return screenMetadata('site.nav.help');
}

/** Short answers to what people ask before and after signing up. */
export default async function HelpPage() {
  if (!(await siteIsPublic())) notFound();
  const t = await getTranslations('site.help');
  return (
    <SiteFrame>
      <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
      <div className="mt-6 space-y-3">
        {QUESTIONS.map((key) => (
          <details key={key} className="card p-4">
            <summary className="cursor-pointer font-medium text-slate-900">{t(`${key}.q`)}</summary>
            <p className="mt-2 text-sm text-slate-600">{t(`${key}.a`)}</p>
          </details>
        ))}
      </div>
    </SiteFrame>
  );
}
