'use client';

import { IconFilterOff } from '@tabler/icons-react';
import { Button, FilterChips } from '@/components';
import { kitCopy, type KitLocale } from './copy';
import styles from './kit.module.css';

export type UrlFilterChip = { key: string; label: string; value: string; removeHref: string };

/**
 * Applied filters as removable chips for server-rendered lists whose filters live in the URL.
 * Each chip carries the address that results from removing it, so there is no filter logic here.
 * Navigation is a plain location change, which keeps the component usable wherever it is rendered.
 */
export function UrlFilterChips({ chips, resetHref, locale = 'en', labels }: { chips: UrlFilterChip[]; resetHref: string; locale?: KitLocale; labels?: { active: string; remove: string; reset: string } }) {
  if (!chips.length) return <span />;
  const copy = kitCopy[locale];
  const go = (href: string) => window.location.assign(href);
  return <div className={styles.chipRow}>
    <FilterChips filters={chips} label={labels?.active ?? copy.activeFilters} removeLabel={labels?.remove ?? copy.removeFilter}
      onRemove={key => { const chip = chips.find(item => item.key === key); if (chip) go(chip.removeHref); }} />
    <Button variant="quiet" size="sm" leading={<IconFilterOff size={15} stroke={1.75} aria-hidden="true" />} onClick={() => go(resetHref)}>{labels?.reset ?? copy.resetFilters}</Button>
  </div>;
}
