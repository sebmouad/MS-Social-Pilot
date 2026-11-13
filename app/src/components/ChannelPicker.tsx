"use client";
import { useMemo, useRef, useEffect, useState } from "react";
import { IconSearch } from "@tabler/icons-react";
import { Avatar } from "./Avatar";
import { useShellCopy } from "./ShellCopy";
import { fill } from "@/modules/shell/copy";
import type { ScopeChannel } from "./ChannelScopeList";

/**
 * Channel picker for the sidebar switcher (2026-11-13), built for long lists (60+ channels): search first, chosen
 * channels pinned on top, the rest alphabetical. Clicking a name shows only that channel at once; ticking boxes
 * builds a selection that is applied once with « Show N channels », so picking several reloads the page one time.
 */
export function ChannelPicker({ channels, selectedIds, onApply, manageHref, busy = false }: {
  channels: ScopeChannel[]; selectedIds: readonly string[]; onApply: (ids: string[]) => void; manageHref?: string; busy?: boolean;
}) {
  const copy = useShellCopy();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selectedIds));
  const search = useRef<HTMLInputElement>(null);
  // The picker opens only after a click, so reading the page language here cannot change the first render.
  const [locale, setLocale] = useState<"en" | "fr">("en");
  useEffect(() => { search.current?.focus(); setLocale(document.documentElement.lang.startsWith("fr") ? "fr" : "en"); }, []);
  const fr = locale === "fr";
  const needle = query.trim().toLocaleLowerCase();
  const sorted = useMemo(() => [...channels].sort((a, b) => a.name.localeCompare(b.name, locale)), [channels, locale]);
  const matches = needle ? sorted.filter(channel => channel.name.toLocaleLowerCase().includes(needle)) : sorted;
  // Chosen channels stay on top (as saved when the picker opened), so a long list never hides them.
  const pinned = needle ? [] : sorted.filter(channel => selectedIds.includes(channel.id));
  const rest = needle ? matches : matches.filter(channel => !selectedIds.includes(channel.id));
  const changed = draft.size !== selectedIds.length || selectedIds.some(id => !draft.has(id));
  const toggle = (id: string) => setDraft(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const row = (channel: ScopeChannel) => {
    const on = draft.has(channel.id);
    return <li key={channel.id} className={`ui-picker__row${on ? " is-on" : ""}`}>
      <input type="checkbox" className="ui-picker__check" checked={on} disabled={busy} aria-label={fill(copy.scopeToggle, { name: channel.name })} onChange={() => toggle(channel.id)} />
      <button type="button" className="ui-picker__name" disabled={busy} onClick={() => onApply([channel.id])} title={fr ? `Afficher seulement ${channel.name}` : `Show only ${channel.name}`}>
        <span className="ui-scope__avatar"><Avatar name={channel.name} src={channel.pictureUrl} size="sm" decorative /><span className={`ui-scope__dot is-${channel.health}`} aria-hidden="true" /></span>
        <span className="ui-picker__label">{channel.name}</span>
        {channel.health !== "connected" ? <span className="ui-picker__health">{copy.channelStatus[channel.health]}</span> : null}
      </button>
    </li>;
  };

  return <div className="ui-picker">
    <label className="ui-scope__search ui-picker__search"><IconSearch size={15} aria-hidden="true" />
      <input ref={search} type="search" aria-label={copy.searchChannels} placeholder={fill(fr ? "Rechercher parmi {count} canaux" : "Search {count} channels", { count: channels.length })} value={query} autoComplete="off" onChange={event => setQuery(event.target.value)} /></label>
    <button type="button" className={`ui-picker__all${selectedIds.length === 0 ? " is-on" : ""}`} disabled={busy} onClick={() => onApply([])}>
      <span className="ui-scope__all" aria-hidden="true">{channels.length}</span><span>{copy.allChannels}</span>
    </button>
    <div className="ui-picker__scroll">
      {pinned.length ? <><p className="ui-picker__group">{fr ? "Sélectionnés" : "Selected"}</p><ul className="ui-picker__list">{pinned.map(row)}</ul></> : null}
      {rest.length ? <>{pinned.length || needle ? <p className="ui-picker__group">{needle ? rest.length === 1 ? (fr ? "1 résultat" : "1 result") : fill(fr ? "{count} résultats" : "{count} results", { count: rest.length }) : fr ? "Tous les canaux" : "All channels"}</p> : null}<ul className="ui-picker__list">{rest.map(row)}</ul></> : null}
      {matches.length === 0 ? <p className="ui-picker__empty" role="status">{copy.noChannelMatch}</p> : null}
    </div>
    <div className="ui-picker__foot">
      {manageHref ? <a className="ui-picker__manage" href={manageHref}>{copy.manageChannels}</a> : <span />}
      <span className="ui-picker__actions">
        {draft.size ? <button type="button" className="ui-button ui-button--quiet ui-button--sm" disabled={busy} onClick={() => setDraft(new Set())}>{fr ? "Tout décocher" : "Clear"}</button> : null}
        <button type="button" className="ui-button ui-button--primary ui-button--sm" disabled={busy || !changed} onClick={() => onApply([...draft])}>
          {draft.size === 0 ? copy.allChannels : draft.size === 1 ? (fr ? "Afficher 1 canal" : "Show 1 channel") : fill(fr ? "Afficher {count} canaux" : "Show {count} channels", { count: draft.size })}
        </button>
      </span>
    </div>
  </div>;
}
