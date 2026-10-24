'use client';
import { useInsightsParam } from './InsightsFilterRow';

/** One choice inside a Filter button or toolbar, written to the address (`name=value`); the empty value removes it. Applies on change. */
export function AddressSelect({ name, label, options, allLabel, defaultValue = '', hideLabel = false, className }: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  allLabel?: string;
  defaultValue?: string;
  hideLabel?: boolean;
  className?: string;
}) {
  const [raw, setValue] = useInsightsParam(name);
  const value = raw || defaultValue;
  return <label className={className}><span className={hideLabel ? 'ui-visually-hidden' : undefined}>{label}</span>
    <select className="ui-input" name={name} value={value} onChange={event => setValue(event.currentTarget.value)}>
      {allLabel !== undefined && <option value="">{allLabel}</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}
