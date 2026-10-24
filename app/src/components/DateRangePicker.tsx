"use client";
import { IconCalendar, IconChevronDown } from "@tabler/icons-react";
import { useCallback, useId, useRef, useState } from "react";
import { Button } from "./Button";
import { Popover } from "./Popover";
import { useShellCopy } from "./ShellCopy";

export type DateRangePreset = { id: string; label: string };
export type DateRangeValue = { preset: string; from?: string; to?: string };

type DateRangePickerProps = {
  /** Presets come from the owning module's Root policy (for example 7, 28 and 90 days, this month). */
  presets: DateRangePreset[];
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  /** Allow a custom from/to range. */
  custom?: boolean;
  /** Text of the trigger when the preset is custom, for example "Oct 1 – Oct 21". */
  customSummary?: string;
  label?: string;
  compare?: { checked: boolean; onChange: (checked: boolean) => void; label: string };
};

/** "Last 28 days ▾": preset list, an optional custom range and an optional compare toggle in one popover. */
export function DateRangePicker({ presets, value, onChange, custom = true, customSummary, label, compare }: DateRangePickerProps) {
  const copy = useShellCopy();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from ?? "");
  const [to, setTo] = useState(value.to ?? "");
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback((restore: boolean) => { setOpen(false); if (restore) ref.current?.focus(); }, []);
  const current = presets.find(preset => preset.id === value.preset);
  const summary = current?.label ?? customSummary ?? copy.dateCustom;
  const valid = Boolean(from && to && from <= to);
  return <>
    <button ref={ref} type="button" className="ui-daterange" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={`${label ?? copy.dateRange}: ${summary}`} onClick={() => setOpen(next => !next)}>
      <IconCalendar size={16} stroke={1.9} aria-hidden="true" /><span>{summary}</span><IconChevronDown size={15} stroke={2} aria-hidden="true" />
    </button>
    <Popover open={open} anchorRef={ref} onClose={close} sheetOnPhone className="ui-daterange__pop" role="dialog" id={id} label={label ?? copy.dateRange}>
      <ul className="ui-daterange__presets">
        {presets.map(preset => <li key={preset.id}><button type="button" aria-pressed={preset.id === value.preset} className={`ui-daterange__preset${preset.id === value.preset ? " is-selected" : ""}`} onClick={() => { onChange({ preset: preset.id }); close(true); }}>{preset.label}</button></li>)}
      </ul>
      {custom && <fieldset className="ui-daterange__custom">
        <legend>{copy.dateCustom}</legend>
        <label><span>{copy.dateFrom}</span><input type="date" className="ui-input" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} /></label>
        <label><span>{copy.dateTo}</span><input type="date" className="ui-input" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /></label>
        <Button variant="primary" size="sm" disabled={!valid} onClick={() => { onChange({ preset: "custom", from, to }); close(true); }}>{copy.dateApply}</Button>
      </fieldset>}
      {compare && <label className="ui-daterange__compare"><input type="checkbox" checked={compare.checked} onChange={event => compare.onChange(event.target.checked)} /><span>{compare.label}</span></label>}
    </Popover>
  </>;
}
