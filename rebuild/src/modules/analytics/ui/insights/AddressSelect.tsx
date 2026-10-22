'use client';
import { useInsightsParam } from './InsightsFilterRow';

/** One choice inside a Filter button, written to the address (`name=value`); the empty value removes it. Applies on change. */
export function AddressSelect({ name, label, options, allLabel }: { name: string; label: string; options: Array<{ value: string; label: string }>; allLabel: string }) {
  const [value, setValue] = useInsightsParam(name);
  return <label>{label}
    <select className="ui-input" name={name} value={value} onChange={event => setValue(event.currentTarget.value)}>
      <option value="">{allLabel}</option>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}
