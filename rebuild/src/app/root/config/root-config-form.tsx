'use client';

import { useState } from 'react';
import type { AVAILABILITY_CATALOG, safeConfigShape } from '@/lib/config/registry';

type Definition = ReturnType<typeof safeConfigShape>[number];
type Values = Array<{ key: string; value: unknown; isSet: boolean; source: string }>;
type Catalog = typeof AVAILABILITY_CATALOG;

export function RootConfigForm({ definitions, initialValues, availability }: { definitions: Definition[]; initialValues: Values; availability: Catalog }) {
  const [values, setValues] = useState(initialValues);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  async function save(key: string, value: unknown) {
    setMessage('Saving…');
    const response = await fetch('/api/root/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value }) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error || 'Save failed.'); return; }
    setValues(result.values);
    setInputs((current) => ({ ...current, [key]: '' }));
    setMessage('Saved.');
  }

  async function clearSecret(key: string) {
    setMessage('Clearing…');
    const response = await fetch('/api/root/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value: '', clear: true }) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error || 'Clear failed.'); return; }
    setValues(result.values);
    setMessage('Saved secret cleared.');
  }

  return <>
    {message && <p className="root-config__status" role="status" aria-live="polite">{message}</p>}
    {definitions.map((definition) => {
      const current = values.find((item) => item.key === definition.key);
      return <section className="root-config__card" key={definition.key}>
        <div className="root-config__group">{definition.group} · <code>{definition.key}</code></div>
        <h2>{definition.label}</h2>
        <p>{definition.description}</p>
        {definition.kind === 'boolean' ? <label><input type="checkbox" checked={Boolean(current?.value)} onChange={(event) => void save(definition.key, event.target.checked)} /> Enabled</label> : <div className="root-config__controls">
          <input aria-label={definition.label} type={definition.kind === 'secret' ? 'password' : definition.kind === 'number' ? 'number' : 'text'} autoComplete="off" placeholder={definition.kind === 'secret' ? (current?.isSet ? 'Saved value hidden' : 'Enter secret') : String(current?.value ?? '')} value={inputs[definition.key] ?? ''} onChange={(event) => setInputs((old) => ({ ...old, [definition.key]: event.target.value }))} />
          <button type="button" onClick={() => void save(definition.key, definition.kind === 'number' ? Number(inputs[definition.key]) : inputs[definition.key] ?? '')}>Save</button>
          {definition.kind === 'secret' && <button type="button" onClick={() => void clearSecret(definition.key)}>Clear saved secret</button>}
        </div>}
        <small>Source: {current?.source ?? 'default'}{definition.kind === 'secret' && current?.isSet ? ' · saved value is concealed' : ''}</small>
      </section>;
    })}
    <section className="root-config__catalog">
      <h2>Generated module and feature availability</h2>
      <p>Entries come from the rebuild product catalog. Availability controls are not persisted or enforced in this slice.</p>
      <h3>Modules</h3><ul>{availability.modules.map((module) => <li key={module.id}>{module.title} <code>{module.id}</code></li>)}</ul>
      <h3>Features</h3><ul>{availability.features.map((feature) => <li key={feature.id}>{feature.title} <code>{feature.id}</code> · {feature.module}</li>)}</ul>
    </section>
  </>;
}
