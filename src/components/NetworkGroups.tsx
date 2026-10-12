'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { groupByNetwork } from '@/lib/selection';

import { NetworkMark } from './NetworkMark';

/**
 * A list of channels split by platform — Facebook, Instagram, LinkedIn… —
 * with a heading for each, once there is more than one platform. With one,
 * it is the plain list.
 */
export function NetworkGroups<T extends { type: string }>({
  items,
  as: List = 'ul',
  className = '',
  children,
}: {
  items: T[];
  as?: 'ul' | 'div';
  className?: string;
  children: (item: T) => ReactNode;
}) {
  const t = useTranslations('profileScope');
  const groups = groupByNetwork(items);
  if (groups.length < 2) return <List className={className}>{items.map(children)}</List>;
  return (
    <>
      {groups.map((group) => (
        <section key={group.network} aria-label={t(`network.${group.network}`)} className="pt-1 first:pt-0">
          <h3 className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-semibold text-slate-500">
            <NetworkMark network={group.network === 'facebook' ? 'page' : group.network} size={14} />
            {t(`network.${group.network}`)}
            <span className="nums font-normal">{group.items.length}</span>
          </h3>
          <List className={className}>{group.items.map(children)}</List>
        </section>
      ))}
    </>
  );
}
