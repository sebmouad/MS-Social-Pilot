'use client';
import { usePublishingCopy } from '../kit/CopyProvider';

import { useRouter } from 'next/navigation';
import { IconLayoutGrid, IconLayoutList, IconTable } from '@tabler/icons-react';
import { SegmentedControl } from '@/components';
import { type KitLocale } from '../kit/copy';

export type PostsView = 'table' | 'feed' | 'cards';

/** Table, Feed or Cards. Each choice is a ready-made address so filters and the page language carry over. */
export function PostsViewSwitch({ value, hrefs, locale = 'en' }: { value: PostsView; hrefs: Record<PostsView, string>; locale?: KitLocale }) {
  const router = useRouter();
  const copy = usePublishingCopy(locale);
  return <SegmentedControl legend={copy.viewLabel} value={value} onChange={next => router.push(hrefs[next as PostsView])}
    options={[
      { value: 'table', label: copy.viewTable, icon: <IconTable size={15} /> },
      { value: 'feed', label: copy.viewFeed, icon: <IconLayoutList size={15} /> },
      { value: 'cards', label: copy.viewCards, icon: <IconLayoutGrid size={15} /> },
    ]} />;
}
