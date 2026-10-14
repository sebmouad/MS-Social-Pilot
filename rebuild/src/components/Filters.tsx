"use client";
import type { ReactNode } from "react";
import { Button } from "./Button";

export type FilterChoice = { label: string; value: string };
export function FilterSelect({ label, value, choices, onChange }: { label: string; value: string; choices: FilterChoice[]; onChange: (value: string) => void }) {
  return <label className="ui-filter"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}>{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label>;
}
export function FilterBar({ children, onReset, resetLabel = "Clear filters" }: { children: ReactNode; onReset?: () => void; resetLabel?: string }) {
  return <div className="ui-filterbar"><div className="ui-filterbar__fields">{children}</div>{onReset && <Button size="sm" variant="quiet" onClick={onReset}>{resetLabel}</Button>}</div>;
}
