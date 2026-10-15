const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
const abbreviations = new Set(['cpc', 'cpm', 'cpp', 'ctr', 'roas', 'roi', 'id']);

function readable(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').split(/\s+/).filter(Boolean).map(word => abbreviations.has(word.toLowerCase()) ? word.toUpperCase() : `${word[0].toUpperCase()}${word.slice(1)}`).join(' ');
}

function display(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return Number.isFinite(value) ? number.format(value) : String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** Flatten JSON values from a provider without dropping an unrecognized metric. */
export function storedFieldRows(value: unknown): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  function visit(current: unknown, path: string[]) {
    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        if (item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, unknown>).action_type === 'string') {
          const action = item as Record<string, unknown>;
          const label = readable(action.action_type as string);
          if ('value' in action) rows.push({ label: [...path, label].join(' · '), value: display(action.value) });
          Object.entries(action).filter(([key]) => key !== 'action_type' && key !== 'value').forEach(([key, nested]) => visit(nested, [...path, label, readable(key)]));
        } else visit(item, [...path, `Item ${index + 1}`]);
      });
    } else if (current && typeof current === 'object') {
      Object.entries(current).forEach(([key, nested]) => visit(nested, [...path, readable(key)]));
    } else {
      rows.push({ label: path.join(' · ') || 'Value', value: display(current) });
    }
  }
  visit(value, []);
  return rows;
}

export function StoredFields({ actions, fields }: { actions: unknown; fields: unknown }) {
  const groups = [
    { title: 'Daily actions', rows: storedFieldRows(actions) },
    { title: 'Additional measures', rows: storedFieldRows(fields) },
  ];
  return <>{groups.map(group => <div className="ads-field-group" key={group.title}><h5>{group.title}</h5>{group.rows.length ? <dl>{group.rows.map((row, index) => <div key={`${row.label}:${index}`}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl> : <p>No additional values stored.</p>}</div>)}</>;
}
