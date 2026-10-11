import { getLocale, getTranslations } from 'next-intl/server';

import { BreakdownBars } from '@/components/BreakdownBars';
import { FollowerTrend } from '@/components/FollowerTrend';
import { StatTile } from '@/components/charts/StatTile';
import { readAudience, readFollowerTrend } from '@/lib/analytics';
import { countryLabel, genderAgeLabel, languageLabel } from '@/lib/audience-labels';

/** Who the audience is, and how it changed over the window. */
export async function AudienceView({
  targetId,
  from,
  to,
  timeZone,
}: {
  targetId: string;
  from: Date;
  to: Date;
  timeZone: string;
}) {
  const t = await getTranslations('analytics');
  const locale = await getLocale();
  const [audience, trend] = await Promise.all([
    readAudience({ targetId, from, to }),
    readFollowerTrend({ targetId, from, to, timeZone }),
  ]);
  const words = {
    women: (age: string) => t('genderWomen', { age }),
    men: (age: string) => t('genderMen', { age }),
    other: (age: string) => t('genderOther', { age }),
  };

  const cards = [
    { label: t('fans'), value: audience.fans, definition: t('def.fans') },
    { label: t('followers'), value: audience.followers, definition: t('def.followers') },
    { label: t('talkingAbout'), value: audience.talkingAbout, definition: t('def.talkingAbout') },
    { label: t('newLikes'), value: audience.adds, definition: t('def.newLikes') },
    { label: t('lostLikes'), value: audience.removes, definition: t('def.lostLikes') },
    { label: t('netChange'), value: audience.net, definition: t('def.netChange') },
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
            upIsGood={card.label !== t('lostLikes')}
            definition={card.definition}
          />
        ))}
      </section>

      {trend.length > 1 && (
        <FollowerTrend
          title={t('followerTrend')}
          description={t('followerTrendHint')}
          dateLabel={t('date')}
          gainedLabel={t('newFollowers')}
          lostLabel={t('lostFollowers')}
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
        <BreakdownBars title={t('byCity')} data={audience.byCity} />
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
