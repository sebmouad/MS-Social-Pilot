'use client';
import { ROOT_CONFIG_COPY, configCopyText, type RootConfigCopy } from '@/lib/config/root-config-copy';
import { AutoTextarea } from '@/components/AutoTextarea';

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconSearch, IconSettings, IconDeviceFloppy, IconTrash } from '@tabler/icons-react';
import { Field, TextInput, Switch, useFieldProps } from '@/components/Forms';
import { Select } from '@/components/Select';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components';
import { useToast } from '@/components/Toast';
import { ROOT_INTERFACE_COPY, type RootInterfaceCopy } from '@/lib/config/root-interface-copy';
import { ConfigHistory } from './ConfigHistory';
import type { AVAILABILITY_CATALOG, safeConfigShape } from '@/lib/config/registry';

type Definition = ReturnType<typeof safeConfigShape>[number];
type Values = Array<{ key: string; value: unknown; isSet: boolean; source: string }>;
type Catalog = typeof AVAILABILITY_CATALOG;
const SEARCH_LIMIT = 60;

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
  // Wording saved in Root before a release lacks that release's new labels.
  const text = { ...ROOT_CONFIG_COPY, ...copy };
  // "/" jumps to the search box, and the address follows the search so a result can be linked.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, textarea, select, [contenteditable=true]')) return;
      event.preventDefault();
      document.getElementById('root-config-search')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (search.trim()) url.searchParams.set('search', search.trim()); else url.searchParams.delete('search');
    url.searchParams.delete('q');
    window.history.replaceState(window.history.state, '', url);
  }, [search]);
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

  // Sections grouped by their owner, each with its number of settings, for the side list and the phone picker.
  const sectionCounts = new Map<string, number>();
  const navGroups: Array<{ owner: string; items: Array<{ name: string; label: string }> }> = [];
  for (const item of ordered) {
    const name = categoryFor(item);
    sectionCounts.set(name, (sectionCounts.get(name) ?? 0) + 1);
    const owner = groupByOwner ? ownerName(item) : '';
    let group = navGroups.find(entry => entry.owner === owner);
    if (!group) { group = { owner, items: [] }; navGroups.push(group); }
    if (!group.items.some(entry => entry.name === name)) group.items.push({ name, label: categoryName(item) });
  }
  // A broad search can match hundreds of settings; the first ones are enough to see that it should be narrowed.
  // Best matches first: every word in the name, then in the key, then anywhere else.
  const rank = (item: Definition) => terms.every(term => normalize(item.label).includes(term)) ? 0 : terms.every(term => normalize(item.key).includes(term)) ? 1 : 2;
  const shown = terms.length ? [...visible].sort((a, b) => rank(a) - rank(b)).slice(0, SEARCH_LIMIT) : visible;
  const pick = (name: string) => { setSection(name); setSearch(''); };

  return <div className="root-config__layout">
    <div className="root-config__toolbar">
      <div className="root-config__search">
        <TextInput leading={<IconSearch size={18} />} id="root-config-search" name="settings-search" autoComplete="off" aria-label={text.find} aria-controls="root-config-results" type="search" maxLength={searchMaxCharacters} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={text.searchPlaceholder} />
        <kbd className="root-config__kbd" aria-hidden="true">/</kbd>
      </div>
      <select className="root-config__picker" aria-label={text.categoriesLabel} value={search ? '' : section} onChange={event => { if (event.target.value) pick(event.target.value); }}>
        {search ? <option value="">{text.allSections}</option> : null}
        {navGroups.map(group => group.owner
          ? <optgroup key={group.owner} label={group.owner}>{group.items.map(item => <option key={item.name} value={item.name}>{item.label} ({sectionCounts.get(item.name)})</option>)}</optgroup>
          : group.items.map(item => <option key={item.name} value={item.name}>{item.label} ({sectionCounts.get(item.name)})</option>))}
      </select>
      <ConfigHistory copy={interfaceCopy} />
    </div>
    <div className="root-config__body">
    <aside className="root-config__sidebar" aria-label={text.sectionsLabel}><nav aria-label={text.categoriesLabel}>
      {navGroups.map(group => <div key={group.owner} className="root-config__navgroup">
        {group.owner ? <h3>{group.owner}</h3> : null}
        {group.items.map(item => <button key={item.name} type="button" className={!search && section === item.name ? 'is-active' : ''} aria-current={!search && section === item.name ? 'page' : undefined} onClick={() => pick(item.name)}><span>{item.label}</span><span className="root-config__navcount">{sectionCounts.get(item.name)}</span></button>)}
      </div>)}
    </nav></aside>
    <div className="root-config__content" ref={errorsRef}>
    <div className="root-config__content-head" id="root-config-results"><h2>{search ? configCopyText(text.searchResults, { search }) : section}</h2><span aria-live="polite" aria-atomic="true">{configCopyText(text.count, { count: visible.length })}</span></div>
    {message && <p className="root-config__status" role={message.error ? 'alert' : 'status'} aria-live={message.error ? 'assertive' : 'polite'}>{message.text}</p>}
    {visible.length === 0 && <div className="root-config__empty"><EmptyState title={copy.empty} icon={<IconSettings />} action={<Button onClick={() => setSearch('')}>{interfaceCopy.reset}</Button>} /></div>}
    {shown.map((definition) => {
      const current = values.find((item) => item.key === definition.key);
      const isPending = Boolean(pending[definition.key]);
      return <section className="root-config__card" key={definition.key} data-setting={definition.key}>
        <div className="root-config__card-head"><h2>{definition.label}</h2>{current?.source === 'database' ? <Badge tone="brand">{text.customValue}</Badge> : null}</div>
        <div className="root-config__group">{search ? <span>{groupByOwner ? `${ownerName(definition)} · ` : ''}{definition.group}</span> : null}<code>{definition.key}</code></div>
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
    {visible.length > shown.length && <p className="root-config__more" role="status">{configCopyText(text.searchMore, { shown: shown.length, count: visible.length })}</p>}
    {!hideInventory && !search && visible.some(item => item.key.startsWith('entitlements.')) && <section className="root-config__catalog">
      <h2>{copy.inventory}</h2>
      <p>{copy.inventoryDescription}</p>
      <h3>{copy.modules}</h3><ul>{availability.modules.map((module) => <li key={module.id}>{module.title} <code>{module.id}</code></li>)}</ul>
      <h3>{copy.features}</h3><ul>{availability.features.map((feature) => <li key={feature.id}>{feature.title} <code>{feature.id}</code> · {feature.module}</li>)}</ul>
    </section>}
    </div>
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
