import { getTranslations } from 'next-intl/server';

import { ExternalLink } from '@/components/ExternalLink';
import { NetworkMark } from '@/components/NetworkMark';
import { totalChannels } from '@/lib/channel-figures';
import { readChannelFigures } from '@/lib/channel-figures-data';
import type { PageScope } from '@/lib/page-access';
import { appLocale, formatInZone } from '@/lib/time';

/**
 * Instagram and other-network channels in the selection, under the Page
 * figures of Summary, Posts, Audience and Compare. A figure a network does
 * not report shows a dash. Nothing is drawn when the selection has none.
 */
export async function ChannelFiguresSection({
  view,
  workspaceId,
  scope,
  from,
  to,
  timezone,
}: {
  view: 'summary' | 'posts' | 'audience' | 'compare';
  workspaceId: string;
  scope: PageScope;
  from: Date;
  to: Date;
  timezone: string;
}) {
  const { channels, posts } = await readChannelFigures({ workspaceId, scope, from, to });
  if (channels.length === 0) return null;
  const t = await getTranslations('channelFigures');
  const number = (value: number | null) => (value === null ? '—' : value.toLocaleString(appLocale()));
  const percent = (value: number | null) => (value === null ? '—' : `${value.toLocaleString(appLocale())}%`);
  const label = (network: string, name: string) => (
    <span className="inline-flex items-center gap-2">
      <NetworkMark network={network} size={18} />
      <span className="truncate">{name}</span>
    </span>
  );

  if (view === 'posts') {
    if (posts.length === 0) return null;
    return (
      <section aria-label={t('postsTitle')} className="space-y-2">
        <h2 className="text-[17px] font-bold text-slate-900">{t('postsTitle')}</h2>
        <div className="card scroll-x">
          <table className="data-table w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                <th className="px-4 py-3">{t('post')}</th>
                <th className="px-4 py-3">{t('channel')}</th>
                <th className="px-4 py-3 text-end">{t('reach')}</th>
                <th className="px-4 py-3 text-end">{t('impressions')}</th>
                <th className="px-4 py-3 text-end">{t('interactions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {posts.map((post) => (
                <tr key={post.key}>
                  <td className="max-w-[320px] px-4 py-2.5">
                    <p className="truncate text-slate-900">{post.message || t('noText')}</p>
                    <p className="text-xs text-slate-500">
                      {formatInZone(post.publishedAt, timezone)}
                      {post.url && (
                        <>
                          {' · '}
                          <ExternalLink href={post.url} className="font-semibold text-brand-600 hover:underline">{t('open')}</ExternalLink>
                        </>
                      )}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{label(post.network, post.channel)}</td>
                  <td className="px-4 py-2.5 text-end">{number(post.reach)}</td>
                  <td className="px-4 py-2.5 text-end">{number(post.impressions)}</td>
                  <td className="px-4 py-2.5 text-end">{number(post.interactions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">{t('note')}</p>
      </section>
    );
  }

  if (view === 'audience') {
    return (
      <section aria-label={t('audienceTitle')} className="space-y-2">
        <h2 className="text-[17px] font-bold text-slate-900">{t('audienceTitle')}</h2>
        <div className="card scroll-x">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th className="px-4 py-3">{t('channel')}</th>
                <th className="px-4 py-3 text-end">{t('followers')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {channels.map((channel) => (
                <tr key={channel.key}>
                  <td className="px-4 py-2.5">{label(channel.network, channel.name)}</td>
                  <td className="px-4 py-2.5 text-end">{number(channel.followers)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">{t('note')}</p>
      </section>
    );
  }

  const total = view === 'summary' && channels.length > 1 ? totalChannels(channels) : null;
  return (
    <section aria-label={t('title')} className="space-y-2">
      <h2 className="text-[17px] font-bold text-slate-900">{t('title')}</h2>
      <div className="card scroll-x">
        <table className="data-table w-full min-w-[720px] text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3">{t('channel')}</th>
              <th className="px-4 py-3 text-end">{t('followers')}</th>
              <th className="px-4 py-3 text-end">{t('posts')}</th>
              <th className="px-4 py-3 text-end">{t('reach')}</th>
              <th className="px-4 py-3 text-end">{t('impressions')}</th>
              <th className="px-4 py-3 text-end">{t('interactions')}</th>
              <th className="px-4 py-3 text-end">{t('engagementRate')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {channels.map((channel) => (
              <tr key={channel.key}>
                <td className="px-4 py-2.5">{label(channel.network, channel.name)}</td>
                <td className="px-4 py-2.5 text-end">{number(channel.followers)}</td>
                <td className="px-4 py-2.5 text-end">{number(channel.posts)}</td>
                <td className="px-4 py-2.5 text-end">{number(channel.reach)}</td>
                <td className="px-4 py-2.5 text-end">{number(channel.impressions)}</td>
                <td className="px-4 py-2.5 text-end">{number(channel.interactions)}</td>
                <td className="px-4 py-2.5 text-end">{percent(channel.engagementRate)}</td>
              </tr>
            ))}
            {total && (
              <tr className="font-semibold">
                <td className="px-4 py-2.5">{t('total')}</td>
                <td className="px-4 py-2.5 text-end">{number(total.followers)}</td>
                <td className="px-4 py-2.5 text-end">{number(total.posts)}</td>
                <td className="px-4 py-2.5 text-end">{number(total.reach)}</td>
                <td className="px-4 py-2.5 text-end">{number(total.impressions)}</td>
                <td className="px-4 py-2.5 text-end">{number(total.interactions)}</td>
                <td className="px-4 py-2.5 text-end">{percent(total.engagementRate)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{t('note')}</p>
    </section>
  );
}
