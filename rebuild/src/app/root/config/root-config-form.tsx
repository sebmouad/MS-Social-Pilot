'use client';
import { ROOT_CONFIG_COPY, configCopyText, type RootConfigCopy } from '@/lib/config/root-config-copy';
import { AutoTextarea } from '@/components/AutoTextarea';

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconSearch, IconSettings, IconDeviceFloppy, IconTrash } from '@tabler/icons-react';
import { Field, TextInput, Switch, useFieldProps } from '@/components/Forms';
import { Select } from '@/components/Select';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { FilterPanel, FilterChips } from '@/components/FilterPanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components';
import { useToast } from '@/components/Toast';
import { ROOT_INTERFACE_COPY, type RootInterfaceCopy } from '@/lib/config/root-interface-copy';
import { ConfigHistory } from './ConfigHistory';
import { SidebarDock } from '@/components/SidebarDock';
import type { AVAILABILITY_CATALOG, safeConfigShape } from '@/lib/config/registry';

type Definition = ReturnType<typeof safeConfigShape>[number];
type Values = Array<{ key: string; value: unknown; isSet: boolean; source: string }>;
type Catalog = typeof AVAILABILITY_CATALOG;

export function RootConfigForm({ definitions, initialValues, availability, groupPrefix, initialSearch = '', groupByOwner = false, copy = ROOT_CONFIG_COPY, interfaceCopy = ROOT_INTERFACE_COPY.en, searchMaxCharacters, hideInventory = false }: { definitions: Definition[]; initialValues: Values; availability: Catalog; groupPrefix?: string; initialSearch?: string; groupByOwner?: boolean; copy?: RootConfigCopy; interfaceCopy?: RootInterfaceCopy; searchMaxCharacters?: number; hideInventory?: boolean }) {
  const toast = useToast();
  const errorsRef = useRef<HTMLDivElement>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [clearKey, setClearKey] = useState<string | null>(null);
  const toastIds = useRef(new Map<string, number>());
  const [values, setValues] = useState(initialValues);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, setPending] = useState<Record<string, 'save' | 'clear'>>({});
  const inFlight = useRef(new Set<string>());
  const categoryName = (item: Definition) => (groupPrefix && item.group.startsWith(`${groupPrefix} · `) ? item.group.slice(groupPrefix.length + 3) : item.group).split(' · ')[0];
  const ownerName = (item: Definition) => item.owner.kind === 'shared' ? copy.shared : `${copy[item.owner.kind]} · ${item.owner.id}`;
  const categoryFor = (item: Definition) => groupByOwner ? `${ownerName(item)} · ${categoryName(item)}` : categoryName(item);
  const ownerOrder = { shared: 0, product: 1, platform: 2 };
  const ordered = groupByOwner ? [...definitions].sort((a, b) => ownerOrder[a.owner.kind] - ownerOrder[b.owner.kind] || ownerName(a).localeCompare(ownerName(b)) || categoryName(a).localeCompare(categoryName(b))) : definitions;
  const sections = Array.from(new Set(ordered.map(categoryFor)));
  const [section, setSection] = useState(sections[0] ?? '');
  const [search, setSearch] = useState(initialSearch);
  const hasDrafts = Object.keys(inputs).length > 0;
  useEffect(() => {
    if (!hasDrafts) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDrafts]);
  // Search metadata only: never include saved values or secret drafts.
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const searchIndex = useMemo(() => new Map(definitions.map(item => [item.key,
    normalize(`${item.label} ${item.key} ${item.description} ${item.group} ${item.owner.kind === 'shared' ? copy.shared : `${copy[item.owner.kind]} · ${item.owner.id}`}`),
  ])), [definitions, copy]);
  const terms = normalize(search).trim().split(/\s+/).filter(Boolean);
  const visible = definitions.filter((item) => {
    if (terms.length) {
      const metadata = searchIndex.get(item.key) ?? '';
      return terms.every(term => metadata.includes(term));
    }
    return categoryFor(item) === section;
  });

  async function write(key: string, operation: 'save' | 'clear', value: unknown) {
    if (inFlight.current.has(key)) return copy.saving;
    const oldToast = toastIds.current.get(key);
    if (oldToast !== undefined) toast.dismiss(oldToast);
    const failure = (text: string) => {
      setMessage({ text, error: true });
      setFieldErrors(current => ({ ...current, [key]: text }));
      toastIds.current.set(key, toast.failed(text, () => {
        // Keep mutation retry deliberate and in context, including after an uncertain response.
        const card = [...(errorsRef.current?.querySelectorAll<HTMLElement>('[data-setting]') ?? [])].find(item => item.dataset.setting === key);
        card?.scrollIntoView?.({ block: 'nearest' });
        card?.querySelector<HTMLElement>('input,textarea,[role=combobox],[role=switch],button')?.focus();
      }, interfaceCopy.retry));
      return text;
    };
    inFlight.current.add(key);
    setPending((current) => ({ ...current, [key]: operation }));
    setFieldErrors(current => { const next = { ...current }; delete next[key]; return next; });
    setMessage({ text: operation === 'save' ? copy.saving : copy.clearing, error: false });
    try {
      const response = await fetch('/api/root/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value, confirmation: `${operation === 'clear' ? 'CLEAR ROOT SECRET' : 'SET ROOT CONFIG'} ${key}`, ...(operation === 'clear' ? { clear: true } : {}) }) });
      const result = await response.json() as { error?: unknown; values?: unknown };
      if (!response.ok) {
        return failure(typeof result.error === 'string' && result.error ? result.error : (operation === 'save' ? copy.saveFailure : copy.clearFailure));
      }
      if (response.redirected || !Array.isArray(result.values) || !result.values.every(item => item && typeof item === 'object' && typeof item.key === 'string' && typeof item.isSet === 'boolean' && typeof item.source === 'string') || !result.values.some(item => item.key === key)) throw new Error(copy.invalidResponse);
      setValues(result.values as Values);
      setInputs((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      const text = operation === 'save' ? copy.saved : copy.cleared;
      setMessage({ text, error: false });
      toast.notify({ title: text, tone: 'success' });
      return null;
    } catch {
      return failure(operation === 'save' ? copy.saveFailure : copy.clearFailure);
    } finally {
      inFlight.current.delete(key);
      setPending((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  return <div className="root-config__layout">
    <SidebarDock><aside className="root-config__sidebar" aria-label={copy.sectionsLabel}><FilterPanel title={copy.sectionsLabel} activeCount={search.trim() ? 1 : 0} onReset={() => setSearch('')} resetLabel={interfaceCopy.reset}>
      <label htmlFor="root-config-search">{copy.find}</label>
      <TextInput leading={<IconSearch size={18} />} id="root-config-search" name="settings-search" autoComplete="off" aria-controls="root-config-results" type="search" maxLength={searchMaxCharacters} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.searchPlaceholder} />
      <nav aria-label={copy.categoriesLabel}>
        {sections.map((name) => <button key={name} type="button" className={!search && section === name ? 'is-active' : ''} aria-current={!search && section === name ? 'page' : undefined} onClick={() => { setSection(name); setSearch(''); }}>{name}</button>)}
      </nav>
    </FilterPanel></aside></SidebarDock>
    <div className="root-config__content" ref={errorsRef}>
    <FilterChips filters={search.trim() ? [{ key: 'search', label: interfaceCopy.search, value: search }] : []} onRemove={() => setSearch('')} label={interfaceCopy.filters} removeLabel={interfaceCopy.removeFilter} />
    <ConfigHistory copy={interfaceCopy} />
    <div className="root-config__content-head" id="root-config-results"><h2>{search ? configCopyText(copy.searchResults, { search }) : section}</h2><span aria-live="polite" aria-atomic="true">{configCopyText(copy.count, { count: visible.length })}</span></div>
    {message && <p className="root-config__status" role={message.error ? 'alert' : 'status'} aria-live={message.error ? 'assertive' : 'polite'}>{message.text}</p>}
    {visible.length === 0 && <div className="root-config__empty"><EmptyState title={copy.empty} icon={<IconSettings />} action={<Button onClick={() => setSearch('')}>{interfaceCopy.reset}</Button>} /></div>}
    {visible.map((definition) => {
      const current = values.find((item) => item.key === definition.key);
      const isPending = Boolean(pending[definition.key]);
      return <section className="root-config__card" key={definition.key} data-setting={definition.key}>
        <div className="root-config__group">{groupByOwner ? `${ownerName(definition)} · ` : ''}{definition.group} · <code>{definition.key}</code></div>
        <h2>{definition.label}</h2>
        <p>{definition.description}</p>
        {definition.kind === 'boolean' ? <Switch label={definition.label} disabled={isPending} checked={Boolean(current?.value)} onChange={checked => void write(definition.key, 'save', checked)} /> : <Field label={definition.label} error={fieldErrors[definition.key]}>
          <div className="root-config__controls">
          {definition.kind === 'select' ? <SettingSelect label={definition.label} disabled={isPending} value={String(current?.value ?? definition.defaultValue)} options={[...(definition.options ?? [])]} onChange={value => void write(definition.key, 'save', value)} />
            : definition.kind === 'json' ? <SettingJson label={definition.label} disabled={isPending} value={inputs[definition.key] ?? JSON.stringify(current?.value ?? definition.defaultValue, null, 2)} onChange={value => setInputs(old => ({ ...old, [definition.key]: value }))} />
            : <TextInput aria-label={definition.label} disabled={isPending} aria-busy={isPending || undefined} type={definition.kind === 'secret' ? 'password' : definition.kind === 'number' ? 'number' : 'text'} step={definition.kind === 'number' ? 'any' : undefined} autoComplete="off" placeholder={definition.kind === 'secret' ? (current?.isSet ? copy.hidden : copy.enterSecret) : undefined} value={inputs[definition.key] ?? (definition.kind === 'secret' ? '' : String(current?.value ?? definition.defaultValue))} onChange={event => setInputs(old => ({ ...old, [definition.key]: event.target.value }))} />}
          {definition.kind !== 'select' && <Button leading={<IconDeviceFloppy size={16} />} disabled={isPending} busy={pending[definition.key] === 'save'} onClick={() => {
            let value: unknown = inputs[definition.key] ?? (definition.kind === 'secret' ? '' : current?.value ?? definition.defaultValue);
            let error = '';
            if (definition.kind === 'number') {
              if (String(value).trim() === '' || !Number.isFinite(Number(value))) error = configCopyText(interfaceCopy.invalidNumber, { label: definition.label });
              else value = Number(value);
            }
            if (definition.kind === 'json') {
              try { value = JSON.parse(String(value)); }
              catch { error = configCopyText(copy.invalidJson, { label: definition.label }); }
            }
            if (error) {
              setFieldErrors(old => ({ ...old, [definition.key]: error })); setMessage({ text: error, error: true });
              const card = [...(errorsRef.current?.querySelectorAll<HTMLElement>('[data-setting]') ?? [])].find(item => item.dataset.setting === definition.key);
              card?.querySelector<HTMLElement>('input,textarea')?.focus();
              return;
            }
            void write(definition.key, 'save', value);
          }}>{copy.save}</Button>}
          {definition.kind === 'secret' && <Button variant="danger" leading={<IconTrash size={16} />} disabled={isPending || !current?.isSet} onClick={() => setClearKey(definition.key)}>{copy.clearSecret}</Button>}
          </div>
        </Field>}
        <small>{copy.source} {current?.source === 'database' ? copy.databaseSource : copy.defaultSource} · <Badge tone={definition.consumption === 'active' ? 'success' : 'warning'}>{definition.consumption === 'active' ? copy.active : definition.consumption === 'configured' ? copy.configured : copy.planned}</Badge>{definition.kind === 'secret' && current?.isSet ? ` · ${copy.concealed}` : ''}</small>
      </section>;
    })}
    {!hideInventory && !search && visible.some(item => item.key.startsWith('entitlements.')) && <section className="root-config__catalog">
      <h2>{copy.inventory}</h2>
      <p>{copy.inventoryDescription}</p>
      <h3>{copy.modules}</h3><ul>{availability.modules.map((module) => <li key={module.id}>{module.title} <code>{module.id}</code></li>)}</ul>
      <h3>{copy.features}</h3><ul>{availability.features.map((feature) => <li key={feature.id}>{feature.title} <code>{feature.id}</code> · {feature.module}</li>)}</ul>
    </section>}
    </div>
    <ConfirmDialog open={clearKey !== null} title={interfaceCopy.clearTitle} objectName={definitions.find(item => item.key === clearKey)?.label ?? ''} consequence={interfaceCopy.clearConsequence} confirmLabel={copy.clearSecret} cancelLabel={interfaceCopy.cancel} pendingLabel={copy.clearing} failureLabel={copy.clearFailure} onConfirm={() => clearKey ? write(clearKey, 'clear', '') : copy.clearFailure} onClose={() => setClearKey(null)} />
  </div>;
}

function SettingSelect({ label, ...props }: { label: string; disabled: boolean; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const field = useFieldProps();
  return <Select {...props} id={field.id} aria-label={label} invalid={field['aria-invalid']} describedBy={field['aria-describedby']} />;
}
function SettingJson({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const field = useFieldProps();
  return <AutoTextarea {...field} className="ui-input" aria-label={label} disabled={disabled} rows={4} value={value} onChange={event => onChange(event.target.value)} />;
}
