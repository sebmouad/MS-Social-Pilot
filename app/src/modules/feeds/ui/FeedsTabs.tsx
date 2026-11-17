'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Tabs } from '@/components/Tabs';

/**
 * Recipes and the other feeds each get the page to themselves (2026-11-17). Both stay mounted, so a half-filled form
 * survives a look at the other tab; an address ending in `#feeds` opens the feed list.
 */
export function FeedsTabs({ label, recipesLabel, feedsLabel, feedCount, initial, recipes, feeds }: { label: string; recipesLabel: string; feedsLabel: string; feedCount: number; initial: 'recipes' | 'feeds'; recipes: ReactNode; feeds: ReactNode }) {
  const [tab, setTab] = useState<string>(initial);
  useEffect(() => { const hash = window.location.hash; if (hash === '#feeds') setTab('feeds'); else if (hash) setTab('recipes'); }, []);
  return <>
    <Tabs label={label} value={tab} onChange={setTab} items={[{ id: 'recipes', label: recipesLabel }, { id: 'feeds', label: feedsLabel, count: feedCount }]} />
    <div hidden={tab !== 'recipes'} style={{ display: tab === 'recipes' ? 'grid' : undefined, gap: '1rem', minWidth: 0 }}>{recipes}</div>
    <div hidden={tab !== 'feeds'}>{feeds}</div>
  </>;
}
