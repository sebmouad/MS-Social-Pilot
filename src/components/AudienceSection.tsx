import { getLocale, getTranslations } from 'next-intl/server';

import { BreakdownBars } from '@/components/BreakdownBars';
import { FollowerTrend } from '@/components/FollowerTrend';
import { StatTile } from '@/components/charts/StatTile';
import { audienceGrowthIdentity } from '@/lib/audience-growth-metrics';
import { readAudience, readFollowerTrend } from '@/lib/analytics';
import { countryLabel, genderAgeLabel, languageLabel } from '@/lib/audience-labels';
import { audienceTotal } from '@/lib/audience-total';
import { readAudienceChannels } from '@/lib/channel-figures-data';
import type { PageScope } from '@/lib/page-access';

/** Who the audience is, and how it changed over the window. */
export async function AudienceView({
  targets,
  targetId,
  workspaceId,
  scope,
  instagram,
  includeOther = true,
  from,
  to,
  timeZone,
}: {
  targets?: Array<{ id: string; name: string }>;
  targetId?: string;
  workspaceId?: string;
  scope?: PageScope;
  instagram?: Parameters<typeof readAudienceChannels>[0]['instagram'];
  includeOther?: boolean;
  from: Date;
  to: Date;
  timeZone: string;
}) {
  const t = await getTranslations('analytics');
  const locale = await getLocale();
  const [pages, other] = await Promise.all([
    Promise.all((targets ?? (targetId ? [{ id: targetId, name: '' }] : [])).map(async (target) => ({ ...target, network: 'facebook', audience: await readAudience({ targetId: target.id, from, to }) }))),
    includeOther && workspaceId && scope && instagram ? readAudienceChannels({ workspaceId, scope, instagram }) : Promise.resolve([]),
  ]);
  const audience = audienceTotal(pages, other);
  const single = pages.length === 1 && other.length === 0;
  const trend = single ? await readFollowerTrend({ targetId: pages[0]!.id, from, to, timeZone }) : [];
  const pageAudience = single ? pages[0]!.audience : null;
  const words = {
    women: (age: string) => t('genderWomen', { age }),
    men: (age: string) => t('genderMen', { age }),
    other: (age: string) => t('genderOther', { age }),
  };

  const gained = audienceGrowthIdentity(pageAudience?.addsMetric ?? null, 'gained');
  const lost = audienceGrowthIdentity(pageAudience?.removesMetric ?? null, 'lost');
  const legacy = gained.kind === 'likes' || lost.kind === 'likes';
  const comparableGrowth = single && pageAudience?.addsMetric !== null && pageAudience?.removesMetric !== null && gained.kind === lost.kind;
  const cards = [
    { label: t('fans'), value: audience.fans, definition: t('def.fans') },
    { label: t('followers'), value: audience.followers, definition: t('def.followers') },
    { label: t('talkingAbout'), value: audience.talkingAbout, definition: t('def.talkingAbout') },
    { label: single ? t(gained.labelKey) : t('newFollowers'), value: single ? pageAudience?.adds ?? null : audience.gained, definition: t('def.newFollowers') },
    { label: single ? t(lost.labelKey) : t('lostFollowers'), value: single ? pageAudience?.removes ?? null : audience.lost, definition: t('def.lostFollowers') },
    { label: t('netChange'), value: single ? pageAudience?.net ?? null : audience.net, definition: t(legacy ? 'def.netLikesChange' : 'def.netChange') },
  ];

  return (
    <div className="space-y-6">
      {/* Losing likes is not an achievement, whichever way the arrow points. */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <StatTile
            key={card.label}
            label={card.label}
            value={card.value}
            upIsGood={card.label !== t(lost.labelKey)}
            definition={card.definition}
          />
        ))}
      </section>

      {!single && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold text-slate-900">{t('selectedAudience')}</h2>
          <p className="mt-1 text-xs text-slate-600">{t('audienceCoverage', { covered: audience.followerCoverage, total: audience.selectedCount })}</p>
          <p className="mt-1 text-xs text-slate-600">{t('growthCoverage', { covered: audience.growthCoverage, total: pages.length })}</p>
          <p className="mt-1 text-xs text-slate-600">{t('facebookOnlyMetrics')}</p>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {audience.rows.map((row, index) => (
              <li key={`${row.network}:${row.name}:${index}`} className="flex justify-between gap-3 py-2">
                <span className="truncate">{row.name} <span className="text-slate-500">· {row.network}</span></span>
                <strong className="tabular-nums">{row.followers?.toLocaleString(locale) ?? '—'}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {comparableGrowth && trend.length > 1 && (
        <FollowerTrend
          title={t(legacy ? 'historicalAudienceTrend' : 'followerTrend')}
          description={t(legacy ? 'historicalAudienceTrendHint' : 'followerTrendHint')}
          dateLabel={t('date')}
          gainedLabel={t(gained.labelKey)}
          lostLabel={t(lost.labelKey)}
          netLabel={t('netChange')}
          points={trend}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={Object.keys(audience.byCountry).length > 0 ? 'lg:col-span-2' : undefined}>
        <BreakdownBars
          title={t('byCountry')}
          data={audience.byCountry}
          formatKey={(code) => countryLabel(code, locale)}
          map={{ label: t('mapLabel'), locale }}
        />
        </div>
        {/* Alone on its row once age and language are gone: take the width. */}
        <div
          className={
            Object.keys(audience.byGenderAge).length === 0 && Object.keys(audience.byLocale).length === 0
              ? 'lg:col-span-2'
              : undefined
          }
        >
          <BreakdownBars title={t('byCity')} data={audience.byCity} limit={12} />
        </div>
        {/* Meta withdrew both breakdowns from Page insights. A Page synced
            before then still has a snapshot; otherwise an empty card would
            read as "nobody", so say what happened instead. */}
        {Object.keys(audience.byGenderAge).length > 0 && (
          <BreakdownBars
            title={t('byGenderAge')}
            data={audience.byGenderAge}
            formatKey={(key) => genderAgeLabel(key, words)}
          />
        )}
        {Object.keys(audience.byLocale).length > 0 && (
          <BreakdownBars
            title={t('byLocale')}
            data={audience.byLocale}
            formatKey={(key) => languageLabel(key, locale)}
          />
        )}
      </div>

      <p className="text-xs text-slate-500">
        {t('audienceHint')}
        {(Object.keys(audience.byGenderAge).length === 0 || Object.keys(audience.byLocale).length === 0) &&
          ` ${t('audienceWithdrawn')}`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph edges beyond /insights
