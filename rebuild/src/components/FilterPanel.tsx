"use client";
import { IconFilterOff, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { SegmentedControl } from "./Forms";

/** Sidebar filter block: labelled sections, active-filter chips and one reset. Lives in the contextual sidebar, never in the content area. */
export function FilterPanel({ title, children, onReset, resetLabel = "Reset filters", activeCount = 0, summary }: { title: string; children: ReactNode; onReset?: () => void; resetLabel?: string; activeCount?: number; summary?: ReactNode }) {
  return <section className="ui-filter-panel" aria-label={title}>
    <header className="ui-filter-panel__head"><h2>{title}</h2>{activeCount > 0 && <span className="ui-filter-panel__count" aria-label={`${activeCount}`}>{activeCount}</span>}</header>
    {summary}
    <div className="ui-filter-panel__body">{children}</div>
    {onReset && <Button variant="quiet" size="sm" className="ui-filter-panel__reset" leading={<IconFilterOff size={15} stroke={1.75} />} disabled={activeCount === 0} onClick={onReset}>{resetLabel}</Button>}
  </section>;
}

export function FilterSection({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ui-filter-section"><h3>{label}</h3>{children}</div>;
}

export type ActiveFilter = { key: string; label: string; value: string };

/** Removable chips for every active filter; keeps the applied scope visible and lets people undo one filter without a reset. */
export function FilterChips({ filters, onRemove, removeLabel = "Remove filter", label = "Active filters" }: { filters: ActiveFilter[]; onRemove: (key: string) => void; removeLabel?: string; label?: string }) {
  if (!filters.length) return null;
  return <ul className="ui-filter-chips" aria-label={label}>
    {filters.map(filter => <li key={filter.key} className="ui-filter-chip"><span><span className="ui-filter-chip__name">{filter.label}:</span> {filter.value}</span>
      <button type="button" aria-label={`${removeLabel}: ${filter.label} ${filter.value}`} onClick={() => onRemove(filter.key)}><IconX size={13} stroke={2} aria-hidden="true" /></button></li>)}
  </ul>;
}

export type DatePreset = { id: string; label: string };

/** Preset ranges (for example 7 / 28 / 90 days / custom). Presets come from the caller's Root-managed policy. */
export function DatePresets({ presets, value, onChange, legend }: { presets: DatePreset[]; value: string; onChange: (id: string) => void; legend: string }) {
  return <SegmentedControl legend={legend} options={presets.map(preset => ({ value: preset.id, label: preset.label }))} value={value} onChange={onChange} />;
}
