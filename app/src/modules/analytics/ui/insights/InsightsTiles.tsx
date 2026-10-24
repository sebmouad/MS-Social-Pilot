'use client';
import { useState } from 'react';
import { InfoTip, MetricCard, type InfoBlock, type MetricDelta } from '@/components';
import './insights.css';

export type InsightsTile = {
  id: string;
  label: string;
  value: string;
  /** Explanation shown instead of the number when nothing is stored: unknown, never zero. */
  unavailable?: string;
  delta?: MetricDelta;
  sparkline?: Array<number | null>;
  /** Everything that qualifies the number: period, coverage, missing data, overlap. Partial coverage sets `partial`. */
  info: InfoBlock[];
  partial: boolean;
};

/**
 * The key numbers of the Overview (design v2 S9): four tiles, then pinned metrics. Each caveat sits behind its ⓘ,
 * which turns into ⚠ when coverage is partial. Tiles beyond `visible` wait behind "Show all".
 */
export function InsightsTiles({ tiles, visible, labels }: { tiles: InsightsTile[]; visible: number; labels: { group: string; showAll: string; showLess: string } }) {
  const [all, setAll] = useState(false);
  const shown = all ? tiles : tiles.slice(0, visible);
  return <section aria-label={labels.group}>
    <ul className="insights-tiles">
      {shown.map(tile => <li key={tile.id}>
        <MetricCard module="analytics" label={tile.label} value={tile.value} unavailable={tile.unavailable} delta={tile.delta} sparkline={tile.sparkline}
          info={tile.info.length ? <InfoTip name={tile.label} blocks={tile.info} warning={tile.partial} /> : undefined} />
      </li>)}
    </ul>
    {tiles.length > visible && <button type="button" className="ui-button ui-button--quiet ui-button--sm insights-tiles__more" aria-expanded={all} onClick={() => setAll(value => !value)}>
      {all ? labels.showLess : labels.showAll.replace('{count}', String(tiles.length))}
    </button>}
  </section>;
}
