import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { SiteFrame } from '@/components/SiteFrame';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { siteIsPublic } from '@/lib/site';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('site.nav.pricing');
}

/** The plans root defined in Root › Plans, prices stored in cents. */
export default async function PricingPage() {
  if (!(await siteIsPublic())) notFound();
  const [t, format, plans] = await Promise.all([
    getTranslations('site.pricing'),
    getFormatter(),
    prisma.plan.findMany({ orderBy: { position: 'asc' } }),
  ]);
  const money = (cents: number, currency: string) =>
    format.number(cents / 100, { style: 'currency', currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 });
  const limit = (value: number | null, key: string) =>
    value === null ? t(`${key}Unlimited`) : t(key, { count: value });

  return (
    <SiteFrame>
      <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
      <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      {plans.length === 0 ? (
        <p className="card mt-6 p-6 text-sm text-slate-600">{t('none')}</p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <li key={plan.id} className="card flex flex-col p-5">
              <h2 className="font-semibold text-slate-900">{plan.name}</h2>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {plan.priceMonthly === 0 ? t('free') : t('perMonth', { price: money(plan.priceMonthly, plan.currency) })}
              </p>
              {plan.priceYearly > 0 && (
                <p className="text-xs text-slate-500">{t('perYear', { price: money(plan.priceYearly, plan.currency) })}</p>
              )}
              <ul className="mt-4 flex-1 space-y-1 text-sm text-slate-700">
                <li>{limit(plan.channels, 'channels')}</li>
                <li>{limit(plan.members, 'members')}</li>
                <li>{limit(plan.postsPerMonth, 'posts')}</li>
                {plan.extraChannelPrice > 0 && <li>{t('extraChannel', { price: money(plan.extraChannelPrice, plan.currency) })}</li>}
                {plan.features.map((feature) => (
                  <li key={feature}>{t(`feature.${feature}`)}</li>
                ))}
              </ul>
              <Link href="/register" className="btn-primary mt-4">{t('choose')}</Link>
            </li>
          ))}
        </ul>
      )}
    </SiteFrame>
  );
}
