import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { brand } from '@/lib/operator';

import { Icon, type IconName } from './Icon';
import { SiteFrame } from './SiteFrame';

const FEATURES: Array<{ key: string; icon: IconName }> = [
  { key: 'plan', icon: 'calendar' },
  { key: 'networks', icon: 'globe' },
  { key: 'inbox', icon: 'inbox' },
  { key: 'analytics', icon: 'analytics' },
  { key: 'team', icon: 'team' },
  { key: 'reports', icon: 'reports' },
];

/** The public home page, when root has switched the product site on. */
export async function SiteHome() {
  const t = await getTranslations('site.home');
  return (
    <SiteFrame>
      <section className="py-8 text-center">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">{t('title', { product: brand().name })}</h1>
        <p className="mx-auto mt-3 max-w-2xl text-base text-slate-600">{t('subtitle')}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/register" className="btn-primary">{t('cta')}</Link>
          <Link href="/pricing" className="btn-secondary">{t('seePricing')}</Link>
        </div>
      </section>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <li key={feature.key} className="card p-5">
            <Icon name={feature.icon} size={22} className="text-brand-600" />
            <h2 className="mt-2 font-semibold text-slate-900">{t(`features.${feature.key}.title`)}</h2>
            <p className="mt-1 text-sm text-slate-600">{t(`features.${feature.key}.body`)}</p>
          </li>
        ))}
      </ul>
    </SiteFrame>
  );
}
